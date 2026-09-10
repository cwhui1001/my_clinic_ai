import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const guestMigration = readFileSync(resolve("supabase/migrations/202609030001_guest_chat.sql"), "utf8");
const staffMigration = readFileSync(resolve("supabase/migrations/202609030006_escalation_clinician_dashboard.sql"), "utf8");
const retentionMigration = readFileSync(resolve("supabase/migrations/202609100002_guest_retention_schedule.sql"), "utf8");
const boundaryMigration = readFileSync(resolve("supabase/migrations/202609100006_guest_boundary_enforcement.sql"), "utf8");
const lifecycleMigration = readFileSync(resolve("supabase/migrations/202609100005_continuity_reengagement.sql"), "utf8");
const guestService = readFileSync(resolve("src/features/guest-chat/service.ts"), "utf8");
const patientMigration = readFileSync(resolve("supabase/migrations/202609030002_patient_conversion.sql"), "utf8");

describe("test_scenario_12_guest_boundary_retention", () => {
  it("keeps guest content private until same-clinic consent and rate limits writes", () => {
    expect(guestMigration).toContain("revoke all on table public.messages from anon, authenticated");
    expect(guestMigration).toContain("if v_recent_count >= 30");
    expect(guestService).toContain('.rpc("append_guest_message"');
    expect(guestService.indexOf('.rpc("append_guest_message"')).toBeLessThan(guestService.indexOf("const generated = await createGuestModelReply"));
    expect(staffMigration).toContain("public.has_consented_patient_access(patient_sessions.clinic_id, patient_sessions.patient_id)");
    expect(staffMigration).not.toContain("session_type = 'lead'");
  });

  it("binds guest and patient reads to token-derived or authenticated ownership", () => {
    expect(guestService).toContain('.rpc("read_guest_messages"');
    expect(boundaryMigration).toContain("where recovery_token_hash = p_recovery_token_hash");
    expect(boundaryMigration).toContain("where lead_session_id = v_lead_id");
    expect(boundaryMigration).toContain("revoke execute on function public.read_guest_messages(text) from public, anon, authenticated");
    expect(guestMigration).toContain("where recovery_token_hash = p_recovery_token_hash");
    expect(patientMigration).toContain("patients.auth_user_id = (select auth.uid())");
  });

  it("schedules actual hosted cleanup instead of leaving an uncalled function", () => {
    expect(retentionMigration).toContain("cron.schedule");
    expect(retentionMigration).toContain("nightingale-expire-guest-sessions-hourly");
    expect(retentionMigration).toContain("select public.expire_lead_sessions()");
    expect(boundaryMigration).toContain("select public.run_guest_retention_cleanup()");
    expect(boundaryMigration).toContain("insert into public.guest_retention_runs");
    expect(lifecycleMigration).toContain("delete from public.messages");
    expect(lifecycleMigration).toContain("context_ciphertext = null");
    expect(lifecycleMigration).toContain("recovery_token_hash = null");
  });
});
