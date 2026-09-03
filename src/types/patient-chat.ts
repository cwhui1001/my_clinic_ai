import type {
  MessageActor,
  MessageStatus,
  ResponseConfidence,
  RiskLevel,
} from "@/src/types/database";
import type { MemoryItemDto } from "@/src/types/memory";

export type PatientRiskDto = {
  level: RiskLevel;
  reason: string;
  confidence: ResponseConfidence;
  escalationRequired: boolean;
  ruleMatches: string[];
  pipelineVersion: string;
  provenance: {
    source: "deterministic" | "model" | "fallback";
    assessedAt: string;
  };
};

export type CitationDto = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  version: string;
};

export type PatientMessageDto = {
  id: string;
  actor: MessageActor;
  status: MessageStatus;
  content: string;
  createdAt: string;
  risk: PatientRiskDto | null;
  citations: CitationDto[];
};

export type PatientReplyDto = {
  patientMessage: PatientMessageDto;
  assistantMessage: PatientMessageDto;
  memory: MemoryItemDto[];
};
