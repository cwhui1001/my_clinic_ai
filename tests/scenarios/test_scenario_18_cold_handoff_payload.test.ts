import { describe, expect, it } from "vitest";

import { escalationAttributionSchema, escalationProfileSnapshotSchema, escalationTriageSummarySchema } from "../../src/features/escalation/schema";

const attribution = {
  source_channel: "social_comment",
  social_platform: "instagram",
  campaign_id: "campaign-a",
  creative: "creative-b",
  landing_timestamp: "2026-09-10T01:00:00.000Z",
  landing_context: { page_path: "/" },
  acquisition_identity_level: "social_handle",
  current_identity_level: "authenticated",
  identity_verified: true,
  authentication_method: "phone_otp",
};

describe("test_scenario_18_cold_handoff_payload", () => {
  it("requires a bounded complaint/risk summary and minimized acquisition identity", () => {
    expect(escalationTriageSummarySchema.safeParse([
      "High risk (high confidence): urgent symptom pattern matched.",
      "Patient reported: crushing chest pain.",
      "Current profile includes medication: Advil (stopped).",
      "One medication contradiction requires clarification.",
    ]).success).toBe(true);
    expect(escalationAttributionSchema.safeParse(attribution).success).toBe(true);
    expect(escalationAttributionSchema.safeParse({ ...attribution, phone: "+60123456789" }).success).toBe(false);
  });

  it("rejects profile snapshots with contact PII or malformed provenance fields", () => {
    const fact = {
      kind: "medication",
      canonicalKey: "advil",
      value: JSON.stringify({ name: "Advil", dose: "200mg" }),
      status: "stopped",
      revisionId: "10000000-0000-4000-8000-000000000018",
      sourceMessageId: "10000000-0000-4000-8000-000000000019",
      sourceContentHash: "a".repeat(64),
      sourceIntegrity: "verified",
      sourceSnapshot: "Actually I stopped Advil last week",
      contradictionStatus: "open",
      conflicts: [{ id: "10000000-0000-4000-8000-000000000020", kind: "medication_status", leftRevisionId: "10000000-0000-4000-8000-000000000021", rightRevisionId: "10000000-0000-4000-8000-000000000018" }],
      history: [{ revisionId: "10000000-0000-4000-8000-000000000018", value: JSON.stringify({ name: "Advil" }), status: "stopped", sourceMessageId: "10000000-0000-4000-8000-000000000019", sourceIntegrity: "verified", updatedAt: "2026-09-10T01:00:00.000Z" }],
    };
    expect(escalationProfileSnapshotSchema.safeParse([fact]).success).toBe(true);
    expect(escalationProfileSnapshotSchema.safeParse([{ ...fact, socialHandle: "@private" }]).success).toBe(false);
  });
});
