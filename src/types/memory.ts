import type {
  MemoryConflictKind,
  MemoryConflictStatus,
  MemoryKind,
  MemoryStatus,
  ResponseConfidence,
} from "@/src/types/database";

export type MemorySourceIntegrity = "verified" | "changed" | "unavailable";

export type MemoryConflictDto = {
  id: string;
  kind: MemoryConflictKind;
  status: MemoryConflictStatus;
  leftRevisionId: string;
  rightRevisionId: string;
  createdAt: string;
};

export type MemoryRevisionDto = {
  id: string;
  value: string;
  status: MemoryStatus;
  sourceMessageId: string;
  sourceContentHash: string;
  sourceSnapshot: string;
  sourceIntegrity: MemorySourceIntegrity;
  contradictionStatus: MemoryConflictStatus | null;
  supersedesRevisionId: string | null;
  modelRunId: string | null;
  confidence: ResponseConfidence;
  effectiveAt: string | null;
  updatedAt: string;
};

export type MemoryItemDto = {
  id: string;
  kind: MemoryKind;
  canonicalKey: string;
  updatedAt: string;
  currentRevisionId: string;
  revisions: MemoryRevisionDto[];
  conflicts: MemoryConflictDto[];
};

export type MemoryCurrentFact = {
  itemId: string;
  kind: MemoryKind;
  canonicalKey: string;
  value: string;
  status: MemoryStatus;
  confidence: ResponseConfidence;
  updatedAt: string;
};

export type MemoryProposal = {
  sourceMessageId: string;
  kind: MemoryKind;
  canonicalKey: string;
  value: string;
  status: MemoryStatus;
  confidence: ResponseConfidence;
  effectiveAt: string | null;
};
