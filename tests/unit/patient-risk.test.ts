import { describe, expect, it, vi } from "vitest";

import { runPatientSafetyPipeline, type PipelineKnowledgeSource } from "../../src/features/patient-chat/pipeline";
import { assessDeterministicRisk, HIGH_RISK_RESPONSE, MEDIUM_RISK_RESPONSE } from "../../src/features/risk/policy";

const source: PipelineKnowledgeSource = {
  id: "10000000-0000-4000-8000-000000000001",
  title: "Talking With Your Doctor",
  publisher: "MedlinePlus",
  url: "https://medlineplus.gov/talkingwithyourdoctor.html",
  content: "Prepare for a visit by listing concerns and noting when symptoms began.",
  version: "reviewed-2026-09-03",
};

const lowProposal = {
  proposal: {
    riskLevel: "low" as const,
    riskReason: "The message can be supported with general appointment preparation information.",
    confidence: "high" as const,
    answer: "It may help to note when the concern began and what makes it better or worse before speaking with the clinic.",
    asksForDiagnosis: false,
    asksForClarity: false,
    soundsUnsure: false,
    citationSourceIds: [source.id],
  },
  model: "test-model",
  providerResponseId: "response_test",
  durationMs: 10,
};

describe("deterministic patient risk gate", () => {
  it.each([
    "I have crushing chest pain",
    "I have difficulty breathing",
    "There is heavy bleeding",
    "I want to hurt myself",
  ])("never misses mandatory High-risk input: %s", (message) => {
    expect(assessDeterministicRisk(message)?.level).toBe("high");
  });

  it("routes an ambiguous chest symptom to Medium", () => {
    const result = assessDeterministicRisk("My chest feels funny");
    expect(result?.level).toBe("medium");
    expect(result?.ruleMatches).toContain("ambiguous_chest_symptom");
  });

  it("blocks the model and advice for mandatory High risk", async () => {
    const generate = vi.fn().mockResolvedValue(lowProposal);
    const result = await runPatientSafetyPipeline({
      message: "I have crushing chest pain",
      sources: [source],
      generate,
    });

    expect(generate).not.toHaveBeenCalled();
    expect(result.risk.level).toBe("high");
    expect(result.risk.escalationRequired).toBe(true);
    expect(result.answer).toBe(HIGH_RISK_RESPONSE);
    expect(result.citationSourceIds).toEqual([]);
  });

  it("never downgrades deterministic High risk when redaction also fails", async () => {
    const generate = vi.fn().mockResolvedValue(lowProposal);
    const result = await runPatientSafetyPipeline({
      message: "I have crushing chest pain and my email is john@example.com",
      sources: [source],
      generate,
      redact: (text) => ({ text, categories: [], counts: {}, version: "guest-phi-v1" }),
    });

    expect(generate).not.toHaveBeenCalled();
    expect(result.risk.level).toBe("high");
    expect(result.risk.escalationRequired).toBe(true);
    expect(result.answer).toBe(HIGH_RISK_RESPONSE);
  });
});

describe("redaction to model to server policy", () => {
  it("passes only redacted identifiers to the model", async () => {
    const generate = vi.fn().mockResolvedValue(lowProposal);
    const result = await runPatientSafetyPipeline({
      message: "My name is John Doe, IC S1234567A, phone +60 12-345 6789, email john@example.com. Help me prepare for my visit.",
      sources: [source],
      generate,
    });

    const modelInput = generate.mock.calls[0]?.[0].redactedMessage as string;
    expect(modelInput).toContain("[REDACTED]");
    expect(modelInput).not.toContain("John Doe");
    expect(modelInput).not.toContain("S1234567A");
    expect(modelInput).not.toContain("+60 12-345 6789");
    expect(modelInput).not.toContain("john@example.com");
    expect(result.risk.level).toBe("low");
    expect(result.citationSourceIds).toEqual([source.id]);
  });

  it("fails toward Medium when a Low draft lacks a valid citation", async () => {
    const generate = vi.fn().mockResolvedValue({
      ...lowProposal,
      proposal: { ...lowProposal.proposal, citationSourceIds: [] },
    });
    const result = await runPatientSafetyPipeline({ message: "Help me prepare for an appointment", sources: [source], generate });

    expect(result.risk.level).toBe("medium");
    expect(result.risk.escalationRequired).toBe(true);
    expect(result.answer).toBe(MEDIUM_RISK_RESPONSE);
  });

  it("fails toward Medium when the model times out", async () => {
    const generate = vi.fn().mockRejectedValue(Object.assign(new Error("private provider detail"), { code: "timeout" }));
    const result = await runPatientSafetyPipeline({ message: "Help me prepare for an appointment", sources: [source], generate });

    expect(result.risk.level).toBe("medium");
    expect(result.errorCode).toBe("timeout");
    expect(result.answer).toBe(MEDIUM_RISK_RESPONSE);
  });

  it("fails closed when redaction cannot be verified", async () => {
    const generate = vi.fn().mockResolvedValue(lowProposal);
    const result = await runPatientSafetyPipeline({
      message: "Contact me at john@example.com",
      sources: [source],
      generate,
      redact: (text) => ({ text, categories: [], counts: {}, version: "guest-phi-v1" }),
    });

    expect(generate).not.toHaveBeenCalled();
    expect(result.sourceStatus).toBe("blocked");
    expect(result.risk.level).toBe("medium");
    expect(result.errorCode).toBe("redaction_failed");
  });

  it("suppresses unsafe diagnostic output", async () => {
    const generate = vi.fn().mockResolvedValue({
      ...lowProposal,
      proposal: { ...lowProposal.proposal, answer: "You definitely have an infection." },
    });
    const result = await runPatientSafetyPipeline({ message: "Help me understand what to discuss", sources: [source], generate });

    expect(result.risk.level).toBe("medium");
    expect(result.answer).toBe(MEDIUM_RISK_RESPONSE);
    expect(result.risk.ruleMatches).toContain("unsafe_draft");
  });
});
