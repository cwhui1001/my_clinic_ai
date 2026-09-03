import type { EscalationStatus, Json, MemberRole, RiskLevel, SourceChannel } from "@/src/types/database";

export type PatientEscalationDto = {
  id: string;
  triggerMessageId: string;
  riskLevel: RiskLevel;
  status: EscalationStatus;
  responseMinHours: number | null;
  responseMaxHours: number | null;
  responseExpectedBy: string | null;
  sentAt: string | null;
  createdAt: string;
};

export type StaffMembershipDto = {
  id: string;
  clinicId: string;
  clinicName: string;
  role: MemberRole;
};

export type EscalationQueueItemDto = {
  id: string;
  clinicName: string;
  patientReference: string;
  riskLevel: RiskLevel;
  status: Exclude<EscalationStatus, "required">;
  summary: string[];
  responseExpectedBy: string;
  sentAt: string;
};

export type ClinicianResponseDto = {
  id: string;
  authorRole: MemberRole;
  content: string;
  createdAt: string;
};

export type EscalationReviewDto = EscalationQueueItemDto & {
  patientSessionId: string;
  triggerMessageId: string;
  triggerMessage: string;
  riskReason: string;
  riskConfidence: "low" | "med" | "high";
  profileSnapshot: Array<{
    kind: string;
    canonicalKey: string;
    value: string;
    status: string;
    revisionId: string;
    sourceMessageId: string;
  }>;
  attribution: {
    sourceChannel: SourceChannel;
    socialPlatform: string | null;
    campaignId: string | null;
    creative: string | null;
    landingTimestamp: string;
    landingContext: Json;
  };
  provenance: Array<{
    purpose: "trigger" | "summary_support" | "profile_support";
    messageId: string | null;
    memoryRevisionId: string | null;
  }>;
  responses: ClinicianResponseDto[];
  canRespond: boolean;
};
