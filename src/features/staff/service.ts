import "server-only";

import { getStaffMemberships, StaffAccessError } from "@/src/features/staff/auth";
import { escalationAttributionSchema, escalationProfileSnapshotSchema, escalationTriageSummarySchema } from "@/src/features/escalation/schema";
import { decryptProtectedContent, encryptProtectedContent, hashProtectedContent } from "@/src/server/crypto/protected-content";
import { writeAuditLog } from "@/src/server/logging/audit";
import { createAdminClient } from "@/src/server/supabase/admin";
import { createSupabaseServerClient } from "@/src/server/supabase/server";
import type { EscalationQueueItemDto, EscalationReviewDto } from "@/src/types/escalation";

export async function getEscalationQueue(): Promise<{ memberships: Awaited<ReturnType<typeof getStaffMemberships>>; items: EscalationQueueItemDto[] }> {
  const memberships = await getStaffMemberships();
  const supabase = await createSupabaseServerClient();
  const { data: escalations, error } = await supabase
    .from("escalations")
    .select("*")
    .neq("status", "required")
    .order("sent_at", { ascending: false });
  if (error) throw new StaffAccessError("database_error");

  const riskIds = (escalations ?? []).map((item) => item.risk_assessment_id);
  const { data: risks, error: riskError } = riskIds.length
    ? await supabase.from("risk_assessments").select("id, risk_level").in("id", riskIds)
    : { data: [], error: null };
  if (riskError) throw new StaffAccessError("database_error");
  const riskById = new Map((risks ?? []).map((risk) => [risk.id, risk.risk_level]));
  const clinicById = new Map(memberships.map((membership) => [membership.clinicId, membership.clinicName]));

  const items = (escalations ?? []).flatMap((item): EscalationQueueItemDto[] => {
    const riskLevel = riskById.get(item.risk_assessment_id);
    const clinicName = clinicById.get(item.clinic_id);
    if (!riskLevel || !clinicName || item.status === "required" || !item.sent_at || !item.response_expected_by || !item.triage_summary_ciphertext) return [];
    return [{
      id: item.id,
      clinicName,
      patientReference: item.patient_id.slice(0, 8).toUpperCase(),
      riskLevel,
      status: item.status,
      summary: parseArray(decryptProtectedContent(item.triage_summary_ciphertext)),
      responseExpectedBy: item.response_expected_by,
      sentAt: item.sent_at,
    }];
  });
  return { memberships, items };
}

export async function getEscalationReview(escalationId: string): Promise<EscalationReviewDto> {
  const memberships = await getStaffMemberships();
  const supabase = await createSupabaseServerClient();
  const { data: escalation, error } = await supabase
    .from("escalations")
    .select("*")
    .eq("id", escalationId)
    .neq("status", "required")
    .maybeSingle();
  if (error) throw new StaffAccessError("database_error");
  if (!escalation || escalation.status === "required" || !escalation.sent_at || !escalation.response_expected_by || !escalation.triage_summary_ciphertext || !escalation.profile_snapshot_ciphertext) {
    throw new StaffAccessError("forbidden");
  }

  const [riskResult, triggerResult, provenanceResult, responseResult] = await Promise.all([
    supabase.from("risk_assessments").select("*").eq("id", escalation.risk_assessment_id).single(),
    supabase.from("messages").select("*").eq("id", escalation.trigger_message_id).single(),
    supabase.from("escalation_provenance").select("purpose, message_id, memory_revision_id").eq("escalation_id", escalation.id),
    supabase.from("clinician_responses").select("*").eq("escalation_id", escalation.id).order("created_at"),
  ]);
  if (riskResult.error || !riskResult.data || triggerResult.error || !triggerResult.data || provenanceResult.error || responseResult.error) {
    throw new StaffAccessError("database_error");
  }

  const clinicMembership = memberships.find((membership) => membership.clinicId === escalation.clinic_id);
  if (!clinicMembership) throw new StaffAccessError("forbidden");
  const authorIds = [...new Set((responseResult.data ?? []).map((response) => response.author_membership_id))];
  const admin = createAdminClient();
  const { data: authors, error: authorError } = authorIds.length
    ? await admin.from("clinic_memberships").select("id, role").in("id", authorIds).eq("clinic_id", escalation.clinic_id)
    : { data: [], error: null };
  if (authorError) throw new StaffAccessError("database_error");
  const roleById = new Map((authors ?? []).map((author) => [author.id, author.role]));
  const attributionResult = escalationAttributionSchema.safeParse(escalation.attribution_snapshot);
  const summaryResult = safeParseEncrypted(escalation.triage_summary_ciphertext, escalationTriageSummarySchema);
  const profileResult = safeParseEncrypted(escalation.profile_snapshot_ciphertext, escalationProfileSnapshotSchema);
  if (!attributionResult.success || !summaryResult || !profileResult) throw new StaffAccessError("database_error");
  const attribution = attributionResult.data;

  return {
    id: escalation.id,
    clinicId: escalation.clinic_id,
    clinicName: clinicMembership.clinicName,
    patientReference: escalation.patient_id.slice(0, 8).toUpperCase(),
    riskLevel: riskResult.data.risk_level,
    status: escalation.status,
    summary: summaryResult,
    responseExpectedBy: escalation.response_expected_by,
    sentAt: escalation.sent_at,
    patientSessionId: escalation.patient_session_id,
    triggerMessageId: escalation.trigger_message_id,
    triggerMessage: decryptProtectedContent(triggerResult.data.content_ciphertext),
    riskReason: riskResult.data.risk_reason,
    riskConfidence: riskResult.data.confidence,
    profileSnapshot: profileResult,
    attribution: {
      sourceChannel: attribution.source_channel as EscalationReviewDto["attribution"]["sourceChannel"],
      socialPlatform: attribution.social_platform,
      campaignId: attribution.campaign_id,
      creative: attribution.creative,
      landingTimestamp: attribution.landing_timestamp,
      landingContext: attribution.landing_context,
      acquisitionIdentityLevel: attribution.acquisition_identity_level,
      currentIdentityLevel: attribution.current_identity_level,
      identityVerified: attribution.identity_verified,
      authenticationMethod: attribution.authentication_method,
    },
    provenance: (provenanceResult.data ?? []).map((row) => ({
      purpose: row.purpose,
      messageId: row.message_id,
      memoryRevisionId: row.memory_revision_id,
    })),
    responses: (responseResult.data ?? []).map((response) => ({
      id: response.id,
      authorRole: roleById.get(response.author_membership_id) ?? "clinician",
      content: decryptProtectedContent(response.content_ciphertext),
      createdAt: response.created_at,
    })),
    canRespond: clinicMembership.role === "nurse" || clinicMembership.role === "clinician",
  };
}

export async function acknowledgeEscalation(escalationId: string) {
  await getStaffMemberships();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("acknowledge_escalation", { p_escalation_id: escalationId }).single();
  if (error || !data) throw mapStaffMutationError(error?.code);
  writeAuditLog({ action: "escalation.acknowledge", outcome: "success", resourceId: escalationId });
  return data.status;
}

export async function respondToEscalation(escalationId: string, content: string) {
  await getStaffMemberships();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("respond_to_escalation", {
    p_escalation_id: escalationId,
    p_content_ciphertext: encryptProtectedContent(content),
    p_content_sha256: hashProtectedContent(content),
  }).single();
  if (error || !data) throw mapStaffMutationError(error?.code);
  writeAuditLog({ action: "escalation.respond", outcome: "success", resourceId: escalationId });
  return data.id;
}

export async function closeEscalation(escalationId: string) {
  await getStaffMemberships();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("close_escalation", { p_escalation_id: escalationId }).single();
  if (error || !data) throw mapStaffMutationError(error?.code);
  writeAuditLog({ action: "escalation.close", outcome: "success", resourceId: escalationId });
  return data.status;
}

function mapStaffMutationError(code?: string) {
  if (code === "P0041") return new StaffAccessError("forbidden");
  if (code === "P0020") return new StaffAccessError("forbidden");
  return new StaffAccessError("database_error");
}

function parseArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

function safeParseEncrypted<T>(ciphertext: string, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): T | null {
  try {
    const result = schema.safeParse(JSON.parse(decryptProtectedContent(ciphertext)));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
