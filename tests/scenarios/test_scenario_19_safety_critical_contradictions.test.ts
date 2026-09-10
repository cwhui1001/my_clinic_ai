import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildEscalationPayload } from "../../src/features/escalation/payload";
import { extractDeterministicMemory } from "../../src/features/memory/extract";
import type { MemoryItemDto } from "../../src/types/memory";

describe("test_scenario_19_safety_critical_contradictions", () => {
  it("extracts both sides of the allergy contradiction and dosage changes", () => {
    expect(extractDeterministicMemory({ message: "No known allergies", sourceMessageId: id(1), currentFacts: [] }))
      .toContainEqual(expect.objectContaining({ kind: "allergy", canonicalKey: "none_known" }));
    expect(extractDeterministicMemory({ message: "Penicillin gave me a rash", sourceMessageId: id(2), currentFacts: [] }))
      .toContainEqual(expect.objectContaining({ kind: "allergy", canonicalKey: "penicillin" }));
    const firstDose = extractDeterministicMemory({ message: "I take Advil 200mg", sourceMessageId: id(3), currentFacts: [] })[0];
    const changedDose = extractDeterministicMemory({
      message: "I take Advil 400mg",
      sourceMessageId: id(4),
      currentFacts: [{ itemId: id(8), kind: firstDose.kind, canonicalKey: firstDose.canonicalKey, value: firstDose.value, status: firstDose.status, confidence: firstDose.confidence, updatedAt: "2026-09-10T00:00:00.000Z" }],
    })[0];
    expect(changedDose.value).toContain("400mg");
  });

  it("creates append-only allergy, medication-state, and dosage conflicts", () => {
    const migration = readFileSync(resolve("supabase/migrations/202609100003_living_memory_integrity.sql"), "utf8");
    expect(migration).toContain("'allergy_presence', 'medication_status', 'dosage'");
    expect(migration).toContain("memory_revision_detects_conflicts");
    expect(migration).toContain("v_previous.status <> new.status");
    expect(migration).toContain("v_previous.value_sha256 <> new.value_sha256");
    expect(migration).toContain("memory_conflicts_append_only");
  });

  it("puts the open contradiction and both revision sources in the clinician handoff", () => {
    const memory = conflictedAllergyMemory();
    const payload = buildEscalationPayload({
      triggerMessageId: id(9),
      triggerMessage: "Please review my allergies",
      risk: { level: "medium", reason: "Needs clarification", confidence: "high", escalationRequired: true, ruleMatches: [], pipelineVersion: "test", provenance: { source: "deterministic", assessedAt: "2026-09-10T00:00:00.000Z" } },
      memory,
    });
    expect(payload.triageSummary.join(" ")).toContain("safety-sensitive profile contradiction");
    expect(payload.profileSnapshot[0].contradictionStatus).toBe("open");
    expect(payload.provenance).toContainEqual({ message_id: null, memory_revision_id: id(5), purpose: "profile_support" });
    expect(payload.provenance).toContainEqual({ message_id: null, memory_revision_id: id(6), purpose: "profile_support" });
  });
});

function conflictedAllergyMemory(): MemoryItemDto[] {
  return [{
    id: id(7), kind: "allergy", canonicalKey: "penicillin", currentRevisionId: id(6), updatedAt: "2026-09-10T00:09:00.000Z",
    conflicts: [{ id: id(8), kind: "allergy_presence", status: "open", leftRevisionId: id(5), rightRevisionId: id(6), createdAt: "2026-09-10T00:09:00.000Z" }],
    revisions: [{ id: id(6), value: JSON.stringify({ substance: "Penicillin", reaction: "rash" }), status: "active", sourceMessageId: id(2), sourceContentHash: "b".repeat(64), sourceSnapshot: "Penicillin gave me a rash", sourceIntegrity: "verified", contradictionStatus: "open", supersedesRevisionId: null, modelRunId: null, confidence: "high", effectiveAt: null, updatedAt: "2026-09-10T00:09:00.000Z" }],
  }];
}

function id(value: number) {
  return `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}
