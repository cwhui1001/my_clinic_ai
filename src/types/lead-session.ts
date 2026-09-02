import type {
  IdentityLevel,
  Json,
  LeadStatus,
  SocialPlatform,
  SourceChannel,
} from "@/src/types/database";

export type Attribution = {
  clinicSlug: string;
  sourceChannel: SourceChannel;
  socialPlatform: SocialPlatform | null;
  campaignId: string | null;
  creative: string | null;
  identityLevel: IdentityLevel;
  landingTimestamp: string;
  landingContext: Record<string, Json | undefined>;
};

export type OpeningStrategy = {
  headline: string;
  prompt: string;
};

export type LeadSessionDto = {
  id: string;
  clinic: { id: string; slug: string; name: string };
  status: LeadStatus;
  attribution: Attribution;
  expiresAt: string;
  openingStrategy: OpeningStrategy | null;
};
