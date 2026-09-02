import { describe, expect, it } from "vitest";

import {
  buildTrustResponse,
  classifyGuestIntent,
  findEmergencyRule,
  isGuestResponseSafe,
  requiresSecureContinue,
  valueTypeForIntent,
} from "../../src/features/guest-chat/policy";

describe("guest chat safety policy", () => {
  it.each([
    ["I have crushing chest pain", "crushing_chest_pain"],
    ["I have difficulty breathing", "difficulty_breathing"],
    ["There is heavy bleeding", "heavy_bleeding"],
    ["I want to hurt myself", "self_harm"],
  ])("detects mandatory emergency phrase %s", (text, expectedRule) => {
    expect(findEmergencyRule(text)).toBe(expectedRule);
    expect(classifyGuestIntent(text)).toBe("emergency");
  });

  it("creates the required honest trust disclosure", () => {
    const response = buildTrustResponse("Example Clinic");

    expect(classifyGuestIntent("Are you a real doctor?")).toBe("trust");
    expect(response).toContain("not a doctor");
    expect(response).toContain("Example Clinic is the healthcare provider");
    expect(response).toContain("human care-team member");
  });

  it("turns a personal clinical statement into summary mode", () => {
    const intent = classifyGuestIntent("I have had pelvic pain for two days");

    expect(intent).toBe("clinical_summary");
    expect(valueTypeForIntent(intent)).toBe("concern_summary");
    expect(requiresSecureContinue(intent)).toBe(true);
  });

  it("rejects diagnostic and medication-change output", () => {
    expect(isGuestResponseSafe("You have an infection.")).toBe(false);
    expect(isGuestResponseSafe("Stop your medication today.")).toBe(false);
    expect(isGuestResponseSafe("IVF is a type of fertility treatment.")).toBe(true);
  });
});
