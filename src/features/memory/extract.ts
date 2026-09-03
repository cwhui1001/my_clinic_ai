import type { MemoryCurrentFact, MemoryProposal } from "@/src/types/memory";

const MAX_VALUE_LENGTH = 500;

export function extractDeterministicMemory(input: {
  message: string;
  sourceMessageId: string;
  currentFacts: MemoryCurrentFact[];
}): MemoryProposal[] {
  const proposals: MemoryProposal[] = [];
  const text = input.message.trim();

  const medication = text.match(
    /\b(?:i take|i'm taking|i am taking|currently taking|started taking)\s+([a-z][a-z0-9-]{1,39})(?:\s+(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml)))?/i,
  );
  if (medication) {
    const name = medication[1];
    proposals.push({
      sourceMessageId: input.sourceMessageId,
      kind: "medication",
      canonicalKey: canonicalize(name),
      value: encodeValue({ name, dose: medication[2] ?? null }),
      status: "active",
      confidence: "high",
      effectiveAt: null,
    });
  }

  const stopped = text.match(
    /\b(?:actually\s+)?i\s+(?:have stopped taking|stopped taking|have stopped|stopped|no longer (?:take|taking))\b/i,
  );
  if (stopped) {
    const namedMedication = text.match(
      /\b(?:have stopped taking|stopped taking|have stopped|stopped|no longer (?:take|taking))\s+(?!last\b|yesterday\b|today\b)([a-z][a-z0-9-]{1,39})/i,
    );
    const timeline = text.match(/\b(last\s+(?:week|month|year)|yesterday|today|\d+\s+days?\s+ago)\b/i)?.[1] ?? null;
    const namedKey = namedMedication?.[1] ? canonicalize(namedMedication[1]) : null;
    const activeMedications = input.currentFacts.filter(
      (fact) => fact.kind === "medication" && fact.status === "active",
    );
    const existing = namedKey
      ? activeMedications.find((fact) => fact.canonicalKey === namedKey)
      : activeMedications.length === 1
        ? activeMedications[0]
        : null;
    if (existing) {
      proposals.push({
        sourceMessageId: input.sourceMessageId,
        kind: "medication",
        canonicalKey: existing.canonicalKey,
        value: mergeTimeline(existing.value, timeline),
        status: "stopped",
        confidence: "high",
        effectiveAt: null,
      });
    }
  }

  const allergy = text.match(/\b(?:i am|i'm)?\s*allergic to\s+([^.,;!?]{2,80})/i);
  if (allergy) {
    const substance = allergy[1].trim();
    proposals.push({
      sourceMessageId: input.sourceMessageId,
      kind: "allergy",
      canonicalKey: canonicalize(substance),
      value: encodeValue({ substance }),
      status: "active",
      confidence: "high",
      effectiveAt: null,
    });
  }

  if (/\b(?:no known allergies|i (?:do not|don't) have any allergies)\b/i.test(text)) {
    proposals.push({
      sourceMessageId: input.sourceMessageId,
      kind: "allergy",
      canonicalKey: "none_known",
      value: encodeValue({ statement: "No known allergies" }),
      status: "active",
      confidence: "high",
      effectiveAt: null,
    });
  }

  const complaint = text.match(/\b(?:my main concern is|my chief complaint is|i(?:'m| am) here because)\s+(.{2,240})/i);
  if (complaint) {
    proposals.push({
      sourceMessageId: input.sourceMessageId,
      kind: "chief_complaint",
      canonicalKey: "primary",
      value: encodeValue({ complaint: trimSentence(complaint[1]) }),
      status: "active",
      confidence: "high",
      effectiveAt: null,
    });
  }

  const symptom = text.match(
    /\b(?:i have|i've had|i am experiencing|i'm experiencing)\s+(.{2,160}?)(?:\s+(for\s+.{2,60}|since\s+.{2,60}))?[.!?]?$/i,
  );
  if (symptom) {
    const description = trimSentence(symptom[1]);
    const timeline = symptom[2] ? trimSentence(symptom[2]) : null;
    if (!/^(?:a |an )?(?:question|appointment|concern)$/i.test(description)) {
      proposals.push({
        sourceMessageId: input.sourceMessageId,
        kind: "symptom",
        canonicalKey: canonicalize(description),
        value: encodeValue({ description, timeline }),
        status: "active",
        confidence: "med",
        effectiveAt: null,
      });
    }
  }

  return deduplicate(proposals);
}

export function normalizeModelMemoryProposal(input: Omit<MemoryProposal, "sourceMessageId"> & { sourceMessageId: string }) {
  const key = canonicalize(input.canonicalKey);
  if (!key || input.confidence === "low") return null;
  const value = input.value.trim().slice(0, MAX_VALUE_LENGTH);
  if (!value) return null;
  return { ...input, canonicalKey: key, value } satisfies MemoryProposal;
}

function canonicalize(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/^(?:a|an|the)\s+/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function encodeValue(value: Record<string, string | null>) {
  return JSON.stringify(value).slice(0, MAX_VALUE_LENGTH);
}

function trimSentence(value: string) {
  return value.trim().replace(/[.!?]+$/, "");
}

function mergeTimeline(value: string, timeline: string | null) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return JSON.stringify({ ...parsed, stoppedTimeline: timeline }).slice(0, MAX_VALUE_LENGTH);
  } catch {
    return encodeValue({ value, stoppedTimeline: timeline });
  }
}

function deduplicate(proposals: MemoryProposal[]) {
  const byKey = new Map<string, MemoryProposal>();
  for (const proposal of proposals) byKey.set(`${proposal.kind}:${proposal.canonicalKey}`, proposal);
  return [...byKey.values()];
}
