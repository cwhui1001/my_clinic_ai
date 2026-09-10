import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const staffService = readFileSync(resolve("src/features/staff/service.ts"), "utf8");
const staffAuth = readFileSync(resolve("src/features/staff/auth.ts"), "utf8");
const patientService = readFileSync(resolve("src/features/patient-sessions/service.ts"), "utf8");
const patientChat = readFileSync(resolve("src/features/patient-chat/service.ts"), "utf8");
const staffMigration = readFileSync(resolve("supabase/migrations/202609030006_escalation_clinician_dashboard.sql"), "utf8");
const patientMigration = readFileSync(resolve("supabase/migrations/202609030002_patient_conversion.sql"), "utf8");
const protectedRoutes = [
  "app/api/patient/escalations/[escalationId]/send/route.ts",
  "app/api/patient/sessions/[sessionId]/messages/route.ts",
  "app/api/patient/push-subscriptions/route.ts",
  "app/api/staff/escalations/[escalationId]/acknowledge/route.ts",
  "app/api/staff/escalations/[escalationId]/close/route.ts",
  "app/api/staff/escalations/[escalationId]/responses/route.ts",
].map((path) => readFileSync(resolve(path), "utf8")).join("\n");

describe("test_scenario_20_multiclinic_isolation", () => {
  it("derives staff clinic scope from auth.uid memberships and current consent", () => {
    expect(staffMigration).toContain("auth_user_id = auth.uid()");
    expect(staffMigration).toContain("public.has_active_clinic_membership(p_clinic_id)");
    expect(staffMigration).toContain("consent_events.clinic_id = p_clinic_id");
    expect(staffMigration).toContain("consent_events.patient_id = p_patient_id");
    expect(staffService).toContain("const memberships = await getStaffMemberships()");
    expect(staffService).toContain("const supabase = await createSupabaseServerClient()");
    expect(staffAuth).toContain('.from("clinic_memberships")');
    expect(staffAuth).toContain('.eq("active", true)');
  });

  it("keeps patient records scoped to the authenticated owner", () => {
    expect(patientMigration).toContain("patients.auth_user_id = (select auth.uid())");
    expect(patientService.indexOf('.from("patient_sessions")')).toBeLessThan(patientService.indexOf("createAdminClient()"));
    expect(patientService).toContain('.eq("id", sessionId)');
    expect(patientChat.indexOf('.rpc("append_patient_message"')).toBeLessThan(patientChat.indexOf("const admin = createAdminClient()"));
  });

  it("does not accept clinic_id on protected patient or staff routes", () => {
    expect(protectedRoutes).not.toMatch(/clinic_?id/i);
    expect(protectedRoutes).toContain("escalationId");
    expect(protectedRoutes).toContain("sessionId");
  });

  it("uses the service role only after an authenticated record establishes scope", () => {
    const escalationLookup = staffService.indexOf('.from("escalations")');
    const staffAdmin = staffService.indexOf("createAdminClient()");
    expect(escalationLookup).toBeGreaterThan(-1);
    expect(staffAdmin).toBeGreaterThan(escalationLookup);
    expect(staffService).toContain('.eq("clinic_id", escalation.clinic_id)');
    expect(patientService).toContain("Use the privileged client only after RLS has proven this user owns the session.");
  });
});
