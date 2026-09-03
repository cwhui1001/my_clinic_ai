import { z } from "zod";

export const conversionRequestSchema = z
  .object({
    phone: z.string().trim().min(8).max(30),
    healthcareConsent: z.literal(true),
    policyVersion: z.string().min(1).max(100),
    noticeVersion: z.string().min(1).max(100),
  })
  .strict();

export function normalizePhone(value: string) {
  const normalized = value.replace(/[\s().-]/g, "");
  if (!/^\+?\d{8,15}$/.test(normalized)) return null;
  return normalized;
}
