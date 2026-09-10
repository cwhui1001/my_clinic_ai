import { describe, expect, it, vi } from "vitest";

import { runPatientSafetyPipeline } from "../../src/features/patient-chat/pipeline";
import { classifyGuestIntent, findEmergencyRule } from "../../src/features/guest-chat/policy";
import { assessDeterministicRisk, HIGH_RISK_RESPONSE } from "../../src/features/risk/policy";

const messages = [
  ["en", "I have chest tightness since yesterday"],
  ["mixed", "Doc, saya rasa chest tightness sejak semalam, tapi tak berapa teruk lah"],
  ["ms", "Dada saya sakit, susah nak bernafas"],
  ["ms", "Saya mengalami sesak nafas"],
  ["zh-Hans", "我胸口痛，而且呼吸困难"],
  ["zh-Hant", "我胸悶，而且喘不過氣"],
] as const;

describe("test_scenario_09_multilingual_emergency_floor", () => {
  it.each(messages)("detects %s emergency text in guest and patient paths", (_language, message) => {
    expect(findEmergencyRule(message)).toBeTruthy();
    expect(classifyGuestIntent(message)).toBe("emergency");
    expect(assessDeterministicRisk(message)?.level).toBe("high");
  });

  it.each(messages)("shows local 999 guidance and makes zero model calls for %s", async (_language, message) => {
    const generate = vi.fn();
    const result = await runPatientSafetyPipeline({ message, sources: [], generate });
    expect(generate).not.toHaveBeenCalled();
    expect(result.risk.level).toBe("high");
    expect(result.answer).toBe(HIGH_RISK_RESPONSE);
    expect(result.answer).toContain("999");
  });
});
