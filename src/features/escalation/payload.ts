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
    return revision ? [{
      kind: item.kind,
      canonicalKey: item.canonicalKey,
      value: revision.value,
      status: revision.status,
      revisionId: revision.id,
      sourceMessageId: revision.sourceMessageId,
    }] : [];
  });

  const triageSummary = [
    `${capitalize(input.risk.level)} risk (${input.risk.confidence} confidence): ${input.risk.reason}`,
    `Patient reported: ${input.triggerMessage.trim().slice(0, 500)}`,
    profileSnapshot.length
      ? `Current profile includes ${profileSnapshot.map((fact) => `${fact.kind.replaceAll("_", " ")}: ${displayValue(fact.value)} (${fact.status})`).join("; ").slice(0, 700)}.`
      : "No structured profile facts were available when this handoff was sent.",
  ];

  return {
    triageSummary,
    profileSnapshot,
    provenance: [
      { message_id: input.triggerMessageId, memory_revision_id: null, purpose: "trigger" },
      ...profileSnapshot.map((fact) => ({
        message_id: null,
        memory_revision_id: fact.revisionId,
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
