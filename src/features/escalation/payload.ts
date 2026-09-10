import type { MemoryItemDto } from "@/src/types/memory";
import type { PatientRiskDto } from "@/src/types/patient-chat";

export function buildEscalationPayload(input: {
  triggerMessageId: string;
  triggerMessage: string;
  risk: PatientRiskDto;
  memory: MemoryItemDto[];
}) {
  const profileSnapshot = input.memory.flatMap((item) => {
    const revision = item.revisions.find((candidate) => candidate.id === item.currentRevisionId);
    const openConflicts = item.conflicts.filter((conflict) => conflict.status === "open");
    return revision ? [{
      kind: item.kind,
      canonicalKey: item.canonicalKey,
      value: revision.value,
      status: revision.status,
      revisionId: revision.id,
      sourceMessageId: revision.sourceMessageId,
      sourceContentHash: revision.sourceContentHash,
      sourceIntegrity: revision.sourceIntegrity,
      sourceSnapshot: revision.sourceSnapshot.slice(0, 240),
      contradictionStatus: openConflicts.length ? "open" as const : null,
      conflicts: openConflicts.map((conflict) => ({
        id: conflict.id,
        kind: conflict.kind,
        leftRevisionId: conflict.leftRevisionId,
        rightRevisionId: conflict.rightRevisionId,
      })),
      history: item.revisions.slice(0, 4).map((candidate) => ({
        revisionId: candidate.id,
        value: candidate.value,
        status: candidate.status,
        sourceMessageId: candidate.sourceMessageId,
        sourceIntegrity: candidate.sourceIntegrity,
        updatedAt: candidate.updatedAt,
      })),
    }] : [];
  });

  const openConflictCount = new Set(
    profileSnapshot.flatMap((fact) => fact.conflicts.map((conflict) => conflict.id)),
  ).size;

  const triageSummary = [
    `${capitalize(input.risk.level)} risk (${input.risk.confidence} confidence): ${input.risk.reason}`,
    `Patient reported: ${input.triggerMessage.trim().slice(0, 500)}`,
    profileSnapshot.length
      ? `Current profile includes ${profileSnapshot.map((fact) => `${fact.kind.replaceAll("_", " ")}: ${displayValue(fact.value)} (${fact.status})`).join("; ").slice(0, 700)}.`
      : "No structured profile facts were available when this handoff was sent.",
    openConflictCount
      ? `${openConflictCount} safety-sensitive profile contradiction${openConflictCount === 1 ? "" : "s"} require clinician clarification; no evidence was discarded.`
      : "No open safety-sensitive profile contradictions were detected.",
  ];

  const profileRevisionIds = [...new Set(profileSnapshot.flatMap((fact) => [
    fact.revisionId,
    ...fact.conflicts.flatMap((conflict) => [conflict.leftRevisionId, conflict.rightRevisionId]),
  ]))];

  return {
    triageSummary,
    profileSnapshot,
    provenance: [
      { message_id: input.triggerMessageId, memory_revision_id: null, purpose: "trigger" },
      ...profileRevisionIds.map((revisionId) => ({
        message_id: null,
        memory_revision_id: revisionId,
        purpose: "profile_support",
      })),
    ],
  };
}

function displayValue(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.values(parsed).filter((part) => typeof part === "string" && part).join(" / ") || value;
  } catch {
    return value;
  }
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
