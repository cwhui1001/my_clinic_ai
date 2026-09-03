import "server-only";

import type { PatientMessageRequest } from "@/src/features/patient-chat/schema";
import { currentFactsFromProfile, loadMemoryProfileForSession, toEncryptedMemoryPayload } from "@/src/features/memory/service";
import { runPatientSafetyPipeline, type PipelineKnowledgeSource } from "@/src/features/patient-chat/pipeline";
import { PATIENT_PROMPT_VERSION, RISK_PIPELINE_VERSION } from "@/src/features/risk/policy";
import { REDACTION_VERSION } from "@/src/features/redaction/redact";
import { encryptProtectedContent, decryptProtectedContent, hashProtectedContent } from "@/src/server/crypto/protected-content";
import { writeAuditLog } from "@/src/server/logging/audit";
import { createPatientModelResponse } from "@/src/server/openai/patient-response";
import { createAdminClient } from "@/src/server/supabase/admin";
import { createSupabaseServerClient } from "@/src/server/supabase/server";
import type { Database, Json, ModelRunStatus, RedactionStatus } from "@/src/types/database";
import type { CitationDto, PatientMessageDto, PatientReplyDto, PatientRiskDto } from "@/src/types/patient-chat";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
type RiskRow = Database["public"]["Tables"]["risk_assessments"]["Row"];

export class PatientChatError extends Error {
  constructor(
    public readonly code:
      | "unauthenticated"
      | "not_found"
      | "consent_required"
      | "rate_limited"
      | "turn_in_progress"
      | "invalid_state"
      | "database_error",
  ) {
    super(code);
  }
}

export async function createPatientTurn(
  patientSessionId: string,
  input: PatientMessageRequest,
): Promise<PatientReplyDto> {
  const supabase = await createSupabaseServerClient();
  const { data: appended, error: appendError } = await supabase
    .rpc("append_patient_message", {
      p_patient_session_id: patientSessionId,
      p_client_message_id: input.clientMessageId,
      p_content_ciphertext: encryptProtectedContent(input.message),
      p_content_sha256: hashProtectedContent(input.message),
    })
    .single();

  if (appendError || !appended) throw mapDatabaseError(appendError?.code);
  if (appended.status !== "received") return loadExistingReply(appended);

  const admin = createAdminClient();
  const { data: sourceRows, error: sourceError } = await admin
    .from("knowledge_sources")
    .select("id, title, publisher, url, content, version")
    .eq("active", true)
    .order("reviewed_at", { ascending: false })
    .limit(4);
  if (sourceError) throw new PatientChatError("database_error");
  const sources = (sourceRows ?? []) satisfies PipelineKnowledgeSource[];
  let currentMemory;
  try {
    currentMemory = currentFactsFromProfile(await loadMemoryProfileForSession(patientSessionId));
  } catch {
    throw new PatientChatError("database_error");
  }

  const pipeline = await runPatientSafetyPipeline({
    message: input.message,
    sources,
    sourceMessageId: appended.id,
    currentMemory,
    generate: ({ redactedMessage, sources: approvedSources }) =>
      createPatientModelResponse({
        redactedMessage,
        sources: approvedSources,
        safetyIdentifier: hashProtectedContent(`patient-session:${patientSessionId}`),
      }),
  });

  const citationEvidence = pipeline.citationSourceIds.map((sourceId, index) => {
    const source = sources.find((candidate) => candidate.id === sourceId);
    if (!source) throw new PatientChatError("invalid_state");
    return {
      source_id: source.id,
      source_start: 0,
      source_end: Array.from(source.content).length,
      quoted_span_hash: hashProtectedContent(source.content),
      ordinal: index + 1,
    };
  });

  const redactionStatus: RedactionStatus = pipeline.redaction ? "passed" : "failed";
  const isModelFailure = pipeline.risk.source === "fallback" && pipeline.errorCode !== "redaction_failed";
  const modelStatus: ModelRunStatus = pipeline.model ? "completed" : isModelFailure ? "failed" : "skipped";
  const provider = pipeline.model || isModelFailure ? "openai" : "local";
  const model = pipeline.model?.model ?? (isModelFailure ? process.env.OPENAI_MODEL || "unconfigured" : "deterministic-risk-gate");
  const redactedInputHash = hashProtectedContent(pipeline.redaction?.text ?? "[REDACTION_FAILED]");
  const assessedAt = new Date().toISOString();

  const { data: completed, error: completeError } = await admin
    .rpc("complete_patient_turn_with_memory", {
      p_patient_session_id: patientSessionId,
      p_source_message_id: appended.id,
      p_source_status: pipeline.sourceStatus,
      p_redaction_status: redactionStatus,
      p_redaction_version: pipeline.redaction ? REDACTION_VERSION : null,
      p_redaction_summary: pipeline.redaction
        ? {
            categories: pipeline.redaction.categories,
            counts: pipeline.redaction.counts,
          }
        : { error: "redaction_failed" },
      p_assistant_ciphertext: encryptProtectedContent(pipeline.answer),
      p_assistant_sha256: hashProtectedContent(pipeline.answer),
      p_risk_level: pipeline.risk.level,
      p_risk_reason: pipeline.risk.reason,
      p_confidence: pipeline.risk.confidence,
      p_escalation_required: pipeline.risk.escalationRequired,
      p_rule_matches: pipeline.risk.ruleMatches,
      p_pipeline_version: RISK_PIPELINE_VERSION,
      p_risk_provenance: {
        source: pipeline.risk.source,
        assessed_at: assessedAt,
      },
      p_provider: provider,
      p_model: model,
      p_prompt_version: PATIENT_PROMPT_VERSION,
      p_redacted_input_hash: redactedInputHash,
      p_provider_response_id: pipeline.model?.providerResponseId ?? null,
      p_model_status: modelStatus,
      p_duration_ms: pipeline.model?.durationMs ?? 0,
      p_error_code: pipeline.errorCode,
      p_citations: citationEvidence as Json,
      p_memory_proposals: toEncryptedMemoryPayload(pipeline.memoryProposals),
    })
    .single();

  if (completeError || !completed) throw mapDatabaseError(completeError?.code);
  writeAuditLog({
    action: "patient_message.complete",
    outcome: "success",
    resourceId: appended.id,
  });
  return loadReply(appended, completed);
}

async function loadExistingReply(patientMessage: MessageRow) {
  const admin = createAdminClient();
  const { data: assistant, error } = await admin
    .from("messages")
    .select("*")
    .eq("in_reply_to_message_id", patientMessage.id)
    .eq("actor", "assistant")
    .maybeSingle();
  if (error) throw new PatientChatError("database_error");
  if (!assistant) throw new PatientChatError("invalid_state");
  return loadReply(patientMessage, assistant);
}

async function loadReply(patientMessage: MessageRow, assistantMessage: MessageRow): Promise<PatientReplyDto> {
  const admin = createAdminClient();
  const [{ data: risk, error: riskError }, { data: citations, error: citationError }] = await Promise.all([
    admin.from("risk_assessments").select("*").eq("message_id", patientMessage.id).single(),
    admin.from("citations").select("*").eq("assistant_message_id", assistantMessage.id).order("ordinal"),
  ]);
  if (riskError || !risk || citationError) throw new PatientChatError("database_error");

  const sourceIds = (citations ?? []).map((citation) => citation.knowledge_source_id);
  const { data: sources, error: sourceError } = sourceIds.length
    ? await admin.from("knowledge_sources").select("id, title, publisher, url, version").in("id", sourceIds)
    : { data: [], error: null };
  if (sourceError) throw new PatientChatError("database_error");
  const sourcesById = new Map((sources ?? []).map((source) => [source.id, source]));
  const citationDtos = (citations ?? []).flatMap((citation): CitationDto[] => {
    const source = sourcesById.get(citation.knowledge_source_id);
    return source
      ? [{ id: source.id, title: source.title, publisher: source.publisher, url: source.url, version: source.version }]
      : [];
  });

  return {
    patientMessage: toMessageDto(patientMessage, toRiskDto(risk), []),
    assistantMessage: toMessageDto(assistantMessage, null, citationDtos),
    memory: await loadMemoryProfileForSession(patientMessage.patient_session_id!),
  };
}

function toMessageDto(row: MessageRow, risk: PatientRiskDto | null, citations: CitationDto[]): PatientMessageDto {
  return {
    id: row.id,
    actor: row.actor,
    status: row.status,
    content: decryptProtectedContent(row.content_ciphertext),
    createdAt: row.created_at,
    risk,
    citations,
  };
}

function toRiskDto(risk: RiskRow): PatientRiskDto {
  const provenance = risk.provenance;
  const source =
    provenance &&
    typeof provenance === "object" &&
    !Array.isArray(provenance) &&
    ["deterministic", "model", "fallback"].includes(String(provenance.source))
      ? (String(provenance.source) as PatientRiskDto["provenance"]["source"])
      : "fallback";
  return {
    level: risk.risk_level,
    reason: risk.risk_reason,
    confidence: risk.confidence,
    escalationRequired: risk.escalation_required,
    ruleMatches: risk.rule_matches,
    pipelineVersion: risk.pipeline_version,
    provenance: { source, assessedAt: risk.assessed_at },
  };
}

function mapDatabaseError(code?: string) {
  if (code === "P0010") return new PatientChatError("unauthenticated");
  if (code === "P0020") return new PatientChatError("not_found");
  if (code === "P0021") return new PatientChatError("consent_required");
  if (code === "P0001") return new PatientChatError("rate_limited");
  if (code === "P0004") return new PatientChatError("turn_in_progress");
  if (
    code === "P0005" ||
    code === "P0022" ||
    code === "P0023" ||
    code === "P0024" ||
    ["P0031", "P0032", "P0033", "P0034"].includes(code ?? "")
  ) {
    return new PatientChatError("invalid_state");
  }
  return new PatientChatError("database_error");
}
