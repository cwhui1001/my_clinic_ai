import "server-only";

import { extractDeterministicMemory } from "@/src/features/memory/extract";
import { resolveSourceIntegrity } from "@/src/features/memory/provenance";
import {
  decryptProtectedContent,
  encryptProtectedContent,
  hashProtectedContent,
} from "@/src/server/crypto/protected-content";
import { createAdminClient } from "@/src/server/supabase/admin";
import { createSupabaseServerClient } from "@/src/server/supabase/server";
import type { Json } from "@/src/types/database";
import type { Database } from "@/src/types/database";
import type { MemoryConflictDto, MemoryCurrentFact, MemoryItemDto, MemoryProposal } from "@/src/types/memory";

type MemoryRevisionRow = Database["public"]["Tables"]["memory_revisions"]["Row"];
type MemoryConflictRow = Database["public"]["Tables"]["memory_conflicts"]["Row"];

export async function loadMemoryProfileForSession(patientSessionId: string): Promise<MemoryItemDto[]> {
  // Patient/staff identity and clinic access are enforced by Supabase RLS. Do
  // not use the service-role client for this user-facing read path.
  const supabase = await createSupabaseServerClient();
  const { data: session, error: sessionError } = await supabase
    .from("patient_sessions")
    .select("patient_id")
    .eq("id", patientSessionId)
    .single();
  if (sessionError || !session) throw new Error("memory_session_unavailable");

  const { data: items, error: itemError } = await supabase
    .from("memory_items")
    .select("*")
    .eq("patient_id", session.patient_id)
    .order("updated_at", { ascending: false });
  if (itemError) throw new Error("memory_profile_unavailable");

  const itemIds = (items ?? []).map((item) => item.id);
  const { data: revisions, error: revisionError } = itemIds.length
    ? await supabase.from("memory_revisions").select("*").in("memory_item_id", itemIds).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (revisionError) throw new Error("memory_profile_unavailable");

  const sourceMessageIds = [...new Set((revisions ?? []).map((revision) => revision.source_message_id))];
  const [{ data: sources, error: sourceError }, { data: conflicts, error: conflictError }] = await Promise.all([
    sourceMessageIds.length
      ? supabase.from("messages").select("id, content_ciphertext").in("id", sourceMessageIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("memory_conflicts")
      .select("*")
      .eq("patient_id", session.patient_id)
      .order("created_at", { ascending: false }),
  ]);
  if (sourceError || conflictError) throw new Error("memory_provenance_unavailable");
  const currentSourceHash = new Map((sources ?? []).flatMap((source): Array<[string, string]> => {
    try {
      return [[source.id, hashProtectedContent(decryptProtectedContent(source.content_ciphertext))]];
    } catch {
      return [];
    }
  }));
  const conflictsByRevision = indexConflicts(conflicts ?? []);

  const revisionsByItem = new Map<string, MemoryRevisionRow[]>();
  for (const revision of revisions ?? []) {
    const values = revisionsByItem.get(revision.memory_item_id) ?? [];
    values.push(revision);
    revisionsByItem.set(revision.memory_item_id, values);
  }

  return (items ?? []).flatMap((item): MemoryItemDto[] => {
    if (!item.current_revision_id) return [];
    const history = revisionsByItem.get(item.id) ?? [];
    if (!history.some((revision) => revision.id === item.current_revision_id)) return [];
    const historyIds = new Set(history.map((revision) => revision.id));
    const itemConflicts = uniqueConflicts(
      history.flatMap((revision) => conflictsByRevision.get(revision.id) ?? []),
    ).filter((conflict) => historyIds.has(conflict.left_revision_id) || historyIds.has(conflict.right_revision_id));
    return [{
      id: item.id,
      kind: item.kind,
      canonicalKey: item.canonical_key,
      updatedAt: item.updated_at,
      currentRevisionId: item.current_revision_id,
      revisions: history.map((revision) => {
        const sourceHash = currentSourceHash.get(revision.source_message_id);
        const revisionConflicts = conflictsByRevision.get(revision.id) ?? [];
        return {
          id: revision.id,
          value: decryptProtectedContent(revision.value_ciphertext),
          status: revision.status,
          sourceMessageId: revision.source_message_id,
          sourceContentHash: revision.source_content_sha256,
          sourceSnapshot: decryptProtectedContent(revision.source_snapshot_ciphertext),
          sourceIntegrity: resolveSourceIntegrity(revision.source_content_sha256, sourceHash),
          contradictionStatus: revisionConflicts.some((conflict) => conflict.status === "open")
            ? "open" as const
            : revisionConflicts.length ? "resolved" as const : null,
          supersedesRevisionId: revision.supersedes_revision_id,
          modelRunId: revision.model_run_id,
          confidence: revision.confidence,
          effectiveAt: revision.effective_at,
          updatedAt: revision.created_at,
        };
      }),
      conflicts: itemConflicts.map(toConflictDto),
    }];
  });
}

function indexConflicts(conflicts: MemoryConflictRow[]) {
  const byRevision = new Map<string, MemoryConflictRow[]>();
  for (const conflict of conflicts) {
    for (const revisionId of [conflict.left_revision_id, conflict.right_revision_id]) {
      const values = byRevision.get(revisionId) ?? [];
      values.push(conflict);
      byRevision.set(revisionId, values);
    }
  }
  return byRevision;
}

function uniqueConflicts(conflicts: MemoryConflictRow[]) {
  return [...new Map(conflicts.map((conflict) => [conflict.id, conflict])).values()];
}

function toConflictDto(conflict: MemoryConflictRow): MemoryConflictDto {
  return {
    id: conflict.id,
    kind: conflict.kind,
    status: conflict.status,
    leftRevisionId: conflict.left_revision_id,
    rightRevisionId: conflict.right_revision_id,
    createdAt: conflict.created_at,
  };
}

export function currentFactsFromProfile(profile: MemoryItemDto[]): MemoryCurrentFact[] {
  return profile.flatMap((item): MemoryCurrentFact[] => {
    const revision = item.revisions.find((candidate) => candidate.id === item.currentRevisionId);
    return revision ? [{
      itemId: item.id,
      kind: item.kind,
      canonicalKey: item.canonicalKey,
      value: revision.value,
      status: revision.status,
      confidence: revision.confidence,
      updatedAt: revision.updatedAt,
    }] : [];
  });
}

export function toEncryptedMemoryPayload(proposals: MemoryProposal[]): Json {
  return proposals.map((proposal) => ({
    source_message_id: proposal.sourceMessageId,
    kind: proposal.kind,
    canonical_key: proposal.canonicalKey,
    value_ciphertext: encryptProtectedContent(proposal.value),
    value_sha256: hashProtectedContent(proposal.value),
    status: proposal.status,
    confidence: proposal.confidence,
    effective_at: proposal.effectiveAt,
  }));
}

export async function bootstrapGuestMemory(patientSessionId: string) {
  const admin = createAdminClient();
  const { data: session, error: sessionError } = await admin
    .from("patient_sessions")
    .select("origin_lead_session_id, memory_bootstrap_status")
    .eq("id", patientSessionId)
    .single();
  if (sessionError || !session) throw new Error("memory_session_unavailable");
  if (session.memory_bootstrap_status === "completed") return;

  try {
    const { data: messages, error: messageError } = await admin
      .from("messages")
      .select("id, content_ciphertext")
      .eq("lead_session_id", session.origin_lead_session_id)
      .eq("actor", "guest")
      .in("status", ["completed", "blocked"])
      .order("created_at", { ascending: true });
    if (messageError) throw new Error("guest_memory_unavailable");

    const working: MemoryCurrentFact[] = [];
    const proposals: MemoryProposal[] = [];
    for (const message of messages ?? []) {
      const extracted = extractDeterministicMemory({
        message: decryptProtectedContent(message.content_ciphertext),
        sourceMessageId: message.id,
        currentFacts: working,
      });
      for (const proposal of extracted) {
        proposals.push(proposal);
        const index = working.findIndex(
          (fact) => fact.kind === proposal.kind && fact.canonicalKey === proposal.canonicalKey,
        );
        const current: MemoryCurrentFact = {
          itemId: "pending",
          kind: proposal.kind,
          canonicalKey: proposal.canonicalKey,
          value: proposal.value,
          status: proposal.status,
          confidence: proposal.confidence,
          updatedAt: new Date().toISOString(),
        };
        if (index >= 0) working[index] = current;
        else working.push(current);
      }
    }

    for (let offset = 0; offset < proposals.length; offset += 12) {
      const { error } = await admin.rpc("apply_patient_memory", {
        p_patient_session_id: patientSessionId,
        p_memory_proposals: toEncryptedMemoryPayload(proposals.slice(offset, offset + 12)),
      });
      if (error) throw new Error("guest_memory_persist_failed");
    }

    const { error: completionError } = await admin.rpc("record_memory_bootstrap_result", {
      p_patient_session_id: patientSessionId,
      p_succeeded: true,
      p_error_code: null,
    });
    if (completionError) throw new Error("guest_memory_completion_failed");
  } catch (error) {
    await admin.rpc("record_memory_bootstrap_result", {
      p_patient_session_id: patientSessionId,
      p_succeeded: false,
      p_error_code: safeBootstrapError(error),
    });
    throw error;
  }
}

function safeBootstrapError(error: unknown) {
  return error instanceof Error && /^[a-z0-9_.-]{1,64}$/.test(error.message)
    ? error.message
    : "guest_memory_failed";
}
