import "server-only";

import { AuthenticationError, getVerifiedUser } from "@/src/server/auth/user";
import { decryptProtectedContent } from "@/src/server/crypto/protected-content";
import { createAdminClient } from "@/src/server/supabase/admin";
import { createSupabaseServerClient } from "@/src/server/supabase/server";
import type { PatientSessionView } from "@/src/types/patient-session";

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
      .eq("lead_session_id", patientSession.origin_lead_session_id)
      .in("status", ["completed", "blocked"])
      .order("sequence_number", { ascending: true }),
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

  return {
    id: patientSession.id,
    status: patientSession.status,
    startedAt: patientSession.started_at,
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
    messages: (messages ?? []).map((message) => ({
      id: message.id,
      actor: message.actor,
      status: message.status,
      content: decryptProtectedContent(message.content_ciphertext),
      sequenceNumber: message.sequence_number,
      requiresSecureContinue: message.requires_secure_continue,
      createdAt: message.created_at,
    })),
  };
}
