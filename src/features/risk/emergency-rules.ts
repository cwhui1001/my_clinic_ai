export const EMERGENCY_RULESET_VERSION = "emergency-floor-v2-en-ms-zh";

export type EmergencyLanguage = "en" | "ms" | "zh";

export type EmergencyRuleMatch = {
  id: string;
  language: EmergencyLanguage;
};

type EmergencyRule = EmergencyRuleMatch & { pattern: RegExp };

// This is a conservative emergency floor, not a diagnosis. An LLM can never
// remove a match; false positives receive urgent human guidance.
const EMERGENCY_RULES: readonly EmergencyRule[] = [
  { id: "crushing_chest_pain", language: "en", pattern: /\b(?:crushing|severe)\s+chest\s+pain\b/i },
  { id: "chest_tightness", language: "en", pattern: /\bchest\s+(?:tightness|pressure)\b/i },
  { id: "difficulty_breathing", language: "en", pattern: /\b(?:difficulty|trouble|unable|cannot|can't)\b(?:\s+\w+){0,3}\s+\b(?:breathing|breathe)\b/i },
  { id: "chest_pain_with_systemic_symptom", language: "en", pattern: /\bchest\s+pain\b.*\b(?:sweat\w*|breath\w*|faint\w*|jaw|arm)\b/i },
  { id: "heavy_bleeding", language: "en", pattern: /\b(?:heavy|severe|uncontrolled)\s+bleeding\b/i },
  { id: "self_harm", language: "en", pattern: /\b(?:want|plan|going)\s+to\s+(?:hurt|harm|kill)\s+myself\b/i },
  { id: "cannot_stay_awake", language: "en", pattern: /\b(?:unconscious|unresponsive|cannot stay awake|can't stay awake)\b/i },
  { id: "ms_chest_pain", language: "ms", pattern: /\b(?:sakit|pedih|ketat|sesak)\s+(?:di\s+)?dada\b|\bdada(?:\s+saya)?\s+(?:sakit|pedih|ketat|sesak)\b/i },
  { id: "ms_difficulty_breathing", language: "ms", pattern: /\b(?:sesak\s+nafas|susah\s+(?:nak\s+|untuk\s+)?bernafas|(?:tak|tidak)\s+boleh\s+(?:nak\s+|untuk\s+)?bernafas)\b/i },
  { id: "ms_heavy_bleeding", language: "ms", pattern: /\b(?:pendarahan|darah)\s+(?:banyak|teruk|tidak\s+berhenti|tak\s+berhenti)\b/i },
  { id: "ms_self_harm", language: "ms", pattern: /\b(?:bunuh\s+diri|mencederakan\s+diri|cederakan\s+diri)\b/i },
  { id: "ms_unconscious", language: "ms", pattern: /\b(?:tidak\s+sedarkan\s+diri|tak\s+sedarkan\s+diri|pengsan)\b/i },
  { id: "zh_chest_pain", language: "zh", pattern: /(?:胸痛|胸口痛|胸部(?:剧痛|劇痛)|胸闷|胸悶)/u },
  { id: "zh_difficulty_breathing", language: "zh", pattern: /(?:呼吸困难|呼吸困難|喘不过气|喘不過氣|无法呼吸|無法呼吸)/u },
  { id: "zh_heavy_bleeding", language: "zh", pattern: /(?:大量出血|严重出血|嚴重出血|流血不止)/u },
  { id: "zh_self_harm", language: "zh", pattern: /(?:自杀|自殺|伤害自己|傷害自己)/u },
  { id: "zh_unconscious", language: "zh", pattern: /(?:失去意识|失去意識|昏迷)/u },
];

export function findEmergencyMatches(rawMessage: string): EmergencyRuleMatch[] {
  const normalized = rawMessage
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return EMERGENCY_RULES.filter((rule) => rule.pattern.test(normalized)).map(
    ({ id, language }) => ({ id, language }),
  );
}

export function findEmergencyRule(rawMessage: string) {
  return findEmergencyMatches(rawMessage)[0]?.id ?? null;
}
