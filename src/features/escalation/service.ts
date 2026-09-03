import "server-only";

import { buildEscalationPayload } from "@/src/features/escalation/payload";
import { loadMemoryProfileForSession } from "@/src/features/memory/service";
import {
  decryptProtectedContent,
  encryptProtectedContent,
  hashProtectedContent,
} from "@/src/server/crypto/protected-content";
import { writeAuditLog } from "@/src/server/logging/audit";
import { createSupabaseServerClient } from "@/src/server/supabase/server";
import type { Json } from "@/src/types/database";
import type { PatientEscalationDto } from "@/src/types/escalation";
import type { PatientRiskDto } from "@/src/types/patient-chat";

export class EscalationError extends Error {
  constructor(public readonly code: "unauthenticated" | "not_found" | "consent_required" | "invalid_state" | "database_error") {
    super(code);
  }
}

export async function loadPatientEscalations(patientSessionId: string): Promise<PatientEscalationDto[]> {
  const supabase = await createSupabaseServerClient();
  const { data: escalations, error } = await supabase
    .from("escalations")
    .select("id, trigger_message_id, risk_assessment_id, status, response_min_hours, response_max_hours, response_expected_by, sent_at, created_at")
    .eq("patient_session_id", patientSessionId)
    .order("created_at", { ascending: false });
  if (error) throw new EscalationError(error.code === "PGRST301" ? "unauthenticated" : "database_error");

  const riskIds = (escalations ?? []).map((item) => item.risk_assessment_id);
  const { data: risks, error: riskError } = riskIds.length
    ? await supabase.from("risk_assessments").select("id, risk_level").in("id", riskIds)
    : { data: [], error: null };
  if (riskError) throw new EscalationError("database_error");
  const riskById = new Map((risks ?? []).map((risk) => [risk.id, risk.risk_level]));

  return (escalations ?? []).flatMap((item): PatientEscalationDto[] => {
    const riskLevel = riskById.get(item.risk_assessment_id);
    return riskLevel ? [{
      id: item.id,
      triggerMessageId: item.trigger_message_id,
      riskLevel,
      status: item.status,
      responseMinHours: item.response_min_hours,
      responseMaxHours: item.response_max_hours,
      responseExpectedBy: item.response_expected_by,
      sentAt: item.sent_at,
      createdAt: item.created_at,
    }] : [];
  });
}

export async function queuePatientEscalation(escalationId: string): Promise<PatientEscalationDto> {
  const supabase = await createSupabaseServerClient();
  const { data: escalation, error } = await supabase
    .from("escalations")
    .select("*")
    .eq("id", escalationId)
    .maybeSingle();
  if (error) throw new EscalationError("database_error");
  if (!escalation) throw new EscalationError("not_found");

  const [{ data: risk, error: riskError }, { data: trigger, error: triggerError }] = await Promise.all([
    supabase.from("risk_assessments").select("*").eq("id", escalation.risk_assessment_id).single(),
    supabase.from("messages").select("*").eq("id", escalation.trigger_message_id).single(),
  ]);
  if (riskError || !risk || triggerError || !trigger) throw new EscalationError("database_error");

  const riskDto = toRiskDto(risk);
  const memory = await loadMemoryProfileForSession(escalation.patient_session_id);
  const payload = buildEscalationPayload({
    triggerMessageId: trigger.id,
    triggerMessage: decryptProtectedContent(trigger.content_ciphertext),
    risk: riskDto,
    memory,
  });
  const triageSummary = JSON.stringify(payload.triageSummary);
  const profileSnapshot = JSON.stringify(payload.profileSnapshot);

  const { data: queued, error: queueError } = await supabase
    .rpc("queue_escalation", {
      p_escalation_id: escalation.id,
      p_triage_summary_ciphertext: encryptProtectedContent(triageSummary),
      p_triage_summary_sha256: hashProtectedContent(triageSummary),
      p_profile_snapshot_ciphertext: encryptProtectedContent(profileSnapshot),
      p_profile_snapshot_sha256: hashProtectedContent(profileSnapshot),
      p_provenance: payload.provenance as Json,
    })
    .single();
  if (queueError || !queued) throw mapDatabaseError(queueError?.code);

  writeAuditLog({ action: "escalation.queue", outcome: "success", resourceId: queued.id });
  return {
    id: queued.id,
    triggerMessageId: queued.trigger_message_id,
    riskLevel: risk.risk_level,
    status: queued.status,
    responseMinHours: queued.response_min_hours,
    responseMaxHours: queued.response_max_hours,
    responseExpectedBy: queued.response_expected_by,
    sentAt: queued.sent_at,
    createdAt: queued.created_at,
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
  const source = risk.provenance && typeof risk.provenance === "object" && "source" in risk.provenance
    ? String(risk.provenance.source)
    : "fallback";
  return {
    level: risk.risk_level,
    reason: risk.risk_reason,
    confidence: risk.confidence,
    escalationRequired: risk.escalation_required,
    ruleMatches: risk.rule_matches,
    pipelineVersion: risk.pipeline_version,
    provenance: {
      source: ["deterministic", "model", "fallback"].includes(source)
        ? source as PatientRiskDto["provenance"]["source"]
        : "fallback",
      assessedAt: risk.assessed_at,
    },
  };
}

function mapDatabaseError(code?: string) {
  if (code === "P0010") return new EscalationError("unauthenticated");
  if (code === "P0020") return new EscalationError("not_found");
  if (code === "P0021") return new EscalationError("consent_required");
  if (code === "P0040") return new EscalationError("invalid_state");
  return new EscalationError("database_error");
}
