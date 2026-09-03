import {
  assessDeterministicRisk,
  decideModelRisk,
  fallbackRisk,
  HIGH_RISK_RESPONSE,
  isPatientResponseSafe,
  MEDIUM_RISK_RESPONSE,
  REDACTION_FAILURE_RESPONSE,
  type ModelRiskProposal,
  type RiskDecision,
} from "../risk/policy";
import { assertPhiSafe, redactPhi, REDACTION_VERSION, type RedactionResult } from "../redaction/redact";

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
};

export async function runPatientSafetyPipeline(input: {
  message: string;
  sources: PipelineKnowledgeSource[];
  generate: (request: { redactedMessage: string; sources: PipelineKnowledgeSource[] }) => Promise<ModelGeneration>;
  redact?: typeof redactPhi;
}): Promise<PatientPipelineResult> {
  const deterministic = assessDeterministicRisk(input.message);
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
    };
  }

  if (deterministic) {
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
    const sourceIds = new Set(input.sources.map((source) => source.id));
    const uniqueCitationIds = [...new Set(safeProposal.citationSourceIds)];
    const citationsValid =
      safeProposal.riskLevel !== "low" ||
      (uniqueCitationIds.length > 0 &&
        uniqueCitationIds.every((sourceId) => sourceIds.has(sourceId)));
    const responseSafe = isPatientResponseSafe(safeProposal.answer);
    const risk = decideModelRisk({ proposal: safeProposal, citationsValid, responseSafe });

    return {
      risk,
      answer: risk.level === "low" ? safeProposal.answer : MEDIUM_RISK_RESPONSE,
      citationSourceIds: risk.level === "low" ? uniqueCitationIds : [],
      redaction,
      sourceStatus: "completed",
      model,
      errorCode: risk.level === "low" ? null : risk.ruleMatches[0] ?? null,
    };
  } catch (error) {
    const code = getSafeModelErrorCode(error);
    return {
      risk: fallbackRisk("model_failure"),
      answer: MEDIUM_RISK_RESPONSE,
      citationSourceIds: [],
      redaction,
      sourceStatus: "completed",
      model: null,
      errorCode: code,
    };
  }
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
