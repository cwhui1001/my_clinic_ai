import { z } from "zod";

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  expirationTime: z.number().int().positive().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(20).max(512),
    auth: z.string().min(10).max(512),
  }).strict(),
}).strict();

export const pushSubscriptionRequestSchema = z.object({
  patientSessionId: z.string().uuid(),
  subscription: pushSubscriptionSchema,
}).strict();

export const pushUnsubscribeRequestSchema = z.object({
  patientSessionId: z.string().uuid(),
  endpoint: z.string().url().max(2048),
}).strict();
