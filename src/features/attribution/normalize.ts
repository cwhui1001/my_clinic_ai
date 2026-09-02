import type { AcquisitionRequest } from "@/src/features/attribution/schema";
import type { Attribution } from "@/src/types/lead-session";
import type {
  IdentityLevel,
  SocialPlatform,
  SourceChannel,
} from "@/src/types/database";

const SOURCE_ALIASES: Record<string, SourceChannel> = {
  instagram: "instagram_ad_click",
  google: "google_ad_click",
  website: "website_widget",
};

function cleanOptional(value: string | undefined) {
  const clean = value?.trim();
  return clean ? clean : null;
}

export function normalizePagePath(value: string | undefined) {
  if (!value) return null;

  try {
    const parsed = new URL(value, "https://nightingale.invalid");
    return parsed.pathname.slice(0, 500);
  } catch {
    return null;
  }
}

export function normalizeReferrerOrigin(value: string | null) {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function normalizeAttribution(
  input: AcquisitionRequest,
  options: { landedAt?: Date; referrer?: string | null } = {},
): Attribution {
  const sourceChannel = SOURCE_ALIASES[input.source] ?? input.source;
  let identityLevel: IdentityLevel = "anonymous";
  let socialPlatform: SocialPlatform | null = null;

  if (sourceChannel === "social_comment") {
    if (!input.socialPlatform) {
      throw new Error("socialPlatform is required for social_comment.");
    }
    identityLevel = "social_handle";
    socialPlatform = input.socialPlatform;
  } else if (sourceChannel === "lead_form") {
    identityLevel = "email";
  }

  const pagePath = normalizePagePath(input.pagePath);
  const referrerOrigin = normalizeReferrerOrigin(options.referrer ?? null);

  return {
    clinicSlug: input.clinicSlug,
    sourceChannel,
    socialPlatform,
    campaignId: cleanOptional(input.campaignId),
    creative: cleanOptional(input.creative),
    identityLevel,
    landingTimestamp: (options.landedAt ?? new Date()).toISOString(),
    landingContext: {
      ...(pagePath ? { page_path: pagePath } : {}),
      ...(referrerOrigin ? { referrer_origin: referrerOrigin } : {}),
    },
  };
}
