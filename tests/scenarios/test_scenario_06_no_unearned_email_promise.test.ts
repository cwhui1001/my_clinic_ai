import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const userSurfaces = [
  "app/components/guest-chat.tsx",
  "app/components/patient-chat.tsx",
  "app/components/lead-session-starter.tsx",
  "app/components/consent-form.tsx",
  "app/components/push-notification-control.tsx",
  "app/components/guest-recovery.tsx",
].map((file) => readFileSync(resolve(file), "utf8")).join("\n");

describe("test_scenario_06_no_unearned_email_promise", () => {
  it("contains no promise to email a summary or notify through an unavailable channel", () => {
    expect(userSurfaces).not.toMatch(/(?:we(?:'ll| will)|will) email (?:you|your)|email(?:ed)? (?:you|your) (?:a )?(?:conversation )?summary/i);
    expect(userSurfaces).not.toMatch(/we(?:'ll| will) notify you/i);
  });

  it("does not hardcode a 12–18 hour response promise", () => {
    expect(userSurfaces).not.toMatch(/respond within\s*\{?.*12.*18.*hours/i);
    expect(userSurfaces).toContain("This is an expectation, not a guaranteed response time.");
  });
});
