import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveSourceIntegrity } from "../../src/features/memory/provenance";

describe("test_scenario_21_provenance_integrity", () => {
  it("distinguishes verified, changed, and unavailable source evidence", () => {
    const captured = "a".repeat(64);
    expect(resolveSourceIntegrity(captured, captured)).toBe("verified");
    expect(resolveSourceIntegrity(captured, "b".repeat(64))).toBe("changed");
    expect(resolveSourceIntegrity(captured, undefined)).toBe("unavailable");
  });

  it("captures an immutable encrypted source snapshot and hash at revision insertion", () => {
    const migration = readFileSync(resolve("supabase/migrations/202609100003_living_memory_integrity.sql"), "utf8");
    const baseMigration = readFileSync(resolve("supabase/migrations/202609030005_living_memory.sql"), "utf8");
    expect(migration).toContain("source_content_sha256");
    expect(migration).toContain("source_snapshot_ciphertext");
    expect(migration).toContain("memory_revision_captures_source");
    expect(migration).toContain("messages.content_sha256, messages.content_ciphertext");
    expect(baseMigration).toContain("memory_revisions_append_only");
  });

  it("renders an explicit immutable fallback instead of a broken provenance link", () => {
    const patientUi = readFileSync(resolve("app/components/patient-chat.tsx"), "utf8");
    expect(patientUi).toContain('revision.sourceIntegrity === "verified"');
    expect(patientUi).toContain("Immutable snapshot:");
    expect(patientUi).toContain("source {revision.sourceIntegrity}");
  });
});
