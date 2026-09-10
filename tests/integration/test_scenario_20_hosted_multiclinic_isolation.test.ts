import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../../src/types/database";

const enabled = process.env.RUN_HOSTED_TENANT_TESTS === "1";
const suite = describe.skipIf(!enabled);
const ids = {
  clinics: [randomUUID(), randomUUID()],
  leads: [randomUUID(), randomUUID()],
  patients: [randomUUID(), randomUUID()],
  sessions: [randomUUID(), randomUUID()],
  messages: [randomUUID(), randomUUID()],
  risks: [randomUUID(), randomUUID()],
};
const authUserIds: string[] = [];
const escalationIds: string[] = [];
let admin: SupabaseClient<Database>;
let clinicianA: SupabaseClient<Database>;
let clinicianB: SupabaseClient<Database>;
let patientA: SupabaseClient<Database>;
let patientB: SupabaseClient<Database>;

suite("test_scenario_20_hosted_multiclinic_isolation", () => {
  beforeAll(async () => {
    const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
    const publishableKey = requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    const secretKey = requiredEnv("SUPABASE_SECRET_KEY");
    admin = createClient<Database>(url, secretKey, noSession());

    const suffix = randomUUID();
    const credentials = ["patient-a", "patient-b", "clinician-a", "clinician-b"].map((role) => ({
      email: `${role}-${suffix}@example.invalid`,
      password: `Tenant-${suffix}-9`,
    }));
    for (const credential of credentials) {
      const created = await admin.auth.admin.createUser({ ...credential, email_confirm: true });
      if (created.error || !created.data.user) throw new Error(`Unable to create ${credential.email}`);
      authUserIds.push(created.data.user.id);
    }

    patientA = createClient<Database>(url, publishableKey, noSession());
    patientB = createClient<Database>(url, publishableKey, noSession());
    clinicianA = createClient<Database>(url, publishableKey, noSession());
    clinicianB = createClient<Database>(url, publishableKey, noSession());
    await signIn(patientA, credentials[0]);
    await signIn(patientB, credentials[1]);
    await signIn(clinicianA, credentials[2]);
    await signIn(clinicianB, credentials[3]);

    await mustSucceed(admin.from("clinics").insert([
      clinicRow(0, suffix),
      clinicRow(1, suffix),
    ]));
    await mustSucceed(admin.from("lead_sessions").insert([
      leadRow(0),
      leadRow(1),
    ]));
    await mustSucceed(admin.from("patients").insert([
      { id: ids.patients[0], clinic_id: ids.clinics[0], auth_user_id: authUserIds[0] },
      { id: ids.patients[1], clinic_id: ids.clinics[1], auth_user_id: authUserIds[1] },
    ]));
    await mustSucceed(admin.from("patient_sessions").insert([
      sessionRow(0),
      sessionRow(1),
    ]));
    for (const index of [0, 1] as const) {
      await mustSucceed(admin.from("lead_sessions").update({
        status: "converted",
        converted_patient_id: ids.patients[index],
        converted_patient_session_id: ids.sessions[index],
        converted_at: new Date().toISOString(),
      }).eq("id", ids.leads[index]));
    }
    await mustSucceed(admin.from("clinic_memberships").insert([
      { clinic_id: ids.clinics[0], auth_user_id: authUserIds[2], role: "clinician" },
      { clinic_id: ids.clinics[1], auth_user_id: authUserIds[3], role: "clinician" },
    ]));
    await mustSucceed(admin.from("consent_events").insert([
      consentRow(0),
      consentRow(1),
    ]));
    await mustSucceed(admin.from("messages").insert([
      messageRow(0),
      messageRow(1),
    ]));
    await mustSucceed(admin.from("risk_assessments").insert([
      riskRow(0),
      riskRow(1),
    ]));

    const escalations = await admin.from("escalations").select("id, clinic_id").in("risk_assessment_id", ids.risks);
    if (escalations.error || escalations.data?.length !== 2) throw new Error("Escalation fixtures were not created.");
    fixtureEscalations.push(...escalations.data.map((row) => ({
      id: row.id,
      clinicId: row.clinic_id,
    })));
    escalationIds.push(...fixtureEscalations.map((row) => row.id));
    for (const escalation of escalations.data) {
      const updated = await admin.from("escalations").update({
        status: "queued",
        triage_summary_ciphertext: "synthetic-encrypted-summary",
        triage_summary_sha256: sha256(`summary:${escalation.id}`),
        profile_snapshot_ciphertext: "synthetic-encrypted-profile",
        profile_snapshot_sha256: sha256(`profile:${escalation.id}`),
        attribution_snapshot: {},
        response_min_hours: 12,
        response_max_hours: 18,
        response_expected_by: new Date(Date.now() + 18 * 3_600_000).toISOString(),
        sent_at: new Date().toISOString(),
      }).eq("id", escalation.id);
      await mustSucceed(updated);
    }
  }, 40_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("escalation_provenance").delete().in("escalation_id", escalationIds);
    await admin.from("escalations").delete().in("id", escalationIds);
    await admin.from("risk_assessments").delete().in("id", ids.risks);
    await admin.from("messages").delete().in("id", ids.messages);
    await admin.from("funnel_events").delete().in("lead_session_id", ids.leads);
    await admin.from("consent_events").delete().in("lead_session_id", ids.leads);
    await admin.from("lead_sessions").update({
      status: "active",
      converted_patient_id: null,
      converted_patient_session_id: null,
      converted_at: null,
    }).in("id", ids.leads);
    await admin.from("patient_sessions").delete().in("id", ids.sessions);
    await admin.from("clinic_memberships").delete().in("auth_user_id", authUserIds);
    await admin.from("patients").delete().in("id", ids.patients);
    await admin.from("lead_sessions").delete().in("id", ids.leads);
    await admin.from("clinics").delete().in("id", ids.clinics);
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
  }, 40_000);

  it("Clinic A clinician reads only Clinic A permitted records", async () => {
    await expectVisibleIds(clinicianA, "patients", ids.patients, [ids.patients[0]]);
    await expectVisibleIds(clinicianA, "messages", ids.messages, [ids.messages[0]]);
    await expectVisibleIds(clinicianA, "escalations", escalationIds, [escalationForClinic(0)]);
  });

  it("Clinic B clinician gets zero Clinic A records", async () => {
    await expectVisibleIds(clinicianB, "patients", ids.patients, [ids.patients[1]]);
    await expectVisibleIds(clinicianB, "messages", ids.messages, [ids.messages[1]]);
    await expectVisibleIds(clinicianB, "escalations", escalationIds, [escalationForClinic(1)]);
  });

  it("rejects a Clinic A clinician mutating a Clinic B escalation", async () => {
    const result = await clinicianA.rpc("acknowledge_escalation", {
      p_escalation_id: escalationForClinic(1),
    });
    expect(["P0020", "P0041"]).toContain(result.error?.code);
  });

  it("Patient A cannot retrieve Patient B data and vice versa", async () => {
    await expectVisibleIds(patientA, "patients", ids.patients, [ids.patients[0]]);
    await expectVisibleIds(patientA, "patient_sessions", ids.sessions, [ids.sessions[0]]);
    await expectVisibleIds(patientA, "messages", ids.messages, [ids.messages[0]]);
    await expectVisibleIds(patientB, "patients", ids.patients, [ids.patients[1]]);
    await expectVisibleIds(patientB, "patient_sessions", ids.sessions, [ids.sessions[1]]);
    await expectVisibleIds(patientB, "messages", ids.messages, [ids.messages[1]]);
  });
});

function clinicRow(index: 0 | 1, suffix: string): Database["public"]["Tables"]["clinics"]["Insert"] {
  return {
    id: ids.clinics[index],
    slug: `tenant-test-${index}-${suffix}`,
    name: `Synthetic Clinic ${index === 0 ? "A" : "B"}`,
    timezone: "Asia/Kuala_Lumpur",
  };
}

function leadRow(index: 0 | 1): Database["public"]["Tables"]["lead_sessions"]["Insert"] {
  return {
    id: ids.leads[index],
    clinic_id: ids.clinics[index],
    status: "active",
    source_channel: "website_widget",
    identity_level: "anonymous",
    landing_timestamp: new Date(Date.now() - 60_000).toISOString(),
    landing_context: {},
    request_fingerprint_hash: sha256(`fingerprint:${ids.leads[index]}`),
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

function sessionRow(index: 0 | 1): Database["public"]["Tables"]["patient_sessions"]["Insert"] {
  return {
    id: ids.sessions[index],
    clinic_id: ids.clinics[index],
    patient_id: ids.patients[index],
    origin_lead_session_id: ids.leads[index],
    acquisition_identity_level: "anonymous",
    current_identity_level: "authenticated",
    authentication_method: "email_password",
    identity_verified: true,
    memory_bootstrap_status: "completed",
    memory_bootstrap_completed_at: new Date().toISOString(),
  };
}

function consentRow(index: 0 | 1): Database["public"]["Tables"]["consent_events"]["Insert"] {
  return {
    clinic_id: ids.clinics[index],
    patient_id: ids.patients[index],
    lead_session_id: ids.leads[index],
    type: "healthcare_sharing",
    action: "granted",
    policy_version: "tenant-test",
    notice_version: "tenant-test",
    captured_via: "automated_test",
    evidence_metadata: {},
    idempotency_key: `tenant-test:${ids.leads[index]}`,
  };
}

function messageRow(index: 0 | 1): Database["public"]["Tables"]["messages"]["Insert"] {
  return {
    id: ids.messages[index],
    clinic_id: ids.clinics[index],
    patient_session_id: ids.sessions[index],
    actor: "patient",
    status: "completed",
    content_ciphertext: "synthetic-encrypted-message",
    content_sha256: sha256(`message:${ids.messages[index]}`),
    content_sealed: true,
    sequence_number: 1,
  };
}

function riskRow(index: 0 | 1): Database["public"]["Tables"]["risk_assessments"]["Insert"] {
  return {
    id: ids.risks[index],
    clinic_id: ids.clinics[index],
    patient_session_id: ids.sessions[index],
    message_id: ids.messages[index],
    risk_level: "high",
    risk_reason: "Synthetic tenant-isolation fixture",
    confidence: "high",
    escalation_required: true,
    rule_matches: ["synthetic_fixture"],
    pipeline_version: "tenant-test",
    provenance: { source: "deterministic" },
  };
}

function escalationForClinic(index: 0 | 1) {
  const prefix = ids.clinics[index];
  const row = fixtureEscalations.find((item) => item.clinicId === prefix);
  if (!row) throw new Error(`Missing Clinic ${index} escalation fixture.`);
  return row.id;
}

const fixtureEscalations: Array<{ id: string; clinicId: string }> = [];

async function expectVisibleIds(
  client: SupabaseClient<Database>,
  table: "patients" | "patient_sessions" | "messages" | "escalations",
  candidates: string[],
  expected: string[],
) {
  const result = await client.from(table).select("id").in("id", candidates);
  expect(result.error).toBeNull();
  expect((result.data ?? []).map((row) => row.id).sort()).toEqual([...expected].sort());
}

async function signIn(client: SupabaseClient<Database>, credentials: { email: string; password: string }) {
  const result = await client.auth.signInWithPassword(credentials);
  if (result.error) throw result.error;
}

async function mustSucceed(
  result: PromiseLike<{ error: { message: string } | null }> | { error: { message: string } | null },
) {
  const resolved = await result;
  if (resolved.error) throw new Error(resolved.error.message);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when RUN_HOSTED_TENANT_TESTS=1`);
  return value;
}

function noSession() {
  return { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
}
