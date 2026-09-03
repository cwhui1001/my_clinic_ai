import type { PatientSessionStatus, SourceChannel } from "@/src/types/database";
import type { PatientMessageDto } from "@/src/types/patient-chat";

export type PatientSessionView = {
  id: string;
  status: PatientSessionStatus;
  startedAt: string;
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
};
