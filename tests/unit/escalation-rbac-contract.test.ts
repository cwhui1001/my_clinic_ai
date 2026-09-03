import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("supabase/migrations/202609030006_escalation_clinician_dashboard.sql"), "utf8");

describe("escalation and clinician RBAC database contract", () => {
  it("creates required escalations from risk and queues only a complete immutable snapshot", () => {
    expect(migration).toContain("after insert on public.risk_assessments");
    expect(migration).toContain("status = 'required'");
    expect(migration).toContain("triage_summary_ciphertext");
    expect(migration).toContain("profile_snapshot_ciphertext");
    expect(migration).toContain("attribution_snapshot = jsonb_build_object");
    expect(migration).toContain("Trigger provenance required");
    expect(migration).toContain("'escalation_sent'");
  });

  it("enforces same-clinic active membership and current consent", () => {
    expect(migration).toContain("create function public.has_consented_patient_access");
    expect(migration).toContain("auth_user_id = auth.uid()");
    expect(migration).toContain("and active = true");
    expect(migration).toContain(") = 'granted', false)");
    expect(migration).toContain("is distinct from 'granted'::public.consent_action");
    expect(migration).toContain("status <> 'required'");
  });

  it("allows only Nurses and Clinicians to author protected responses", () => {
    expect(migration).toContain("and role in ('nurse', 'clinician')");
    expect(migration).toContain("insert into public.clinician_responses");
    expect(migration).toContain("set status = 'responded'");
    expect(migration).toContain("create function public.close_escalation");
  });

  it("keeps mutations behind authenticated functions and denies direct table writes", () => {
    expect(migration).toContain("revoke all on table public.escalations from anon, authenticated");
    expect(migration).toContain("grant execute on function public.queue_escalation");
    expect(migration).toContain("grant execute on function public.respond_to_escalation");
  });
});
