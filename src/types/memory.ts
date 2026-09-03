import type { MemoryKind, MemoryStatus, ResponseConfidence } from "@/src/types/database";

export type MemoryRevisionDto = {
  id: string;
  value: string;
  status: MemoryStatus;
  sourceMessageId: string;
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
