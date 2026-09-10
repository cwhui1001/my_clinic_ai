import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const guestMigration = readFileSync(resolve("supabase/migrations/202609030001_guest_chat.sql"), "utf8");
const staffMigration = readFileSync(resolve("supabase/migrations/202609030006_escalation_clinician_dashboard.sql"), "utf8");
const retentionMigration = readFileSync(resolve("supabase/migrations/202609100002_guest_retention_schedule.sql"), "utf8");

describe("test_scenario_12_guest_boundary_retention", () => {
  it("keeps guest content private until same-clinic consent and rate limits writes", () => {
    expect(guestMigration).toContain("revoke all on table public.messages from anon, authenticated");
    expect(guestMigration).toContain("if v_recent_count >= 30");
    expect(staffMigration).toContain("public.has_consented_patient_access(patient_sessions.clinic_id, patient_sessions.patient_id)");
    expect(staffMigration).not.toContain("session_type = 'lead'");
  });

  it("schedules actual hosted cleanup instead of leaving an uncalled function", () => {
    expect(retentionMigration).toContain("cron.schedule");
    expect(retentionMigration).toContain("nightingale-expire-guest-sessions-hourly");
    expect(retentionMigration).toContain("select public.expire_lead_sessions()");
  });
});
