import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { conversionRequestSchema } from "../../src/features/consent/schema";
import { HEALTHCARE_CONSENT_NOTICE_VERSION, HEALTHCARE_CONSENT_POLICY_VERSION, MARKETING_CONSENT_NOTICE_VERSION, MARKETING_CONSENT_POLICY_VERSION } from "../../src/features/consent/constants";

const migration = readFileSync(resolve("supabase/migrations/202609100004_identity_consent_escalation.sql"), "utf8");
const form = readFileSync(resolve("app/components/consent-form.tsx"), "utf8");

const base = {
  phone: "+60123456789",
  healthcareConsent: true as const,
  policyVersion: HEALTHCARE_CONSENT_POLICY_VERSION,
  noticeVersion: HEALTHCARE_CONSENT_NOTICE_VERSION,
  marketingPolicyVersion: MARKETING_CONSENT_POLICY_VERSION,
  marketingNoticeVersion: MARKETING_CONSENT_NOTICE_VERSION,
};

describe("test_scenario_07_separate_consents", () => {
  it("keeps required clinical consent separate from optional default-off marketing consent", () => {
    expect(conversionRequestSchema.safeParse({ ...base, marketingConsent: false }).success).toBe(true);
    expect(conversionRequestSchema.safeParse({ ...base, marketingConsent: true }).success).toBe(true);
    expect(form).toContain('name="marketingConsent" type="checkbox"');
    expect(form).not.toContain('name="marketingConsent" type="checkbox" required');
    expect(migration).toContain("if p_marketing_consent then");
  });

  it("records versioned append-only grants/withdrawals and resolves newest event with false as zero state", () => {
    expect(migration).toContain("public.record_marketing_email_consent");
    expect(migration).toContain("p_action public.consent_action");
    expect(migration).toContain("public.has_current_marketing_email_consent");
    expect(migration).toContain("order by consent_events.occurred_at desc, consent_events.id desc");
    expect(migration).toContain("), false)");
  });
});
