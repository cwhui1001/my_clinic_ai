import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("supabase/migrations/202609030004_patient_risk_pipeline.sql"), "utf8");

describe("patient risk database contract", () => {
  it("persists one risk assessment per patient message before the assistant insert", () => {
    const riskInsert = migration.indexOf("insert into public.risk_assessments");
    const assistantInsert = migration.indexOf("insert into public.messages (", riskInsert);
    expect(riskInsert).toBeGreaterThan(0);
    expect(assistantInsert).toBeGreaterThan(riskInsert);
    expect(migration).toContain("message_id uuid not null unique");
  });

  it("requires citations for Low-risk responses and validates source hashes", () => {
    expect(migration).toContain("Low-risk response requires a citation");
    expect(migration).toContain("Invalid citation provenance");
    expect(migration).toContain("quoted_span_hash");
  });

  it("keeps direct patient writes behind authenticated or service-only functions", () => {
    expect(migration).toContain("grant execute on function public.append_patient_message");
    expect(migration).toContain("grant execute on function public.complete_patient_turn");
    expect(migration).toContain("messages_select_own_patient_session");
  });
});
