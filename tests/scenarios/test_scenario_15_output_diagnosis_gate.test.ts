import { describe, expect, it, vi } from "vitest";

import { isGuestResponseSafe } from "../../src/features/guest-chat/policy";
import { runPatientSafetyPipeline, type PipelineKnowledgeSource } from "../../src/features/patient-chat/pipeline";
import { MEDIUM_RISK_RESPONSE } from "../../src/features/risk/policy";

const source: PipelineKnowledgeSource = {
  id: "10000000-0000-4000-8000-000000000001",
  title: "Approved source",
  publisher: "Clinic",
  url: "https://example.test/source",
  content: "General visit preparation information.",
  version: "v1",
};

const unsafeAnswers = [
  "This is likely gastritis, not cardiac.",
  "This sounds like angina, likely not a heart attack.",
  "Your symptoms are consistent with an infection.",
];

describe("test_scenario_15_output_diagnosis_gate", () => {
  it.each(unsafeAnswers)("blocks diagnostic guest output: %s", (answer) => {
    expect(isGuestResponseSafe(answer)).toBe(false);
  });

  it.each(unsafeAnswers)("replaces diagnostic patient output before rendering: %s", async (answer) => {
    const generate = vi.fn().mockResolvedValue({
      proposal: {
        riskLevel: "low",
        riskReason: "Model claimed low",
        confidence: "high",
        answer,
        asksForDiagnosis: false,
        asksForClarity: false,
        soundsUnsure: false,
        citationSourceIds: [source.id],
      },
      model: "test",
      providerResponseId: null,
      durationMs: 1,
    });
    const result = await runPatientSafetyPipeline({ message: "Help me understand this", sources: [source], generate });
    expect(result.risk.level).toBe("medium");
    expect(result.risk.ruleMatches).toContain("unsafe_draft");
    expect(result.answer).toBe(MEDIUM_RISK_RESPONSE);
    expect(result.answer).not.toContain(answer);
  });
});
