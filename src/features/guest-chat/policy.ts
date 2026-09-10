import type { ValueEventType } from "@/src/types/database";
import { findEmergencyRule } from "../risk/emergency-rules";
import { isPatientFacingOutputSafe } from "../risk/output-safety";

export const GUEST_CHAT_PROMPT_VERSION = "guest-chat-v1";

const CLINICAL_INTENT_PATTERN =
  /\b(symptom|pain|bleed|bleeding|pregnan|period|cycle|fever|nausea|dizzy|headache|rash|medication|medicine|dose|allerg|diagnos|treatment|ivf|fertility|egg freezing|embryo|infection|chest|breath)\w*\b/i;

export type GuestIntent =
  | "emergency"
  | "trust"
  | "clinical_summary"
  | "service"
  | "hours"
  | "availability"
  | "general_education";

export { findEmergencyRule };

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

export function hasMeaningfulValueEvent(valueEventCount: number) {
  return Number.isInteger(valueEventCount) && valueEventCount > 0;
}

export function isGuestResponseSafe(text: string) {
  return isPatientFacingOutputSafe(text);
}

export function buildTrustResponse(clinicName: string) {
  return `I’m Nightingale AI, not a doctor or a human. I can explain general information and help organize your concern. ${clinicName} is the healthcare provider. A human care-team member becomes involved only after you choose secure continuation, verify your identity, and consent to share your information with the clinic.`;
}

export const EMERGENCY_RESPONSE =
  "This may need urgent human help. I can’t assess or treat emergencies. Exit Nightingale and dial 999 for Emergency Services now. If you can, ask someone you trust to stay with you.";

export const SAFE_FAILURE_RESPONSE =
  "I’m unable to process that safely right now, so I won’t offer medical guidance. You can try again without personal identifiers or choose secure continuation when it becomes available.";

export const GUEST_DEGRADED_MODE_RESPONSE =
  "Nightingale's AI provider is temporarily unavailable, so safety-only mode is active. I can't assess, diagnose, or provide medical guidance. You can retry or choose secure continuation for human follow-up. If this may be an emergency, exit Nightingale and dial 999 now.";

export function guestRedactionFailureResponse(intent: GuestIntent) {
  return intent === "emergency" ? EMERGENCY_RESPONSE : SAFE_FAILURE_RESPONSE;
}
