import { z } from "zod";

const historySchema = z.object({
  revisionId: z.string().uuid(),
  value: z.string().max(4000),
  status: z.enum(["active", "stopped", "resolved", "corrected"]),
  sourceMessageId: z.string().uuid(),
  sourceIntegrity: z.enum(["verified", "changed", "unavailable"]),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();

const conflictSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["allergy_presence", "medication_status", "dosage"]),
  leftRevisionId: z.string().uuid(),
  rightRevisionId: z.string().uuid(),
}).strict();

export const escalationProfileSnapshotSchema = z.array(z.object({
  kind: z.enum(["chief_complaint", "symptom", "medication", "allergy"]),
  canonicalKey: z.string().min(1).max(200),
  value: z.string().max(4000),
  status: z.enum(["active", "stopped", "resolved", "corrected"]),
  revisionId: z.string().uuid(),
  sourceMessageId: z.string().uuid(),
  sourceContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  sourceIntegrity: z.enum(["verified", "changed", "unavailable"]),
  sourceSnapshot: z.string().max(240),
  contradictionStatus: z.literal("open").nullable(),
  conflicts: z.array(conflictSchema).max(20),
  history: z.array(historySchema).max(4),
}).strict()).max(100);

export const escalationTriageSummarySchema = z.array(z.string().min(1).max(1200)).min(1).max(5);

export const escalationAttributionSchema = z.object({
  source_channel: z.string().min(1).max(80),
  social_platform: z.string().max(80).nullable(),
  campaign_id: z.string().max(160).nullable(),
  creative: z.string().max(160).nullable(),
  landing_timestamp: z.string().datetime({ offset: true }),
  landing_context: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  acquisition_identity_level: z.enum(["anonymous", "social_handle", "email", "authenticated"]),
  current_identity_level: z.literal("authenticated"),
  identity_verified: z.boolean(),
  authentication_method: z.enum(["email_password", "phone_otp", "legacy_unknown"]),
}).strict();
