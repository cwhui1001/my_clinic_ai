import { describe, expect, it } from "vitest";

import {
  normalizeAttribution,
  normalizePagePath,
  normalizeReferrerOrigin,
} from "../../src/features/attribution/normalize";
import { acquisitionRequestSchema } from "../../src/features/attribution/schema";

describe("acquisition request validation", () => {
  it("rejects unknown fields so arbitrary data cannot enter attribution", () => {
    const result = acquisitionRequestSchema.safeParse({
      clinicSlug: "nightingale-demo",
      source: "website_widget",
      patientName: "must-not-be-accepted",
    });

    expect(result.success).toBe(false);
  });
});

describe("attribution normalization", () => {
  it("normalizes the instagram alias and keeps campaign attribution", () => {
    const attribution = normalizeAttribution(
      {
        clinicSlug: "nightingale-demo",
        source: "instagram",
        campaignId: "ivf_over40",
        creative: "reel_01",
        pagePath: "/fertility?email=remove@example.com",
      },
      {
        landedAt: new Date("2026-09-02T01:00:00.000Z"),
        referrer: "https://www.instagram.com/p/example?tracking=secret",
      },
    );

    expect(attribution).toMatchObject({
      clinicSlug: "nightingale-demo",
      sourceChannel: "instagram_ad_click",
      identityLevel: "anonymous",
      campaignId: "ivf_over40",
      creative: "reel_01",
      landingTimestamp: "2026-09-02T01:00:00.000Z",
      landingContext: {
        page_path: "/fertility",
        referrer_origin: "https://www.instagram.com",
      },
    });
  });

  it("derives social-handle identity from a social comment", () => {
    const attribution = normalizeAttribution({
      clinicSlug: "nightingale-demo",
      source: "social_comment",
      socialPlatform: "tiktok",
      socialHandle: "@prospect",
    });

    expect(attribution.sourceChannel).toBe("social_comment");
    expect(attribution.socialPlatform).toBe("tiktok");
    expect(attribution.identityLevel).toBe("social_handle");
  });

  it("requires a platform and handle for a social comment", () => {
    const result = acquisitionRequestSchema.safeParse({
      clinicSlug: "nightingale-demo",
      source: "social_comment",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(
        expect.arrayContaining(["socialPlatform", "socialHandle"]),
      );
    }
  });

  it("derives email identity for a lead form without accepting email as attribution", () => {
    const attribution = normalizeAttribution({
      clinicSlug: "nightingale-demo",
      source: "lead_form",
    });

    expect(attribution.identityLevel).toBe("email");
    expect(attribution.landingContext).toEqual({});
  });

  it("requires preloaded context for a staff referral", () => {
    const result = acquisitionRequestSchema.safeParse({
      clinicSlug: "nightingale-demo",
      source: "staff_referral",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["context"]);
    }
  });
});

describe("safe URL metadata", () => {
  it("retains only a page path and strips query values", () => {
    expect(normalizePagePath("/care?phone=60123456789#private")).toBe("/care");
  });

  it("retains only the referrer origin", () => {
    expect(
      normalizeReferrerOrigin("https://example.com/person/john?phone=123"),
    ).toBe("https://example.com");
  });
});
