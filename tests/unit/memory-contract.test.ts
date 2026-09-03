import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("supabase/migrations/202609030005_living_memory.sql"), "utf8");

describe("Living Memory database contract", () => {
  it("stores stable items and immutable provenance-linked revisions", () => {
    expect(migration).toContain("create table public.memory_items");
    expect(migration).toContain("create table public.memory_revisions");
    expect(migration).toContain("source_message_id uuid not null");
    expect(migration).toContain("supersedes_revision_id uuid");
    expect(migration).toContain("memory_revisions_append_only");
    expect(migration).toContain("Memory revisions are immutable");
  });

  it("keeps the live pointer on a revision belonging to the same item", () => {
    expect(migration).toContain("foreign key (current_revision_id, id)");
    expect(migration).toContain("references public.memory_revisions(id, memory_item_id)");
  });

  it("validates guest or patient source messages and updates memory inside the turn wrapper", () => {
    expect(migration).toContain("lead_session_id = v_session.origin_lead_session_id");
    const completeTurn = migration.indexOf("from public.complete_patient_turn(");
    const applyMemory = migration.indexOf("perform public.apply_memory_revisions_internal(", completeTurn);
    expect(completeTurn).toBeGreaterThan(0);
    expect(applyMemory).toBeGreaterThan(completeTurn);
  });

  it("allows only the owning authenticated patient to read the profile and history", () => {
    expect(migration).toContain("create policy memory_items_select_own");
    expect(migration).toContain("create policy memory_revisions_select_own");
    expect(migration).toContain("patients.auth_user_id = (select auth.uid())");
  });
});
