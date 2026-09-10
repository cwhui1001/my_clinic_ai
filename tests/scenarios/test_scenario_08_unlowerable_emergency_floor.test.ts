import { describe, expect, it, vi } from "vitest";

import { runPatientSafetyPipeline, type PipelineKnowledgeSource } from "../../src/features/patient-chat/pipeline";
import { assessDeterministicRisk, HIGH_RISK_RESPONSE, maxRiskDecision, type RiskDecision } from "../../src/features/risk/policy";
import { EMERGENCY_RESPONSE, guestRedactionFailureResponse } from "../../src/features/guest-chat/policy";

const source: PipelineKnowledgeSource = {
  id: "10000000-0000-4000-8000-000000000001",
  title: "Approved source",
  publisher: "Clinic",
  url: "https://example.test/source",
  content: "Write down when a concern began before a clinic visit.",
  version: "v1",
};

const lowModel = {
  proposal: {
    riskLevel: "low" as const,
    riskReason: "Low proposal",
    confidence: "high" as const,
    answer: "Write down when the concern began.",
    asksForDiagnosis: false,
    asksForClarity: false,
    soundsUnsure: false,
    citationSourceIds: [source.id],
  },
  model: "test",
  providerResponseId: null,
  durationMs: 1,
};

describe("test_scenario_08_unlowerable_emergency_floor", () => {
  it("never calls the model or lowers a raw deterministic High", async () => {
    const generate = vi.fn().mockResolvedValue(lowModel);
    const result = await runPatientSafetyPipeline({
      message: "I am having crushing chest pain",
      sources: [source],
      generate,
    });

    expect(generate).not.toHaveBeenCalled();
    expect(result.risk.level).toBe("high");
    expect(result.answer).toBe(HIGH_RISK_RESPONSE);
  });

  it("computes finalRisk as the maximum when a Medium floor meets a Low model", async () => {
    const generate = vi.fn().mockResolvedValue(lowModel);
    const result = await runPatientSafetyPipeline({
      message: "My chest feels funny",
      sources: [source],
      generate,
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(result.risk.level).toBe("medium");
    expect(result.risk.ruleMatches).toContain("ambiguous_chest_symptom");
  });

  it("cannot lower deterministic risk through a candidate decision", () => {
    const candidate: RiskDecision = {
      level: "low",
      reason: "model low",
      confidence: "high",
      escalationRequired: false,
      ruleMatches: [],
      source: "model",
    };
    expect(maxRiskDecision(assessDeterministicRisk("My chest feels funny"), candidate).level).toBe("medium");
  });

  it("keeps guest emergency guidance when redaction fails", () => {
    expect(guestRedactionFailureResponse("emergency")).toBe(EMERGENCY_RESPONSE);
    expect(guestRedactionFailureResponse("emergency")).toContain("999");
  });
});
