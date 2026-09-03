import { describe, expect, it } from "vitest";

import { extractDeterministicMemory } from "../../src/features/memory/extract";
import type { MemoryCurrentFact } from "../../src/types/memory";

const FIRST_MESSAGE_ID = "10000000-0000-4000-8000-000000000001";
const CORRECTION_MESSAGE_ID = "10000000-0000-4000-8000-000000000002";

describe("Living Memory extraction and mutation", () => {
  it("creates an active Advil fact and then proposes a stopped revision with both source messages", () => {
    const first = extractDeterministicMemory({
      message: "I take Advil",
      sourceMessageId: FIRST_MESSAGE_ID,
      currentFacts: [],
    });

    expect(first).toEqual([
      expect.objectContaining({
        sourceMessageId: FIRST_MESSAGE_ID,
        kind: "medication",
        canonicalKey: "advil",
        status: "active",
        confidence: "high",
      }),
    ]);

    const current: MemoryCurrentFact = {
      itemId: "memory-advil",
      kind: "medication",
      canonicalKey: "advil",
      value: first[0].value,
      status: "active",
      confidence: "high",
      updatedAt: "2026-09-03T00:00:00.000Z",
    };
    const correction = extractDeterministicMemory({
      message: "Actually I stopped last week",
      sourceMessageId: CORRECTION_MESSAGE_ID,
      currentFacts: [current],
    });

    expect(correction).toEqual([
      expect.objectContaining({
        sourceMessageId: CORRECTION_MESSAGE_ID,
        kind: "medication",
        canonicalKey: "advil",
        status: "stopped",
        confidence: "high",
      }),
    ]);
    expect(correction[0].value).toContain("last week");
  });

  it("does not guess which medication an unnamed correction refers to when several are active", () => {
    const facts: MemoryCurrentFact[] = ["advil", "metformin"].map((canonicalKey) => ({
      itemId: canonicalKey,
      kind: "medication",
      canonicalKey,
      value: JSON.stringify({ name: canonicalKey }),
      status: "active",
      confidence: "high",
      updatedAt: "2026-09-03T00:00:00.000Z",
    }));
    expect(extractDeterministicMemory({
      message: "Actually I stopped last week",
      sourceMessageId: CORRECTION_MESSAGE_ID,
      currentFacts: facts,
    })).toEqual([]);
  });

  it("extracts the required explicit profile categories and symptom timeline", () => {
    const cases = [
      ["My main concern is recurring headaches", "chief_complaint", "primary"],
      ["I have a dry cough for three days", "symptom", "dry_cough"],
      ["I'm allergic to penicillin", "allergy", "penicillin"],
    ] as const;

    for (const [message, kind, key] of cases) {
      const result = extractDeterministicMemory({ message, sourceMessageId: FIRST_MESSAGE_ID, currentFacts: [] });
      expect(result).toContainEqual(expect.objectContaining({ kind, canonicalKey: key }));
    }
    const symptom = extractDeterministicMemory({
      message: "I have a dry cough for three days",
      sourceMessageId: FIRST_MESSAGE_ID,
      currentFacts: [],
    }).find((proposal) => proposal.kind === "symptom");
    expect(symptom?.value).toContain("for three days");
  });
});
