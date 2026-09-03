import type { ResponseConfidence, RiskLevel } from "@/src/types/database";

export const RISK_PIPELINE_VERSION = "patient-risk-v1";
export const PATIENT_PROMPT_VERSION = "patient-safe-response-v1";

type RiskRule = {
  id: string;
  level: Exclude<RiskLevel, "low">;
  pattern: RegExp;
};

const RISK_RULES: RiskRule[] = [
  { id: "crushing_chest_pain", level: "high", pattern: /\b(?:crushing|severe)\s+chest\s+pain\b/i },
  { id: "difficulty_breathing", level: "high", pattern: /\b(?:difficulty|trouble|unable to|cannot|can't)\s+(?:breathing|breathe)\b/i },
  { id: "heavy_bleeding", level: "high", pattern: /\b(?:heavy|severe|uncontrolled)\s+bleeding\b/i },
  { id: "self_harm", level: "high", pattern: /\b(?:want|plan|going)\s+to\s+(?:hurt|harm|kill)\s+myself\b/i },
  { id: "chest_pressure", level: "high", pattern: /\bchest\s+(?:pressure|pain)\b.*\b(?:sweat|breath|faint|jaw|arm)\w*\b/i },
  { id: "cannot_stay_awake", level: "high", pattern: /\b(?:unconscious|unresponsive|cannot stay awake|can't stay awake)\b/i },
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
  const matches = RISK_RULES.filter((rule) => rule.pattern.test(text));
  if (!matches.length) return null;
  const level = matches.some((rule) => rule.level === "high") ? "high" : "medium";
  return {
    level,
    reason:
      level === "high"
        ? "A deterministic urgent-symptom rule matched."
        : "The message needs human assessment because it is ambiguous or requests clinical judgment.",
    confidence: "high",
    ruleMatches: matches.map((rule) => rule.id),
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

const UNSAFE_PATTERNS = [
  /\byou (?:definitely |probably )?have\b/i,
  /\byou are suffering from\b/i,
  /\b(?:start|stop|increase|decrease|double|change) (?:your )?(?:dose|medication|medicine)\b/i,
  /\bthere(?:'s| is) nothing to worry about\b/i,
  /\b(?:not serious|not dangerous|you(?:'ll| will) be fine|wait and see)\b/i,
  /\btreatment plan\b/i,
];

export function isPatientResponseSafe(text: string) {
  return !UNSAFE_PATTERNS.some((pattern) => pattern.test(text));
}

export const HIGH_RISK_RESPONSE =
  "I'm sorry you're dealing with this. This may need urgent human help, and I can't safely assess or treat an emergency. Exit Nightingale and dial 999 for Emergency Services now. If you can, ask someone you trust to stay with you.";

export const MEDIUM_RISK_RESPONSE =
  "I'm sorry you're dealing with this. I can't safely assess this or provide clinical advice here. This needs review by the clinic; use the Send to Clinic path when it is available. If you think this may be an emergency, exit Nightingale and dial 999 now.";

export const REDACTION_FAILURE_RESPONSE =
  "I couldn't verify that your message was safe for automated processing, so I have not sent it to the AI or provided medical guidance. This needs human review through the clinic handoff path.";
