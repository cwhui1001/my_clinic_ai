import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { hasMeaningfulValueEvent } from "../../src/features/guest-chat/policy";

const guestService = readFileSync(resolve("src/features/guest-chat/service.ts"), "utf8");
const guestUi = readFileSync(resolve("app/components/guest-chat.tsx"), "utf8");
const conversionRoute = readFileSync(resolve("app/api/conversion/route.ts"), "utf8");
const boundaryMigration = readFileSync(resolve("supabase/migrations/202609100006_guest_boundary_enforcement.sql"), "utf8");
const staffMigration = readFileSync(resolve("supabase/migrations/202609030006_escalation_clinician_dashboard.sql"), "utf8");

describe("test_scenario_04_value_and_guest_visibility", () => {
  it("does not unlock identity continuation without a committed meaningful value event", () => {
    expect(hasMeaningfulValueEvent(0)).toBe(false);
    expect(hasMeaningfulValueEvent(1)).toBe(true);
    expect(guestService).toContain("secureContinuationAvailable: hasMeaningfulValueEvent(valueEvents?.length ?? 0)");
    expect(guestService).toContain("p_requires_secure_continue: valueType !== null && requiresSecureContinue(intent)");
    expect(guestUi).toContain("if (reply.valueType || reply.assistantMessage.requiresSecureContinue)");
    expect(guestUi.indexOf("MessageBubble key={message.id}")).toBeLessThan(guestUi.indexOf("Ready for secure human follow-up?"));
  });

  it("enforces the value gate in the production conversion RPC rather than UI state", () => {
    expect(conversionRoute).toContain('"convert_lead_to_patient_v3"');
    expect(boundaryMigration).toContain("and name = 'value_event'");
    expect(boundaryMigration).toContain("Meaningful guest value required before conversion");
    expect(boundaryMigration).toContain("revoke execute on function public.convert_lead_to_patient_v2");
  });

  it("requires current same-clinic consent before staff can select converted guest messages", () => {
    expect(staffMigration).toContain("patient_sessions.origin_lead_session_id = messages.lead_session_id");
    expect(staffMigration).toContain("public.has_consented_patient_access(patient_sessions.clinic_id, patient_sessions.patient_id)");
    expect(staffMigration).not.toContain("session_type = 'lead'");
  });
});
