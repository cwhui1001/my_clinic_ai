import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("supabase/migrations/202609030002_patient_conversion.sql"), "utf8");

describe("guest-to-patient database contract", () => {
  it("uses one guarded, idempotent database transaction", () => {
    expect(migration).toContain("create function public.convert_lead_to_patient");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("for update");
    expect(migration).toContain("conversion_idempotency_hash");
    expect(migration).toContain("grant execute on function public.convert_lead_to_patient");
  });

  it("gates conversion on verified identity, value, and explicit consent", () => {
    expect(migration).toContain("email_confirmed_at");
    expect(migration).toContain("Explicit consent required");
    expect(migration).toContain("Guest value required before conversion");
    expect(migration).toContain("'healthcare_sharing'");
  });

  it("preserves the lead relationship and emits conversion funnel events", () => {
    expect(migration).toContain("origin_lead_session_id");
    expect(migration).toContain("'consented'");
    expect(migration).toContain("'patient_created'");
    expect(migration).toContain("messages_select_converted_origin");
  });
});
