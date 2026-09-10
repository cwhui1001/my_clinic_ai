import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { extractDeterministicMemory } from "../../src/features/memory/extract";

describe("test_scenario_17_guest_memory_conversion", () => {
  it("carries an extracted guest fact with its original GuestMessage id", () => {
    const guestMessageId = "10000000-0000-4000-8000-000000000017";
    const proposals = extractDeterministicMemory({
      message: "I have heavy bleeding since this morning",
      sourceMessageId: guestMessageId,
      currentFacts: [],
    });
    expect(proposals).toContainEqual(expect.objectContaining({
      sourceMessageId: guestMessageId,
      kind: "symptom",
    }));
  });

  it("uses the production conversion writer with retryable completion state", () => {
    const route = readFileSync(resolve("app/api/conversion/route.ts"), "utf8");
    const service = readFileSync(resolve("src/features/memory/service.ts"), "utf8");
    const migration = readFileSync(resolve("supabase/migrations/202609100003_living_memory_integrity.sql"), "utf8");
    expect(route.indexOf("convert_lead_to_patient")).toBeLessThan(route.indexOf("bootstrapGuestMemory(patientSessionId)"));
    expect(service).toContain('.eq("lead_session_id", session.origin_lead_session_id)');
    expect(service).toContain('sourceMessageId: message.id');
    expect(service).toContain('admin.rpc("apply_patient_memory"');
    expect(service).toContain('admin.rpc("record_memory_bootstrap_result"');
    expect(migration).toContain("memory_bootstrap_status");
    expect(migration).toContain("memory_bootstrap_attempts = memory_bootstrap_attempts + 1");
  });

  it("does not ask an authenticated patient to repeat guest context", () => {
    const page = readFileSync(resolve("app/patient/sessions/[sessionId]/page.tsx"), "utf8");
    const chat = readFileSync(resolve("app/components/patient-chat.tsx"), "utf8");
    expect(page).toContain("You do not need to repeat yourself");
    expect(chat).toContain("Add anything new or correct an earlier detail");
    expect(page).not.toMatch(/what brings you in today/i);
  });
});
