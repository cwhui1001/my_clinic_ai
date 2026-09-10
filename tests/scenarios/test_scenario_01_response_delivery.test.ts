import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildResponseNotificationPayload } from "../../src/features/notifications/payload";
import { parsePatientReturnPath } from "../../src/features/auth/return-path";

const migration = readFileSync(resolve("supabase/migrations/202609100005_continuity_reengagement.sql"), "utf8");

describe("test_scenario_01_response_delivery", () => {
  it("persists the response, timestamp, and PHI-free notification job in one transaction", () => {
    expect(migration).toContain("clinician_responses_enqueue_notification");
    expect(migration).toContain("clinician_response_at = coalesce(clinician_response_at, new.created_at)");
    expect(migration).toContain("insert into public.notification_jobs");
    expect(migration).toContain("unique references public.clinician_responses");
  });

  it("sends neutral copy to an authenticated exact-conversation deep link", () => {
    const payload = buildResponseNotificationPayload("10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002");
    expect(payload.body).toBe("A clinic response is available in your secure conversation.");
    expect(payload.url).toBe("/login?next=%2Fpatient%2Fsessions%2F10000000-0000-4000-8000-000000000001%23escalation-10000000-0000-4000-8000-000000000002");
    expect(JSON.stringify(payload)).not.toMatch(/diagnosis|medication|symptom|patient name/i);
    const page = readFileSync(resolve("app/patient/sessions/[sessionId]/page.tsx"), "utf8");
    const service = readFileSync(resolve("src/features/patient-sessions/service.ts"), "utf8");
    expect(page).toContain("getPatientSessionView(sessionId)");
    expect(service).toContain("getVerifiedUser()");
    const loginPage = readFileSync(resolve("app/login/page.tsx"), "utf8");
    const loginRoute = readFileSync(resolve("app/api/auth/patient-login/route.ts"), "utf8");
    expect(loginPage).toContain("parsePatientReturnPath");
    expect(loginRoute).toContain("signInWithPassword");
    expect(loginRoute).toContain("parsePatientReturnPath");
    expect(parsePatientReturnPath("https://attacker.example/patient/sessions/10000000-0000-4000-8000-000000000001")).toBeNull();
    expect(parsePatientReturnPath("/staff/escalations/10000000-0000-4000-8000-000000000002")).toBeNull();
    expect(parsePatientReturnPath("/patient/sessions/10000000-0000-4000-8000-000000000001#escalation-10000000-0000-4000-8000-000000000002")).not.toBeNull();
  });

  it("makes clinician responses visible after authenticated return and records delivery outcome", () => {
    const escalationService = readFileSync(resolve("src/features/escalation/service.ts"), "utf8");
    const deliveryService = readFileSync(resolve("src/features/notifications/service.ts"), "utf8");
    expect(escalationService).toContain('.from("clinician_responses")');
    expect(deliveryService).toContain('.from("notification_attempts")');
    expect(deliveryService).toContain('"no_subscription"');
    expect(deliveryService).toContain('"transport_unavailable"');
  });

  it("retains the submitted form across the asynchronous response request", () => {
    const actions = readFileSync(resolve("app/components/escalation-actions.tsx"), "utf8");
    const capture = actions.indexOf("const formElement = event.currentTarget");
    const request = actions.indexOf("await fetch", capture);
    const reset = actions.indexOf("formElement.reset()", request);

    expect(capture).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(request);
    expect(request).toBeLessThan(reset);
    expect(actions).not.toContain("event.currentTarget.reset()");
  });
});
