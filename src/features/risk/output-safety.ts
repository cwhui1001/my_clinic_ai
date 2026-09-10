export type OutputSafetyAssessment = {
  safe: boolean;
  ruleMatches: string[];
};

const PATIENT_FACING_OUTPUT_RULES = [
  { id: "diagnosis_you_have", pattern: /\byou\s+(?:definitely\s+|probably\s+)?have\b/i },
  { id: "diagnosis_suffering_from", pattern: /\byou are suffering from\b/i },
  { id: "diagnosis_likelihood_claim", pattern: /\b(?:this|that|it|your symptoms?|these symptoms?)\s+(?:is|are|sounds?|looks?|seems?)\s+(?:most\s+|very\s+)?(?:likely|probably|definitely|consistent with|suggestive of)\b/i },
  { id: "diagnosis_sounds_like", pattern: /\b(?:this|that|it|your symptoms?|these symptoms?)\s+(?:sounds?|looks?|seems?)\s+like\b/i },
  { id: "diagnosis_exclusion", pattern: /\b(?:not|unlikely to be)\s+(?:an?\s+)?(?:heart attack|cardiac|cancer|serious|dangerous|emergency)\b/i },
  { id: "medication_change", pattern: /\b(?:start|stop|increase|decrease|double|change) (?:your )?(?:dose|medication|medicine)\b/i },
  { id: "false_reassurance", pattern: /\bthere(?:'s| is) nothing to worry about\b/i },
  { id: "unsafe_delay_or_reassurance", pattern: /\b(?:not serious|not dangerous|you(?:'ll| will) be fine|wait and see)\b/i },
  { id: "treatment_plan", pattern: /\btreatment plan\b/i },
] as const;

export function assessPatientFacingOutput(text: string): OutputSafetyAssessment {
  const ruleMatches = PATIENT_FACING_OUTPUT_RULES.filter((rule) =>
    rule.pattern.test(text),
  ).map((rule) => rule.id);
  return { safe: ruleMatches.length === 0, ruleMatches };
}

export function isPatientFacingOutputSafe(text: string) {
  return assessPatientFacingOutput(text).safe;
}
