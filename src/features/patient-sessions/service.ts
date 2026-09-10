import "server-only";

import { AuthenticationError, getVerifiedUser } from "@/src/server/auth/user";
import { decryptProtectedContent } from "@/src/server/crypto/protected-content";
import { createAdminClient } from "@/src/server/supabase/admin";
import { createSupabaseServerClient } from "@/src/server/supabase/server";
import type { PatientSessionView } from "@/src/types/patient-session";
import type { CitationDto, PatientMessageDto, PatientRiskDto } from "@/src/types/patient-chat";
import { loadMemoryProfileForSession } from "@/src/features/memory/service";
import { loadPatientEscalations } from "@/src/features/escalation/service";

export class PatientSessionError extends Error {
  constructor(public readonly code: "unauthenticated" | "not_found" | "database_error") {
    super(code);
  }
}

export async function getPatientSessionView(sessionId: string): Promise<PatientSessionView> {
  let user;
  try {
    user = await getVerifiedUser();
  } catch (error) {
    if (error instanceof AuthenticationError) throw new PatientSessionError("unauthenticated");
    throw new PatientSessionError("database_error");
  }

  const supabase = await createSupabaseServerClient();
  const { data: patientSession, error: sessionError } = await supabase
    .from("patient_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) throw new PatientSessionError("database_error");
  if (!patientSession) throw new PatientSessionError("not_found");

  const [{ data: messages, error: messagesError }, { data: consent, error: consentError }] = await Promise.all([
    supabase
      .from("messages")
      .select("*")
      .or(`lead_session_id.eq.${patientSession.origin_lead_session_id},patient_session_id.eq.${patientSession.id}`)
      .in("status", ["completed", "blocked"])
      .order("created_at", { ascending: true }),
    supabase
      .from("consent_events")
      .select("occurred_at")
      .eq("patient_id", patientSession.patient_id)
      .eq("lead_session_id", patientSession.origin_lead_session_id)
      .eq("type", "healthcare_sharing")
      .eq("action", "granted")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (messagesError || consentError || !consent) throw new PatientSessionError("database_error");

  const patientMessageIds = (messages ?? [])
    .filter((message) => message.actor === "patient")
    .map((message) => message.id);
  const assistantMessageIds = (messages ?? [])
    .filter((message) => message.actor === "assistant" && message.patient_session_id)
    .map((message) => message.id);

  const [{ data: risks, error: risksError }, { data: citationRows, error: citationsError }] = await Promise.all([
    patientMessageIds.length
      ? supabase.from("risk_assessments").select("*").in("message_id", patientMessageIds)
      : Promise.resolve({ data: [], error: null }),
    assistantMessageIds.length
      ? supabase.from("citations").select("*").in("assistant_message_id", assistantMessageIds).order("ordinal")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (risksError || citationsError) throw new PatientSessionError("database_error");

  const sourceIds = [...new Set((citationRows ?? []).map((citation) => citation.knowledge_source_id))];
  const { data: sources, error: sourcesError } = sourceIds.length
    ? await supabase.from("knowledge_sources").select("id, title, publisher, url, version").in("id", sourceIds)
    : { data: [], error: null };
  if (sourcesError) throw new PatientSessionError("database_error");

  const risksByMessage = new Map((risks ?? []).map((risk) => [risk.message_id, toRiskDto(risk)]));
  const sourcesById = new Map((sources ?? []).map((source) => [source.id, source]));
  const citationsByMessage = new Map<string, CitationDto[]>();
  for (const citation of citationRows ?? []) {
    const source = sourcesById.get(citation.knowledge_source_id);
    if (!source) continue;
    const values = citationsByMessage.get(citation.assistant_message_id) ?? [];
    values.push({ id: source.id, title: source.title, publisher: source.publisher, url: source.url, version: source.version });
    citationsByMessage.set(citation.assistant_message_id, values);
  }

  // Use the privileged client only after RLS has proven this user owns the session.
  const admin = createAdminClient();
  const { data: lead, error: leadError } = await admin
    .from("lead_sessions")
    .select("clinic_id, source_channel, campaign_id, creative, landing_timestamp, context_ciphertext")
    .eq("id", patientSession.origin_lead_session_id)
    .single();
  if (leadError || !lead) throw new PatientSessionError("database_error");
  const { data: clinic, error: clinicError } = await admin
    .from("clinics")
    .select("id, name")
    .eq("id", lead.clinic_id)
    .single();
  if (clinicError || !clinic) throw new PatientSessionError("database_error");
  let memory;
  let escalations;
  try {
    [memory, escalations] = await Promise.all([
      loadMemoryProfileForSession(patientSession.id),
      loadPatientEscalations(patientSession.id),
    ]);
  } catch {
    throw new PatientSessionError("database_error");
  }

  return {
    id: patientSession.id,
    status: patientSession.status,
    startedAt: patientSession.started_at,
    memoryBootstrapStatus: patientSession.memory_bootstrap_status,
    continuedFromGuest: (messages ?? []).some((message) => message.actor === "guest"),
    clinic,
    patientEmail: user.email || "",
    consentedAt: consent.occurred_at,
    preloadedContext: lead.context_ciphertext
      ? decryptProtectedContent(lead.context_ciphertext)
      : null,
    attribution: {
      sourceChannel: lead.source_channel,
      campaignId: lead.campaign_id,
      creative: lead.creative,
      landingTimestamp: lead.landing_timestamp,
    },
    messages: (messages ?? []).map((message): PatientMessageDto => ({
      id: message.id,
      actor: message.actor,
      status: message.status,
      content: decryptProtectedContent(message.content_ciphertext),
      createdAt: message.created_at,
      risk: risksByMessage.get(message.id) ?? null,
      citations: citationsByMessage.get(message.id) ?? [],
    })),
    memory,
    escalations,
  };
}

function toRiskDto(risk: {
  risk_level: PatientRiskDto["level"];
  risk_reason: string;
  confidence: PatientRiskDto["confidence"];
  escalation_required: boolean;
  rule_matches: string[];
  pipeline_version: string;
  provenance: unknown;
  assessed_at: string;
}): PatientRiskDto {
  const source =
    risk.provenance &&
    typeof risk.provenance === "object" &&
    "source" in risk.provenance &&
    ["deterministic", "model", "fallback"].includes(String(risk.provenance.source))
      ? (String(risk.provenance.source) as PatientRiskDto["provenance"]["source"])
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
