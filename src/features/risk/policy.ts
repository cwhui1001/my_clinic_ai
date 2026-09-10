import type { MemoryKind, MemoryStatus, ResponseConfidence, RiskLevel } from "@/src/types/database";
import { findEmergencyMatches } from "./emergency-rules";
import { isPatientFacingOutputSafe } from "./output-safety";

export const RISK_PIPELINE_VERSION = "patient-risk-v2-max-floor-en-ms-zh";
export const PATIENT_PROMPT_VERSION = "patient-safe-response-memory-v2";

type RiskRule = {
  id: string;
  level: Exclude<RiskLevel, "low">;
  pattern: RegExp;
};

const RISK_RULES: RiskRule[] = [
  { id: "ambiguous_chest_symptom", level: "medium", pattern: /\b(?:my\s+)?chest\s+(?:feels?\s+funny|discomfort|tightness|ache)\b/i },
  { id: "nonsevere_bleeding", level: "medium", pattern: /\bbleed(?:ing)?\b/i },
  { id: "faint_or_dizzy", level: "medium", pattern: /\b(?:faint(?:ed|ing)?|very dizzy|lightheaded)\b/i },
  { id: "diagnosis_request", level: "medium", pattern: /\b(?:diagnos(?:e|is)|what do i have|do i have\s+\w+)\b/i },
  { id: "medication_change_request", level: "medium", pattern: /\b(?:should i|can i)\s+(?:start|stop|increase|decrease|change|double)\b.*\b(?:medicine|medication|dose|pill)\w*\b/i },
  { id: "expressed_uncertainty", level: "medium", pattern: /\b(?:i(?:'m| am)\s+not sure|i am unsure|need (?:more )?clarity)\b/i },
];

export type DeterministicRisk = {
  level: Exclude<RiskLevel, "low">;
  reason: string;
  confidence: ResponseConfidence;
  ruleMatches: string[];
};

export type ModelRiskProposal = {
  riskLevel: RiskLevel;
  riskReason: string;
  confidence: ResponseConfidence;
  answer: string;
  asksForDiagnosis: boolean;
  asksForClarity: boolean;
  soundsUnsure: boolean;
  citationSourceIds: string[];
  memoryProposals?: Array<{
    kind: MemoryKind;
    canonicalKey: string;
    value: string;
    status: MemoryStatus;
    confidence: ResponseConfidence;
    effectiveAt: string | null;
  }>;
};

export type RiskDecision = {
  level: RiskLevel;
  reason: string;
  confidence: ResponseConfidence;
  escalationRequired: boolean;
  ruleMatches: string[];
  source: "deterministic" | "model" | "fallback";
};

export function assessDeterministicRisk(text: string): DeterministicRisk | null {
  const emergencyMatches = findEmergencyMatches(text);
  const policyMatches = RISK_RULES.filter((rule) => rule.pattern.test(text));
  if (!emergencyMatches.length && !policyMatches.length) return null;
  const level = emergencyMatches.length ? "high" : "medium";
  return {
    level,
    reason:
      level === "high"
        ? "A deterministic urgent-symptom rule matched."
        : "The message needs human assessment because it is ambiguous or requests clinical judgment.",
    confidence: "high",
    ruleMatches: [
      ...emergencyMatches.map((rule) => rule.id),
      ...policyMatches.map((rule) => rule.id),
    ],
  };
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export function maxRiskDecision(
  deterministic: DeterministicRisk | null,
  candidate: RiskDecision,
): RiskDecision {
  if (!deterministic) return candidate;
  const deterministicWins =
    RISK_ORDER[deterministic.level] >= RISK_ORDER[candidate.level];
  const level = deterministicWins ? deterministic.level : candidate.level;

  return {
    level,
    reason: deterministicWins ? deterministic.reason : candidate.reason,
    confidence: deterministicWins ? deterministic.confidence : candidate.confidence,
    escalationRequired: level !== "low",
    ruleMatches: [...new Set([...deterministic.ruleMatches, ...candidate.ruleMatches])],
    source: deterministicWins ? "deterministic" : candidate.source,
  };
}

export function decideModelRisk(input: {
  proposal: ModelRiskProposal;
  citationsValid: boolean;
  responseSafe: boolean;
}): RiskDecision {
  const { proposal } = input;
  const policyMatches: string[] = [];
  let level = proposal.riskLevel;

  if (proposal.asksForDiagnosis) policyMatches.push("model_diagnosis_request");
  if (proposal.asksForClarity) policyMatches.push("model_clarity_request");
  if (proposal.soundsUnsure) policyMatches.push("model_uncertainty");
  if (proposal.confidence === "low") policyMatches.push("model_low_confidence");
  if (!input.citationsValid) policyMatches.push("invalid_or_missing_citation");
  if (!input.responseSafe) policyMatches.push("unsafe_draft");

  if (policyMatches.length && level === "low") level = "medium";

  return {
    level,
    reason:
      level === proposal.riskLevel
        ? proposal.riskReason
        : "Automated assessment was uncertain or could not support a safely grounded response.",
    confidence: proposal.confidence,
    escalationRequired: level !== "low",
    ruleMatches: policyMatches,
    source: "model",
  };
}

export function fallbackRisk(reason: "model_failure" | "redaction_failure"): RiskDecision {
  return {
    level: "medium",
    reason:
      reason === "redaction_failure"
        ? "Automated redaction could not be verified, so clinical advice was blocked."
        : "Automated assessment was unavailable, so the message requires human review.",
    confidence: "low",
    escalationRequired: true,
    ruleMatches: [reason],
    source: "fallback",
  };
}

export function isPatientResponseSafe(text: string) {
  return isPatientFacingOutputSafe(text);
}

export const HIGH_RISK_RESPONSE =
  "I'm sorry you're dealing with this. This may need urgent human help, and I can't safely assess or treat an emergency. Exit Nightingale and dial 999 for Emergency Services now. If you can, ask someone you trust to stay with you.";

export const MEDIUM_RISK_RESPONSE =
  "I'm sorry you're dealing with this. I can't safely assess this or provide clinical advice here. This needs review by the clinic; use the Send to Clinic path when it is available. If you think this may be an emergency, exit Nightingale and dial 999 now.";

export const REDACTION_FAILURE_RESPONSE =
  "I couldn't verify that your message was safe for automated processing, so I have not sent it to the AI or provided medical guidance. This needs human review through the clinic handoff path.";

export const DEGRADED_MODE_RESPONSE =
  "Nightingale's AI provider is temporarily unavailable, so safety-only mode is active. I can't assess, diagnose, or provide clinical advice. This needs review by the clinic through Send to Clinic. If you think this may be an emergency, exit Nightingale and dial 999 now.";
