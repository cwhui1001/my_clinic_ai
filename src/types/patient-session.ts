import type { GuestMessageDto } from "@/src/types/guest-chat";
import type { PatientSessionStatus, SourceChannel } from "@/src/types/database";

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
  messages: GuestMessageDto[];
};
