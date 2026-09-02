import { describe, expect, it } from "vitest";

import {
  assertPhiSafe,
  redactPhi,
  REDACTION_TOKEN,
} from "../../src/features/redaction/redact";

describe("guest PHI redaction", () => {
  it("redacts the required name and IC example before model use", () => {
    const result = redactPhi("My name is John Doe and my IC is S1234567A.");

    expect(result.text).toContain(REDACTION_TOKEN);
    expect(result.text).not.toContain("John Doe");
    expect(result.text).not.toContain("S1234567A");
    expect(result.categories).toEqual(
      expect.arrayContaining(["name", "government_id"]),
    );
    expect(() => assertPhiSafe(result.text)).not.toThrow();
  });

  it("redacts Malaysian phone numbers and email addresses", () => {
    const result = redactPhi(
      "Reach me at +60 12-345 6789 or patient@example.com.",
    );

    expect(result.text).not.toContain("+60 12-345 6789");
    expect(result.text).not.toContain("patient@example.com");
    expect(result.counts.phone).toBe(1);
    expect(result.counts.email).toBe(1);
  });

  it("detects an identifier if a redaction regression leaves it behind", () => {
    expect(() => assertPhiSafe("Contact +60123456789")).toThrow(
      "PHI redaction assertion failed.",
    );
  });
});
