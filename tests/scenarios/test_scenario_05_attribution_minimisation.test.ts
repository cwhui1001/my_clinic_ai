import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { escalationAttributionSchema } from "../../src/features/escalation/schema";

const migration = readFileSync(resolve("supabase/migrations/202609100004_identity_consent_escalation.sql"), "utf8");

const attribution = {
  source_channel: "social_comment",
  social_platform: "instagram",
  campaign_id: "fertility-sept",
  creative: "comment-reply-a",
  landing_timestamp: "2026-09-10T01:00:00.000Z",
  landing_context: { page_path: "/", referrer_origin: "https://instagram.com" },
  acquisition_identity_level: "social_handle",
  current_identity_level: "authenticated",
  identity_verified: true,
  authentication_method: "phone_otp",
};

describe("test_scenario_05_attribution_minimisation", () => {
  it("preserves original and current identity separately across conversion and escalation", () => {
    expect(migration).toContain("acquisition_identity_level");
    expect(migration).toContain("v_lead.identity_level");
    expect(migration).toContain("preserve_acquisition_identity_on_funnel");
    expect(escalationAttributionSchema.parse(attribution)).toEqual(attribution);
  });

  it("fails closed if contact PII is added to the long-lived attribution snapshot", () => {
    for (const pii of ["email", "phone", "social_handle"]) {
      expect(escalationAttributionSchema.safeParse({ ...attribution, [pii]: "private-value" }).success).toBe(false);
    }
    expect(migration).toContain("new.attribution_snapshot - 'email' - 'phone' - 'social_handle'");
  });
});
