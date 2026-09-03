import { describe, expect, it } from "vitest";

import { authCredentialsSchema, signupCredentialsSchema } from "../../src/features/auth/schema";
import { HEALTHCARE_CONSENT_NOTICE_VERSION, HEALTHCARE_CONSENT_POLICY_VERSION } from "../../src/features/consent/constants";
import { conversionRequestSchema, normalizePhone } from "../../src/features/consent/schema";

describe("authentication input", () => {
  it("requires a valid email and a password with a letter and number", () => {
    expect(authCredentialsSchema.safeParse({ email: "patient@example.com", password: "carepath1" }).success).toBe(true);
    expect(authCredentialsSchema.safeParse({ email: "patient@example.com", password: "allletters" }).success).toBe(false);
    expect(authCredentialsSchema.safeParse({ email: "not-an-email", password: "carepath1" }).success).toBe(false);
  });

  it("requires phone collection at signup and rejects extra fields", () => {
    expect(signupCredentialsSchema.safeParse({ email: "patient@example.com", password: "carepath1", phone: "+60 12 345 6789" }).success).toBe(true);
    expect(signupCredentialsSchema.safeParse({ email: "patient@example.com", password: "carepath1", phone: "+60 12 345 6789", role: "clinician" }).success).toBe(false);
  });
});

describe("conversion consent", () => {
  it("normalizes accepted phone formatting without changing the number", () => {
    expect(normalizePhone("+60 (12) 345-6789")).toBe("+60123456789");
    expect(normalizePhone("not a phone")).toBeNull();
  });

  it("requires explicit true consent and versioned evidence", () => {
    const base = { phone: "+60123456789", policyVersion: HEALTHCARE_CONSENT_POLICY_VERSION, noticeVersion: HEALTHCARE_CONSENT_NOTICE_VERSION };
    expect(conversionRequestSchema.safeParse({ ...base, healthcareConsent: true }).success).toBe(true);
    expect(conversionRequestSchema.safeParse({ ...base, healthcareConsent: false }).success).toBe(false);
    expect(conversionRequestSchema.safeParse({ ...base, healthcareConsent: true, marketingConsent: true }).success).toBe(false);
  });
});
