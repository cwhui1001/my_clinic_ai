import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("supabase/migrations/202609030006_escalation_clinician_dashboard.sql"), "utf8");
const staffService = readFileSync(resolve("src/features/staff/service.ts"), "utf8");
const memoryService = readFileSync(resolve("src/features/memory/service.ts"), "utf8");

describe("test_scenario_20_cross_clinic_isolation", () => {
  it("derives staff tenant access from auth.uid and same-clinic membership", () => {
    expect(migration).toContain("auth_user_id = auth.uid()");
    expect(migration).toContain("public.has_active_clinic_membership(p_clinic_id)");
    expect(migration).toContain("public.has_consented_patient_access(clinic_id, patient_id)");
    expect(migration).toContain("revoke all on table public.escalations from anon, authenticated");
  });

  it("uses RLS for user-facing reads and scopes the remaining admin lookup", () => {
    expect(memoryService).toContain("createSupabaseServerClient");
    expect(memoryService.slice(0, memoryService.indexOf("export async function bootstrapGuestMemory"))).not.toContain("createAdminClient();");
    expect(staffService).toContain('.eq("clinic_id", escalation.clinic_id)');
    expect(staffService.indexOf("const supabase = await createSupabaseServerClient()"))
      .toBeLessThan(staffService.indexOf("const admin = createAdminClient()"));
  });
});
