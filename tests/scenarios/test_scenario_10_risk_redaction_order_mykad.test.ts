import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { runPatientSafetyPipeline } from "../../src/features/patient-chat/pipeline";

describe("test_scenario_10_risk_redaction_order_mykad", () => {
  it("sends a redacted MyKad to the provider and never the raw identifier", async () => {
    const generate = vi.fn().mockImplementation(async ({ redactedMessage }) => {
      expect(redactedMessage).toContain("[REDACTED]");
      expect(redactedMessage).not.toContain("900101-14-5678");
      return {
        proposal: {
          riskLevel: "medium",
          riskReason: "Needs review",
          confidence: "med",
          answer: "No clinical advice.",
          asksForDiagnosis: false,
          asksForClarity: false,
          soundsUnsure: false,
          citationSourceIds: [],
        },
        model: "test",
        providerResponseId: null,
        durationMs: 1,
      };
    });
    await runPatientSafetyPipeline({
      message: "My MyKad is 900101-14-5678. Help me prepare for my visit.",
      sources: [],
      generate,
    });
    expect(generate).toHaveBeenCalledOnce();
  });

  it("fails closed with no provider call when redaction verification fails", async () => {
    const generate = vi.fn();
    const result = await runPatientSafetyPipeline({
      message: "My MyKad is 900101-14-5678",
      sources: [],
      generate,
      redact: (text) => ({ text, categories: [], counts: {}, version: "guest-phi-v1" }),
    });
    expect(generate).not.toHaveBeenCalled();
    expect(result.sourceStatus).toBe("blocked");
    expect(result.errorCode).toBe("redaction_failed");
  });

  it("reserves non-PHI content and seals raw ciphertext only after pipeline completion", () => {
    const patientService = readFileSync(resolve("src/features/patient-chat/service.ts"), "utf8");
    const guestService = readFileSync(resolve("src/features/guest-chat/service.ts"), "utf8");
    expect(patientService.indexOf("assessDeterministicRisk(input.message)")).toBeLessThan(patientService.indexOf("append_patient_message"));
    expect(patientService).toContain("SAFETY_RESERVATION_PLACEHOLDER");
    expect(patientService.indexOf("runPatientSafetyPipeline")).toBeLessThan(patientService.indexOf('rpc("seal_patient_message"'));
    expect(patientService.indexOf('rpc("seal_patient_message"')).toBeLessThan(patientService.indexOf('rpc("complete_patient_turn_with_memory"'));
    expect(guestService.indexOf("findEmergencyRule(input.message)")).toBeLessThan(guestService.indexOf("append_guest_message"));
    expect(guestService).toContain("SAFETY_RESERVATION_PLACEHOLDER");
    expect(guestService.indexOf("redactPhi(input.message)")).toBeLessThan(guestService.indexOf("const generated = await createGuestModelReply"));
    expect(guestService.indexOf("const generated = await createGuestModelReply")).toBeLessThan(guestService.indexOf('rpc("seal_guest_message"'));
    expect(guestService.indexOf('rpc("seal_guest_message"')).toBeLessThan(guestService.indexOf('rpc("complete_guest_turn"'));
  });
});
