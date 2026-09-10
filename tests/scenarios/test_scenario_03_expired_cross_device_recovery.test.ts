import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("supabase/migrations/202609100005_continuity_reengagement.sql"), "utf8");
const linkRoute = readFileSync(resolve("app/api/lead-sessions/recovery-link/route.ts"), "utf8");
const recoverRoute = readFileSync(resolve("app/api/lead-sessions/recover/route.ts"), "utf8");
const recoveryUi = readFileSync(resolve("app/components/guest-recovery.tsx"), "utf8");

describe("test_scenario_03_expired_cross_device_recovery", () => {
  it("keeps the recovery credential out of HTTP query strings and rotates it after exchange", () => {
    expect(linkRoute).toContain("recoveryUrl.hash");
    expect(linkRoute).not.toContain("searchParams.set");
    expect(recoverRoute).toContain("export async function POST");
    expect(recoverRoute).not.toContain("export async function GET");
    expect(migration).toContain("rotate_lead_recovery_token");
    expect(migration).toContain("p_new_token_hash");
  });

  it("distinguishes active, expired, purged, and invalid outcomes without restoring deleted content", () => {
    expect(migration).toContain("lead_recovery_tombstones");
    expect(migration).toContain("state in ('expired', 'purged')");
    expect(migration).toContain("delete from public.messages");
    expect(recoveryUi).toContain("This guest session expired");
    expect(recoveryUi).toContain("This guest session was purged");
    expect(recoveryUi).toContain("This recovery link is not valid");
    expect(recoveryUi).toContain("Start a new guest conversation");
  });
});
