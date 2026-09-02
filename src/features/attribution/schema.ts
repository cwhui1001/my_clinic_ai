import { z } from "zod";

export const acquisitionRequestSchema = z
  .object({
    clinicSlug: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    source: z.enum([
      "staff_referral",
      "social_comment",
      "instagram_ad_click",
      "google_ad_click",
      "lead_form",
      "google_reviews",
      "website_widget",
      "instagram",
      "google",
      "website",
    ]),
    socialPlatform: z.enum(["instagram", "tiktok", "facebook"]).optional(),
    socialHandle: z.string().trim().min(1).max(160).optional(),
    campaignId: z.string().trim().max(160).optional(),
    creative: z.string().trim().max(160).optional(),
    pagePath: z.string().trim().max(500).optional(),
    context: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.source === "social_comment" && !value.socialPlatform) {
      context.addIssue({
        code: "custom",
        path: ["socialPlatform"],
        message: "A social platform is required for social comments.",
      });
    }
    if (value.source === "social_comment" && !value.socialHandle) {
      context.addIssue({
        code: "custom",
        path: ["socialHandle"],
        message: "A social handle is required for social comments.",
      });
    }
    if (value.source === "staff_referral" && !value.context) {
      context.addIssue({
        code: "custom",
        path: ["context"],
        message: "Preloaded context is required for staff referrals.",
      });
    }
  });

export type AcquisitionRequest = z.infer<typeof acquisitionRequestSchema>;
