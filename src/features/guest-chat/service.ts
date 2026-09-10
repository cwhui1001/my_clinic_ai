import "server-only";

import {
  getLeadSessionByRecoveryToken,
  LeadSessionError,
} from "@/src/features/lead-sessions/service";
import {
  buildTrustResponse,
  classifyGuestIntent,
  EMERGENCY_RESPONSE,
  findEmergencyRule,
  GUEST_DEGRADED_MODE_RESPONSE,
  GUEST_CHAT_PROMPT_VERSION,
  guestRedactionFailureResponse,
  hasMeaningfulValueEvent,
  isGuestResponseSafe,
  requiresSecureContinue,
  SAFE_FAILURE_RESPONSE,
  valueTypeForIntent,
} from "@/src/features/guest-chat/policy";
import type { GuestMessageRequest } from "@/src/features/guest-chat/schema";
import {
  assertPhiSafe,
  redactPhi,
  REDACTION_VERSION,
} from "@/src/features/redaction/redact";
import {
  GuestModelError,
  createGuestModelReply,
} from "@/src/server/openai/guest-response";
import {
  decryptProtectedContent,
  encryptProtectedContent,
  hashProtectedContent,
  SAFETY_RESERVATION_PLACEHOLDER,
} from "@/src/server/crypto/protected-content";
import { hashGuestToken } from "@/src/server/crypto/guest-token";
import { createAdminClient } from "@/src/server/supabase/admin";
import type {
  Database,
  Json,
  MessageStatus,
  ModelRunStatus,
  RedactionStatus,
  ValueEventType,
} from "@/src/types/database";
import type {
  GuestMessageDto,
  GuestReplyDto,
  GuestThreadDto,
} from "@/src/types/guest-chat";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

export class GuestChatError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "rate_limited"
      | "turn_in_progress"
      | "invalid_state"
      | "database_error",
  ) {
    super(code);
  }
}

function mapDatabaseError(code?: string) {
  if (code === "P0001") return new GuestChatError("rate_limited");
  if (code === "P0003") return new GuestChatError("not_found");
  if (code === "P0004") return new GuestChatError("turn_in_progress");
  if (code === "P0005") return new GuestChatError("invalid_state");
  return new GuestChatError("database_error");
}

async function resolveGuestSession(recoveryToken: string) {
  try {
    return await getLeadSessionByRecoveryToken(recoveryToken);
  } catch (error) {
    if (error instanceof LeadSessionError && error.code === "not_found") {
      throw new GuestChatError("not_found");
    }
    throw new GuestChatError("database_error");
  }
}

function toMessageDto(row: MessageRow): GuestMessageDto {
  return {
    id: row.id,
    actor: row.actor,
    status: row.status,
    content: decryptProtectedContent(row.content_ciphertext),
    sequenceNumber: row.sequence_number,
    requiresSecureContinue: row.requires_secure_continue,
    createdAt: row.created_at,
  };
}

async function getClinicProfile(clinicId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("clinic_public_profiles")
    .select("services, hours_summary, availability_summary, general_note")
    .eq("clinic_id", clinicId)
    .single();

  if (error || !data) throw new GuestChatError("database_error");
  return {
    services: data.services,
    hoursSummary: data.hours_summary,
    availabilitySummary: data.availability_summary,
    generalNote: data.general_note,
  };
}

async function findAssistantReply(sourceMessageId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("in_reply_to_message_id", sourceMessageId)
    .eq("actor", "assistant")
    .maybeSingle();
  if (error) throw new GuestChatError("database_error");
  return data;
}

function localAnswer(
  intent: ReturnType<typeof classifyGuestIntent>,
  clinicName: string,
  profile: Awaited<ReturnType<typeof getClinicProfile>>,
) {
  switch (intent) {
    case "emergency":
      return EMERGENCY_RESPONSE;
    case "trust":
      return buildTrustResponse(clinicName);
    case "service":
      return `${clinicName} lists these services: ${profile.services.join(", ")}. ${profile.generalNote}`;
    case "hours":
      return `${clinicName}’s listed hours are ${profile.hoursSummary}`;
    case "availability":
      return profile.availabilitySummary;
    default:
      return null;
  }
}

export async function getGuestThread(recoveryToken: string): Promise<GuestThreadDto> {
  const session = await resolveGuestSession(recoveryToken);
  const supabase = createAdminClient();
  const [{ data, error }, { data: valueEvents, error: valueEventError }] =
    await Promise.all([
      supabase
        .rpc("read_guest_messages", {
          p_recovery_token_hash: hashGuestToken(recoveryToken),
        }),
      supabase
        .from("funnel_events")
        .select("id")
        .eq("lead_session_id", session.id)
        .eq("name", "value_event")
        .limit(1),
    ]);

  if (error || valueEventError) throw new GuestChatError("database_error");
  const messages = (data ?? []).map(toMessageDto);
  return {
    session,
    messages,
    secureContinuationAvailable: hasMeaningfulValueEvent(valueEvents?.length ?? 0),
  };
}

export async function createGuestTurn(
  recoveryToken: string,
  input: GuestMessageRequest,
): Promise<GuestReplyDto> {
  // Assess the raw message before the database turn is reserved and before
  // redaction can alter clinical meaning.
  const emergencyRule = findEmergencyRule(input.message);
  const intent = emergencyRule ? "emergency" : classifyGuestIntent(input.message);
  const session = await resolveGuestSession(recoveryToken);
  const tokenHash = hashGuestToken(recoveryToken);
  const supabase = createAdminClient();
  const { data: appended, error: appendError } = await supabase
    .rpc("append_guest_message", {
      p_recovery_token_hash: tokenHash,
      p_client_message_id: input.clientMessageId,
      p_content_ciphertext: encryptProtectedContent(SAFETY_RESERVATION_PLACEHOLDER),
      p_content_sha256: hashProtectedContent(SAFETY_RESERVATION_PLACEHOLDER),
    })
    .single();

  if (appendError || !appended) throw mapDatabaseError(appendError?.code);

  if (appended.status !== "received") {
    const existingReply = await findAssistantReply(appended.id);
    if (!existingReply) throw new GuestChatError("invalid_state");
    return {
      guestMessage: toMessageDto(appended),
      assistantMessage: toMessageDto(existingReply),
      valueType: null,
    };
  }

  const profile = await getClinicProfile(session.clinic.id);
  let answer = localAnswer(intent, session.clinic.name, profile);
  let valueType: ValueEventType | null = valueTypeForIntent(intent);
  let sourceStatus: MessageStatus = "completed";
  let redactionStatus: RedactionStatus = "passed";
  let redactionSummary: Json = {};
  let redactedInputHash = hashProtectedContent("[REDACTION_FAILED]");
  let modelStatus: ModelRunStatus = answer ? "skipped" : "completed";
  let provider = answer ? "local" : "openai";
  let model = answer ? "deterministic" : process.env.OPENAI_MODEL || "unconfigured";
  let providerResponseId: string | null = null;
  let durationMs = 0;
  let errorCode: string | null = null;

  try {
    const redactedMessage = redactPhi(input.message);
    const redactedContext = session.preloadedContext
      ? redactPhi(session.preloadedContext)
      : null;
    assertPhiSafe(redactedMessage.text);
    if (redactedContext) assertPhiSafe(redactedContext.text);

    redactionSummary = {
      categories: redactedMessage.categories,
      counts: redactedMessage.counts,
      context_categories: redactedContext?.categories ?? [],
    };
    redactedInputHash = hashProtectedContent(
      JSON.stringify({
        message: redactedMessage.text,
        context: redactedContext?.text ?? null,
      }),
    );

    if (!answer && intent !== "emergency" && intent !== "trust") {
      try {
        const generated = await createGuestModelReply({
          intent,
          redactedMessage: redactedMessage.text,
          redactedPreloadedContext: redactedContext?.text ?? null,
          clinicName: session.clinic.name,
          clinicProfile: profile,
          safetyIdentifier: tokenHash,
        });
        answer = generated.answer;
        model = generated.model;
        providerResponseId = generated.providerResponseId;
        durationMs = generated.durationMs;
      } catch (error) {
        modelStatus = "failed";
        errorCode = error instanceof GuestModelError ? error.code : "provider";
        answer = intent === "clinical_summary"
          ? `${GUEST_DEGRADED_MODE_RESPONSE}\n\nRedacted note for human follow-up: “${redactedMessage.text.slice(0, 185)}”`
          : GUEST_DEGRADED_MODE_RESPONSE;
        if (intent !== "clinical_summary") valueType = null;
      }
    }

    const safeAnswer = redactPhi(answer ?? SAFE_FAILURE_RESPONSE).text;
    assertPhiSafe(safeAnswer);
    if (!isGuestResponseSafe(safeAnswer)) {
      answer = SAFE_FAILURE_RESPONSE;
      valueType = null;
      errorCode = "unsafe_output";
      if (modelStatus === "completed") modelStatus = "failed";
    } else {
      answer = safeAnswer;
    }
  } catch {
    answer = guestRedactionFailureResponse(intent);
    valueType = null;
    sourceStatus = "blocked";
    redactionStatus = "failed";
    redactionSummary = { error: "redaction_failed" };
    modelStatus = "skipped";
    provider = "local";
    model = "redaction-gate";
    errorCode = "redaction_failed";
  }

  const protectedMessage = encryptProtectedContent(input.message);
  const { data: sealed, error: sealError } = await supabase
    .rpc("seal_guest_message", {
      p_recovery_token_hash: tokenHash,
      p_source_message_id: appended.id,
      p_content_ciphertext: protectedMessage,
      p_content_sha256: hashProtectedContent(input.message),
    })
    .single();
  if (sealError || !sealed) throw mapDatabaseError(sealError?.code);

  const { data: completed, error: completeError } = await supabase
    .rpc("complete_guest_turn", {
      p_recovery_token_hash: tokenHash,
      p_source_message_id: appended.id,
      p_source_status: sourceStatus,
      p_redaction_status: redactionStatus,
      p_redaction_version: REDACTION_VERSION,
      p_redaction_summary: redactionSummary,
      p_assistant_ciphertext: encryptProtectedContent(answer),
      p_assistant_sha256: hashProtectedContent(answer),
      p_requires_secure_continue: valueType !== null && requiresSecureContinue(intent),
      p_value_type: valueType,
      p_provider: provider,
      p_model: model,
      p_prompt_version: GUEST_CHAT_PROMPT_VERSION,
      p_redacted_input_hash: redactedInputHash,
      p_provider_response_id: providerResponseId,
      p_model_status: modelStatus,
      p_duration_ms: durationMs,
      p_error_code: errorCode,
    })
    .single();

  if (completeError || !completed) throw mapDatabaseError(completeError?.code);
  return {
    guestMessage: toMessageDto({ ...sealed, status: sourceStatus }),
    assistantMessage: toMessageDto(completed),
    valueType,
  };
}
