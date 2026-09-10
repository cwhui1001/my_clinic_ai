import type { MemoryBootstrapStatus, PatientSessionStatus, SourceChannel } from "@/src/types/database";
import type { PatientMessageDto } from "@/src/types/patient-chat";
import type { MemoryItemDto } from "@/src/types/memory";
import type { PatientEscalationDto } from "@/src/types/escalation";

export type PatientSessionView = {
  id: string;
  status: PatientSessionStatus;
  startedAt: string;
  memoryBootstrapStatus: MemoryBootstrapStatus;
  continuedFromGuest: boolean;
  clinic: { id: string; name: string };
  patientEmail: string;
  consentedAt: string;
  preloadedContext: string | null;
  attribution: {
    sourceChannel: SourceChannel;
    campaignId: string | null;
    creative: string | null;
    landingTimestamp: string;
  };
  messages: PatientMessageDto[];
  memory: MemoryItemDto[];
  escalations: PatientEscalationDto[];
};
