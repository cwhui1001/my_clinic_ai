import "server-only";

import { z } from "zod";

import { normalizeAttribution } from "@/src/features/attribution/normalize";
import type { AcquisitionRequest } from "@/src/features/attribution/schema";
import { getServerEnv } from "@/src/config/server-env";
import { encryptLeadContext } from "@/src/server/crypto/lead-context";
import { decryptProtectedContent, hashProtectedContent } from "@/src/server/crypto/protected-content";
import { normalizePhone } from "@/src/features/consent/schema";
import {
  createGuestToken,
  hashGuestToken,
} from "@/src/server/crypto/guest-token";
import { createAdminClient } from "@/src/server/supabase/admin";
import type { Json } from "@/src/types/database";
import type { LeadSessionDto, OpeningStrategy } from "@/src/types/lead-session";

const openingStrategySchema = z.object({
  headline: z.string(),
  prompt: z.string(),
});

export class LeadSessionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "clinic_not_found"
      | "rate_limited"
      | "not_found"
      | "database_error",
  ) {
    super(message);
  }
}

function getTimeOfDay(timezone: string, date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: timezone,
    }).format(date),
  );

  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "overnight";
}

async function getClinic(clinicId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("clinics")
    .select("id, slug, name, timezone")
    .eq("id", clinicId)
    .single();

  if (error || !data) {
    throw new LeadSessionError("Clinic lookup failed.", "database_error");
  }

  return data;
}

async function getOpeningStrategy(
  clinicId: string,
  sourceChannel: LeadSessionDto["attribution"]["sourceChannel"],
  identityLevel: LeadSessionDto["attribution"]["identityLevel"],
  timezone: string,
): Promise<OpeningStrategy | null> {
  const supabase = createAdminClient();
  const period = getTimeOfDay(timezone);
  const { data, error } = await supabase
    .from("channel_rules")
    .select("opening_strategy, time_of_day")
    .eq("clinic_id", clinicId)
    .eq("source_channel", sourceChannel)
    .eq("identity_level", identityLevel)
    .eq("active", true)
    .in("time_of_day", [period, "any"])
    .order("priority", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new LeadSessionError("Opening strategy lookup failed.", "database_error");
  }

  const parsed = openingStrategySchema.safeParse(data?.opening_strategy);
  return parsed.success ? parsed.data : null;
}

async function toDto(
  row: {
    id: string;
    clinic_id: string;
    status: LeadSessionDto["status"];
    source_channel: LeadSessionDto["attribution"]["sourceChannel"];
    social_platform: LeadSessionDto["attribution"]["socialPlatform"];
    campaign_id: string | null;
    creative: string | null;
    identity_level: LeadSessionDto["attribution"]["identityLevel"];
    landing_timestamp: string;
    landing_context: Json;
    context_ciphertext: string | null;
    expires_at: string;
  },
): Promise<LeadSessionDto> {
  const clinic = await getClinic(row.clinic_id);
  const openingStrategy = await getOpeningStrategy(
    clinic.id,
    row.source_channel,
    row.identity_level,
    clinic.timezone,
  );

  return {
    id: row.id,
    clinic: { id: clinic.id, slug: clinic.slug, name: clinic.name },
    status: row.status,
    attribution: {
      clinicSlug: clinic.slug,
      sourceChannel: row.source_channel,
      socialPlatform: row.social_platform,
      campaignId: row.campaign_id,
      creative: row.creative,
      identityLevel: row.identity_level,
      landingTimestamp: row.landing_timestamp,
      landingContext:
        row.landing_context &&
        typeof row.landing_context === "object" &&
        !Array.isArray(row.landing_context)
          ? row.landing_context
          : {},
    },
    expiresAt: row.expires_at,
    openingStrategy,
    preloadedContext: row.context_ciphertext
      ? decryptProtectedContent(row.context_ciphertext)
      : null,
  };
}

export async function createLeadSession(
  input: AcquisitionRequest,
  requestContext: { fingerprintHash: string; referrer: string | null },
) {
  const env = getServerEnv();
  const landedAt = new Date();
  const attribution = normalizeAttribution(input, {
    landedAt,
    referrer: requestContext.referrer,
  });
  const recoveryToken = createGuestToken();
  const recoveryTokenHash = hashGuestToken(recoveryToken);
  const expiresAt = new Date(
    landedAt.getTime() + env.LEAD_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const supabase = createAdminClient();
  const capturedPhone = input.phone ? normalizePhone(input.phone) : null;

  const { data, error } = await supabase
    .rpc("create_lead_session_v2", {
      p_clinic_slug: attribution.clinicSlug,
      p_source_channel: attribution.sourceChannel,
      p_social_platform: attribution.socialPlatform,
      p_campaign_id: attribution.campaignId,
      p_creative: attribution.creative,
      p_identity_level: attribution.identityLevel,
      p_landing_timestamp: attribution.landingTimestamp,
      p_landing_context: attribution.landingContext,
      p_context_ciphertext: encryptLeadContext(input.context),
      p_social_handle_ciphertext: encryptLeadContext(input.socialHandle),
      p_phone_ciphertext: encryptLeadContext(capturedPhone ?? undefined),
      p_phone_hash: capturedPhone ? hashProtectedContent(capturedPhone) : null,
      p_recovery_token_hash: recoveryTokenHash,
      p_request_fingerprint_hash: requestContext.fingerprintHash,
      p_expires_at: expiresAt.toISOString(),
    })
    .single();

  if (error || !data) {
    if (error?.code === "P0001") {
      throw new LeadSessionError("Too many sessions created.", "rate_limited");
    }
    if (error?.code === "P0002") {
      throw new LeadSessionError("Clinic not found.", "clinic_not_found");
    }
    throw new LeadSessionError("LeadSession creation failed.", "database_error");
  }

  return { session: await toDto(data), recoveryToken };
}

export async function getLeadSessionByRecoveryToken(recoveryToken: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("lead_sessions")
    .select(
      "id, clinic_id, status, source_channel, social_platform, campaign_id, creative, identity_level, landing_timestamp, landing_context, context_ciphertext, expires_at",
    )
    .eq("recovery_token_hash", hashGuestToken(recoveryToken))
    .in("status", ["active", "auth_started"])
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw new LeadSessionError("LeadSession lookup failed.", "database_error");
  }
  if (!data) {
    throw new LeadSessionError("LeadSession not found.", "not_found");
  }

  return toDto(data);
}

export async function markLeadAuthStarted(recoveryToken: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("mark_lead_auth_started", {
    p_recovery_token_hash: hashGuestToken(recoveryToken),
  });

  if (error || !data) {
    if (error?.code === "P0003") {
      throw new LeadSessionError("LeadSession not found.", "not_found");
    }
    throw new LeadSessionError("Unable to mark authentication start.", "database_error");
  }

  return data;
}
