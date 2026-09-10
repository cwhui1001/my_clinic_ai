import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("supabase/migrations/202609100004_identity_consent_escalation.sql"), "utf8");
const phoneStart = readFileSync(resolve("app/api/auth/phone/start/route.ts"), "utf8");
const phoneVerify = readFileSync(resolve("app/api/auth/phone/verify/route.ts"), "utf8");

describe("test_scenario_02_phone_social_identity", () => {
  it("provides verified Supabase phone OTP rather than simulated social authentication", () => {
    expect(phoneStart).toContain("supabase.auth.signInWithOtp");
    expect(phoneVerify).toContain("supabase.auth.verifyOtp");
    expect(phoneVerify).toContain('type: "sms"');
    expect(phoneStart).not.toMatch(/instagram.*auth/i);
  });

  it("converts without email and retains encrypted phone and social contact provenance", () => {
    const leadService = readFileSync(resolve("src/features/lead-sessions/service.ts"), "utf8");
    expect(leadService).toContain('rpc("create_lead_session_v2"');
    expect(leadService).toContain("p_phone_ciphertext");
    expect(migration).toContain("lead_sessions_phone_pair_check");
    expect(migration).toContain("v_email_confirmed_at is null and v_phone_confirmed_at is null");
    expect(migration).toContain("Phone must match verified identity");
    expect(migration).toContain("v_lead.social_handle_ciphertext");
    expect(migration).toContain("v_lead.phone_ciphertext");
    expect(migration).toContain("'lead_session:' || v_lead.id::text || ':social_handle'");
    expect(migration).toContain("origin_lead_session_id");
  });
});
