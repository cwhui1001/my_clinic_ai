import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { extractDeterministicMemory } from "../../src/features/memory/extract";
import type { MemoryCurrentFact, MemoryProposal } from "../../src/types/memory";

const messageIds = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
] as const;

describe("test_scenario_16_correction_chain", () => {
  it("resolves pronoun corrections and corrections of corrections conservatively", () => {
    const active = only(extractDeterministicMemory({
      message: "I take Advil",
      sourceMessageId: messageIds[0],
      currentFacts: [],
    }));
    const stopped = only(extractDeterministicMemory({
      message: "Actually I stopped it last week",
      sourceMessageId: messageIds[1],
      currentFacts: [toCurrent(active)],
    }));
    const resumed = only(extractDeterministicMemory({
      message: "Actually I started taking it again",
      sourceMessageId: messageIds[2],
      currentFacts: [toCurrent(stopped)],
    }));

    expect([active.status, stopped.status, resumed.status]).toEqual(["active", "stopped", "active"]);
    expect([active.canonicalKey, stopped.canonicalKey, resumed.canonicalKey]).toEqual(["advil", "advil", "advil"]);
    expect([active.sourceMessageId, stopped.sourceMessageId, resumed.sourceMessageId]).toEqual(messageIds);
    expect(stopped.value).toContain("last week");
  });

  it("persists each correction as an immutable superseding revision", () => {
    const migration = readFileSync(resolve("supabase/migrations/202609030005_living_memory.sql"), "utf8");
    expect(migration).toContain("supersedes_revision_id");
    expect(migration).toContain("v_item.current_revision_id");
    expect(migration).toContain("memory_revisions_append_only");
    expect(migration).not.toContain("update public.memory_revisions\n    set status");
  });
});

function only(proposals: MemoryProposal[]) {
  expect(proposals).toHaveLength(1);
  return proposals[0];
}

function toCurrent(proposal: MemoryProposal): MemoryCurrentFact {
  return {
    itemId: "memory-advil",
    kind: proposal.kind,
    canonicalKey: proposal.canonicalKey,
    value: proposal.value,
    status: proposal.status,
    confidence: proposal.confidence,
    updatedAt: "2026-09-10T00:00:00.000Z",
  };
}
