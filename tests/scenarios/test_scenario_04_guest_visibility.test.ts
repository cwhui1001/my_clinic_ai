import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const guestMigration = readFileSync(resolve("supabase/migrations/202609030001_guest_chat.sql"), "utf8");
const conversionMigration = readFileSync(resolve("supabase/migrations/202609030002_patient_conversion.sql"), "utf8");
const staffMigration = readFileSync(resolve("supabase/migrations/202609030006_escalation_clinician_dashboard.sql"), "utf8");
const staffService = readFileSync(resolve("src/features/staff/service.ts"), "utf8");

describe("test_scenario_04_guest_visibility", () => {
  it("denies direct guest-message reads and requires current consent for staff", () => {
    expect(guestMigration).toContain("revoke all on table public.messages from anon, authenticated");
    expect(staffMigration).toContain("create function public.has_consented_patient_access");
    expect(staffMigration).toContain("type = 'healthcare_sharing'");
    expect(staffMigration).toContain("status <> 'required'");
    expect(staffMigration).not.toContain("session_type = 'lead'");
  });

  it("requires guest value before server-side conversion and hides required escalations", () => {
    expect(conversionMigration).toContain("Guest value required before conversion");
    expect(conversionMigration).toContain("from public.funnel_events");
    expect(conversionMigration).toContain("name = 'value_event'");
    expect(staffService).toContain('.neq("status", "required")');
  });
});
