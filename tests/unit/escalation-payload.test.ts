import { describe, expect, it } from "vitest";

import { buildEscalationPayload } from "../../src/features/escalation/payload";
import type { MemoryItemDto } from "../../src/types/memory";

const TRIGGER_ID = "10000000-0000-4000-8000-000000000001";
const REVISION_ID = "10000000-0000-4000-8000-000000000002";

describe("test_scenario_18_cold_handoff_payload_builder", () => {
  it("contains the trigger, one-to-five triage bullets, profile snapshot, and normalized provenance", () => {
    const memory: MemoryItemDto[] = [{
      id: "10000000-0000-4000-8000-000000000003",
      kind: "medication",
      canonicalKey: "advil",
      currentRevisionId: REVISION_ID,
      updatedAt: "2026-09-03T00:00:00.000Z",
      conflicts: [],
      revisions: [{
        id: REVISION_ID,
        value: JSON.stringify({ name: "Advil" }),
        status: "active",
        sourceMessageId: "10000000-0000-4000-8000-000000000004",
        sourceContentHash: "a".repeat(64),
        sourceSnapshot: "I take Advil",
        sourceIntegrity: "verified",
        contradictionStatus: null,
        supersedesRevisionId: null,
        modelRunId: null,
        confidence: "high",
        effectiveAt: null,
        updatedAt: "2026-09-03T00:00:00.000Z",
      }],
    }];

    const payload = buildEscalationPayload({
      triggerMessageId: TRIGGER_ID,
      triggerMessage: "I have crushing chest pain",
      risk: {
        level: "high",
        reason: "A deterministic urgent-symptom rule matched.",
        confidence: "high",
        escalationRequired: true,
        ruleMatches: ["crushing_chest_pain"],
        pipelineVersion: "patient-risk-v1",
        provenance: { source: "deterministic", assessedAt: "2026-09-03T00:00:00.000Z" },
      },
      memory,
    });

    expect(payload.triageSummary.length).toBeGreaterThanOrEqual(1);
    expect(payload.triageSummary.length).toBeLessThanOrEqual(5);
    expect(payload.triageSummary.join(" ")).toContain("crushing chest pain");
    expect(payload.profileSnapshot).toContainEqual(expect.objectContaining({ revisionId: REVISION_ID, canonicalKey: "advil" }));
    expect(payload.provenance).toContainEqual({ message_id: TRIGGER_ID, memory_revision_id: null, purpose: "trigger" });
    expect(payload.provenance).toContainEqual({ message_id: null, memory_revision_id: REVISION_ID, purpose: "profile_support" });
  });
});
