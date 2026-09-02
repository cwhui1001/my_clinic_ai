import type { ValueEventType } from "@/src/types/database";

export const GUEST_CHAT_PROMPT_VERSION = "guest-chat-v1";

const EMERGENCY_RULES = [
  { id: "crushing_chest_pain", pattern: /\b(crushing|severe)\s+chest\s+pain\b/i },
  { id: "difficulty_breathing", pattern: /\b(difficulty|trouble|can(?:not|'t))\s+(breathing|breathe)\b/i },
  { id: "heavy_bleeding", pattern: /\b(heavy|severe|uncontrolled)\s+bleeding\b/i },
  { id: "self_harm", pattern: /\b(want|plan|going)\s+to\s+(hurt|harm|kill)\s+myself\b/i },
] as const;

const CLINICAL_INTENT_PATTERN =
  /\b(symptom|pain|bleed|bleeding|pregnan|period|cycle|fever|nausea|dizzy|headache|rash|medication|medicine|dose|allerg|diagnos|treatment|ivf|fertility|egg freezing|embryo|infection|chest|breath)\w*\b/i;

const UNSAFE_OUTPUT_PATTERNS = [
  /\byou (?:definitely )?have (?:an? )?(?:infection|condition|disease|disorder|syndrome|cancer|pregnancy)\b/i,
  /\byou are suffering from\b/i,
  /\b(?:start|stop|increase|decrease|double|change) (?:your )?(?:dose|medication|medicine)\b/i,
  /\bthere(?:'s| is) nothing to worry about\b/i,
  /\byou(?:'ll| will) be fine\b/i,
];

export type GuestIntent =
  | "emergency"
  | "trust"
  | "clinical_summary"
  | "service"
  | "hours"
  | "availability"
  | "general_education";

export function findEmergencyRule(text: string) {
  return EMERGENCY_RULES.find((rule) => rule.pattern.test(text))?.id ?? null;
}

export function classifyGuestIntent(text: string): GuestIntent {
  if (findEmergencyRule(text)) return "emergency";
  if (/\bare you (?:a )?(?:real )?(?:doctor|human)\b/i.test(text)) return "trust";
  if (CLINICAL_INTENT_PATTERN.test(text) && /\b(i|i'm|im|my|me)\b/i.test(text)) {
    return "clinical_summary";
  }
  if (/\b(hour|open|close|weekend|saturday|sunday)\w*\b/i.test(text)) return "hours";
  if (/\b(available|availability|appointment|slot|book)\w*\b/i.test(text)) {
    return "availability";
  }
  if (/\b(service|offer|provide|consult|ivf|fertility|egg freezing)\w*\b/i.test(text)) {
    return "service";
  }
  return "general_education";
}

export function valueTypeForIntent(intent: GuestIntent): ValueEventType | null {
  const values: Partial<Record<GuestIntent, ValueEventType>> = {
    trust: "trust_explanation",
    clinical_summary: "concern_summary",
    service: "service_answer",
    hours: "hours_answer",
    availability: "availability_answer",
    general_education: "general_education",
  };
  return values[intent] ?? null;
}

export function requiresSecureContinue(intent: GuestIntent) {
  return intent === "clinical_summary" || intent === "emergency";
}

export function isGuestResponseSafe(text: string) {
  return !UNSAFE_OUTPUT_PATTERNS.some((pattern) => pattern.test(text));
}

export function buildTrustResponse(clinicName: string) {
  return `I’m Nightingale AI, not a doctor or a human. I can explain general information and help organize your concern. ${clinicName} is the healthcare provider. A human care-team member becomes involved only after you choose secure continuation, verify your identity, and consent to share your information with the clinic.`;
}

export const EMERGENCY_RESPONSE =
  "This may need urgent human help. I can’t assess or treat emergencies. Exit Nightingale and dial 999 for Emergency Services now. If you can, ask someone you trust to stay with you.";

export const SAFE_FAILURE_RESPONSE =
  "I’m unable to process that safely right now, so I won’t offer medical guidance. You can try again without personal identifiers or choose secure continuation when it becomes available.";
