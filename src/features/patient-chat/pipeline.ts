import {
  assessDeterministicRisk,
  DEGRADED_MODE_RESPONSE,
  decideModelRisk,
  fallbackRisk,
  HIGH_RISK_RESPONSE,
  isPatientResponseSafe,
  maxRiskDecision,
  MEDIUM_RISK_RESPONSE,
  REDACTION_FAILURE_RESPONSE,
  type ModelRiskProposal,
  type DeterministicRisk,
  type RiskDecision,
} from "../risk/policy";
import { assertPhiSafe, redactPhi, REDACTION_VERSION, type RedactionResult } from "../redaction/redact";
import { extractDeterministicMemory, normalizeModelMemoryProposal } from "../memory/extract";
import type { MemoryCurrentFact, MemoryProposal } from "@/src/types/memory";

export type PipelineKnowledgeSource = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  content: string;
  version: string;
};

export type ModelGeneration = {
  proposal: ModelRiskProposal;
  model: string;
  providerResponseId: string | null;
  durationMs: number;
};

export type PatientPipelineResult = {
  risk: RiskDecision;
  answer: string;
  citationSourceIds: string[];
  redaction: RedactionResult | null;
  sourceStatus: "completed" | "blocked";
  model: ModelGeneration | null;
  errorCode: string | null;
  memoryProposals: MemoryProposal[];
  degradedMode: boolean;
};

export async function runPatientSafetyPipeline(input: {
  message: string;
  sources: PipelineKnowledgeSource[];
  generate: (request: { redactedMessage: string; sources: PipelineKnowledgeSource[] }) => Promise<ModelGeneration>;
  redact?: typeof redactPhi;
  sourceMessageId?: string;
  currentMemory?: MemoryCurrentFact[];
  deterministicRisk?: DeterministicRisk | null;
}): Promise<PatientPipelineResult> {
  // The caller may precompute this before reserving a database turn. When it
  // does not, the raw message is still assessed here before redaction.
  const deterministic = input.deterministicRisk === undefined
    ? assessDeterministicRisk(input.message)
    : input.deterministicRisk;
  let redaction: RedactionResult;

  try {
    redaction = (input.redact ?? redactPhi)(input.message);
    assertPhiSafe(redaction.text);
  } catch {
    if (deterministic) {
      return {
        risk: {
          level: deterministic.level,
          reason: deterministic.reason,
          confidence: deterministic.confidence,
          escalationRequired: true,
          ruleMatches: [...deterministic.ruleMatches, "redaction_failure"],
          source: "deterministic",
        },
        answer:
          deterministic.level === "high"
            ? HIGH_RISK_RESPONSE
            : REDACTION_FAILURE_RESPONSE,
        citationSourceIds: [],
        redaction: null,
        sourceStatus: "blocked",
        model: null,
        errorCode: "redaction_failed",
        memoryProposals: [],
        degradedMode: false,
      };
    }
    return {
      risk: fallbackRisk("redaction_failure"),
      answer: REDACTION_FAILURE_RESPONSE,
      citationSourceIds: [],
      redaction: null,
      sourceStatus: "blocked",
      model: null,
      errorCode: "redaction_failed",
      memoryProposals: [],
      degradedMode: false,
    };
  }

  const deterministicMemory = input.sourceMessageId
    ? extractDeterministicMemory({
        message: redaction.text,
        sourceMessageId: input.sourceMessageId,
        currentFacts: input.currentMemory ?? [],
      })
    : [];

  if (deterministic?.level === "high") {
    return {
      risk: {
        level: deterministic.level,
        reason: deterministic.reason,
        confidence: deterministic.confidence,
        escalationRequired: true,
        ruleMatches: deterministic.ruleMatches,
        source: "deterministic",
      },
      answer: deterministic.level === "high" ? HIGH_RISK_RESPONSE : MEDIUM_RISK_RESPONSE,
      citationSourceIds: [],
      redaction,
      sourceStatus: "completed",
      model: null,
      errorCode: null,
      memoryProposals: deterministicMemory,
      degradedMode: false,
    };
  }

  try {
    const model = await input.generate({ redactedMessage: redaction.text, sources: input.sources });
    const safeAnswer = redactPhi(model.proposal.answer).text;
    const safeRiskReason = redactPhi(model.proposal.riskReason).text;
    assertPhiSafe(safeAnswer);
    assertPhiSafe(safeRiskReason);
    const safeProposal = {
      ...model.proposal,
      answer: safeAnswer,
      riskReason: safeRiskReason,
    };
    const modelMemory = (safeProposal.memoryProposals ?? []).flatMap((proposal): MemoryProposal[] => {
      if (!input.sourceMessageId) return [];
      const safeValue = redactPhi(proposal.value).text;
      assertPhiSafe(safeValue);
      const normalized = normalizeModelMemoryProposal({
        ...proposal,
        value: safeValue,
        sourceMessageId: input.sourceMessageId,
      });
      return normalized ? [normalized] : [];
    });
    const sourceIds = new Set(input.sources.map((source) => source.id));
    const uniqueCitationIds = [...new Set(safeProposal.citationSourceIds)];
    const citationsValid =
      safeProposal.riskLevel !== "low" ||
      (uniqueCitationIds.length > 0 &&
        uniqueCitationIds.every((sourceId) => sourceIds.has(sourceId)));
    const responseSafe = isPatientResponseSafe(safeProposal.answer);
    const modelRisk = decideModelRisk({ proposal: safeProposal, citationsValid, responseSafe });
    const risk = maxRiskDecision(deterministic, modelRisk);

    return {
      risk,
      answer:
        risk.level === "low"
          ? safeProposal.answer
          : risk.level === "high"
            ? HIGH_RISK_RESPONSE
            : MEDIUM_RISK_RESPONSE,
      citationSourceIds: risk.level === "low" ? uniqueCitationIds : [],
      redaction,
      sourceStatus: "completed",
      model,
      errorCode: risk.level === "low" ? null : risk.ruleMatches[0] ?? null,
      memoryProposals: mergeMemoryProposals(deterministicMemory, modelMemory),
      degradedMode: false,
    };
  } catch (error) {
    const code = getSafeModelErrorCode(error);
    return {
      risk: maxRiskDecision(deterministic, fallbackRisk("model_failure")),
      answer: DEGRADED_MODE_RESPONSE,
      citationSourceIds: [],
      redaction,
      sourceStatus: "completed",
      model: null,
      errorCode: code,
      memoryProposals: deterministicMemory,
      degradedMode: true,
    };
  }
}

function mergeMemoryProposals(deterministic: MemoryProposal[], model: MemoryProposal[]) {
  const merged = new Map<string, MemoryProposal>();
  for (const proposal of model) merged.set(`${proposal.kind}:${proposal.canonicalKey}`, proposal);
  for (const proposal of deterministic) merged.set(`${proposal.kind}:${proposal.canonicalKey}`, proposal);
  return [...merged.values()].slice(0, 12);
}

function getSafeModelErrorCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    ["configuration", "timeout", "provider", "invalid_output"].includes(String(error.code))
  ) {
    return String(error.code);
  }
  return "model_failure";
}

export { REDACTION_VERSION };
