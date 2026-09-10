import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "../../src/types/database";

const enabled = process.env.RUN_HOSTED_BOUNDARY_TESTS === "1";
const suite = describe.skipIf(!enabled);
const ids = {
  leads: [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
  patients: [randomUUID(), randomUUID()],
  sessions: [randomUUID(), randomUUID()],
  messages: [randomUUID(), randomUUID(), randomUUID()],
};
const tokenHashes = ["guest-a", "guest-b", "rate", "expired"].map(sha256);
const authUserIds: string[] = [];
let admin: SupabaseClient<Database>;
let patientA: SupabaseClient<Database>;
let patientB: SupabaseClient<Database>;
let staff: SupabaseClient<Database>;
let anonymous: SupabaseClient<Database>;
let clinicId = "";
let retentionRunId: string | null = null;

suite("test_scenarios_04_12_hosted_boundary", () => {
  beforeAll(async () => {
    const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
    const publishableKey = requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    const secretKey = requiredEnv("SUPABASE_SECRET_KEY");
    admin = createClient<Database>(url, secretKey, noSession());
    anonymous = createClient<Database>(url, publishableKey, noSession());

    const clinic = await admin.from("clinics").select("id").order("created_at").limit(1).single();
    if (clinic.error || !clinic.data) throw new Error("Hosted boundary test requires a seeded clinic.");
    clinicId = clinic.data.id;

    const suffix = randomUUID();
    const credentials = ["patient-a", "patient-b", "staff"].map((role) => ({
      email: `${role}-${suffix}@example.invalid`,
      password: `Boundary-${suffix}-9`,
    }));
    for (const credential of credentials) {
      const created = await admin.auth.admin.createUser({ ...credential, email_confirm: true });
      if (created.error || !created.data.user) throw new Error(`Unable to create ${credential.email}`);
      authUserIds.push(created.data.user.id);
    }

    patientA = createClient<Database>(url, publishableKey, noSession());
    patientB = createClient<Database>(url, publishableKey, noSession());
    staff = createClient<Database>(url, publishableKey, noSession());
    await signIn(patientA, credentials[0]);
    await signIn(patientB, credentials[1]);
    await signIn(staff, credentials[2]);

    const now = Date.now();
    await mustSucceed(admin.from("lead_sessions").insert(ids.leads.map((id, index) => ({
      id,
      clinic_id: clinicId,
      status: "active" as const,
      source_channel: "website_widget" as const,
      identity_level: "anonymous" as const,
      landing_timestamp: new Date(now - (index === 3 ? 3_600_000 : 60_000)).toISOString(),
      landing_context: {},
      context_ciphertext: index === 3 ? "encrypted-expired-context" : null,
      recovery_token_hash: tokenHashes[index],
      request_fingerprint_hash: sha256(`fingerprint-${id}`),
      expires_at: new Date(index === 3 ? now - 1_000 : now + 3_600_000).toISOString(),
    }))));
    await mustSucceed(admin.from("patients").insert([
      { id: ids.patients[0], clinic_id: clinicId, auth_user_id: authUserIds[0] },
      { id: ids.patients[1], clinic_id: clinicId, auth_user_id: authUserIds[1] },
    ]));
    await mustSucceed(admin.from("patient_sessions").insert([
      sessionRow(0),
      sessionRow(1),
    ]));
    await mustSucceed(admin.from("clinic_memberships").insert({
      clinic_id: clinicId,
      auth_user_id: authUserIds[2],
      role: "staff",
    }));
    await mustSucceed(admin.from("messages").insert([
      messageRow(ids.messages[0], ids.leads[0], 1),
      messageRow(ids.messages[1], ids.leads[1], 1),
      messageRow(ids.messages[2], ids.leads[3], 1),
      ...Array.from({ length: 30 }, (_, index) => messageRow(randomUUID(), ids.leads[2], index + 1)),
    ]));
  }, 30_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("messages").delete().in("lead_session_id", ids.leads);
    await admin.from("consent_events").delete().in("lead_session_id", ids.leads);
    await admin.from("patient_sessions").delete().in("id", ids.sessions);
    await admin.from("clinic_memberships").delete().in("auth_user_id", authUserIds);
    await admin.from("patients").delete().in("id", ids.patients);
    await admin.from("lead_recovery_tombstones").delete().in("recovery_token_hash", tokenHashes);
    await admin.from("lead_sessions").delete().in("id", ids.leads);
    if (retentionRunId) await admin.from("guest_retention_runs").delete().eq("id", retentionRunId);
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
  }, 30_000);

  it("staff reads zero pre-consent guest rows and gains only current same-clinic consent", async () => {
    const before = await staff.from("messages").select("id").eq("id", ids.messages[0]);
    expect(before.error).toBeNull();
    expect(before.data).toEqual([]);

    await mustSucceed(admin.from("consent_events").insert({
      clinic_id: clinicId,
      patient_id: ids.patients[0],
      lead_session_id: ids.leads[0],
      type: "healthcare_sharing",
      action: "granted",
      policy_version: "hosted-boundary-test",
      notice_version: "hosted-boundary-test",
      captured_via: "automated_test",
      evidence_metadata: {},
      idempotency_key: `hosted-boundary:${ids.leads[0]}`,
    }));

    const after = await staff.from("messages").select("id").eq("id", ids.messages[0]);
    expect(after.error).toBeNull();
    expect(after.data?.map((row) => row.id)).toEqual([ids.messages[0]]);
  });

  it("guest direct access and cross-patient reads are denied", async () => {
    const guestRead = await anonymous.from("messages").select("id").eq("id", ids.messages[0]);
    expect(guestRead.error).not.toBeNull();

    const scopedGuestRead = await admin.rpc("read_guest_messages", {
      p_recovery_token_hash: tokenHashes[0],
    });
    expect(scopedGuestRead.error).toBeNull();
    expect(scopedGuestRead.data?.map((row) => row.id)).toEqual([ids.messages[0]]);

    const a = await patientA.from("messages").select("id").in("id", [ids.messages[0], ids.messages[1]]);
    const b = await patientB.from("messages").select("id").in("id", [ids.messages[0], ids.messages[1]]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(a.data?.map((row) => row.id)).toEqual([ids.messages[0]]);
    expect(b.data?.map((row) => row.id)).toEqual([ids.messages[1]]);

    const wrongToken = await admin.rpc("append_guest_message", {
      p_recovery_token_hash: sha256("not-any-session"),
      p_client_message_id: randomUUID(),
      p_content_ciphertext: "reservation",
      p_content_sha256: sha256("reservation"),
    });
    expect(wrongToken.error?.code).toBe("P0003");
  });

  it("enforces the database message limit on the production append RPC", async () => {
    const limited = await admin.rpc("append_guest_message", {
      p_recovery_token_hash: tokenHashes[2],
      p_client_message_id: randomUUID(),
      p_content_ciphertext: "reservation",
      p_content_sha256: sha256("reservation"),
    });
    expect(limited.error?.code).toBe("P0001");
  });

  it("executes expiry deletion and records a PHI-free successful cleanup run", async () => {
    const invokedAfter = new Date(Date.now() - 1_000).toISOString();
    const cleanup = await admin.rpc("run_guest_retention_cleanup");
    expect(cleanup.error).toBeNull();
    expect(cleanup.data).toBeGreaterThanOrEqual(1);

    const message = await admin.from("messages").select("id").eq("id", ids.messages[2]).maybeSingle();
    const lead = await admin.from("lead_sessions").select("status, context_ciphertext, recovery_token_hash").eq("id", ids.leads[3]).single();
    expect(message.data).toBeNull();
    expect(lead.data).toEqual({ status: "expired", context_ciphertext: null, recovery_token_hash: null });

    const run = await admin.from("guest_retention_runs").select("id, expired_session_count").gte("started_at", invokedAfter).order("completed_at", { ascending: false }).limit(1).single();
    expect(run.error).toBeNull();
    expect(run.data?.expired_session_count).toBeGreaterThanOrEqual(1);
    retentionRunId = run.data?.id ?? null;
  });
});

function sessionRow(index: 0 | 1): Database["public"]["Tables"]["patient_sessions"]["Insert"] {
  return {
    id: ids.sessions[index],
    clinic_id: clinicId,
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

function messageRow(id: string, leadSessionId: string, sequenceNumber: number): Database["public"]["Tables"]["messages"]["Insert"] {
  return {
    id,
    clinic_id: clinicId,
    lead_session_id: leadSessionId,
    actor: "guest",
    status: "completed",
    content_ciphertext: "synthetic-encrypted-content",
    content_sha256: sha256(`${id}:${sequenceNumber}`),
    content_sealed: true,
    sequence_number: sequenceNumber,
  };
}

async function signIn(client: SupabaseClient<Database>, credentials: { email: string; password: string }) {
  const result = await client.auth.signInWithPassword(credentials);
  if (result.error) throw result.error;
}

async function mustSucceed(result: PromiseLike<{ error: { message: string } | null }>) {
  const resolved = await result;
  if (resolved.error) throw new Error(resolved.error.message);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when RUN_HOSTED_BOUNDARY_TESTS=1`);
  return value;
}

function noSession() {
  return { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
}
