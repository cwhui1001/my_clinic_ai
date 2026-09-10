import { z } from "zod";

export const authCredentialsSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z
      .string()
      .min(8)
      .max(128)
      .regex(/[A-Za-z]/)
      .regex(/[0-9]/),
  })
  .strict();

export const signupCredentialsSchema = authCredentialsSchema.extend({
  phone: z.string().trim().min(8).max(30),
});

export const phoneOtpStartSchema = z.object({
  phone: z.string().trim().min(8).max(30).regex(/^\+?[0-9\s().-]+$/),
}).strict();

export const phoneOtpVerifySchema = phoneOtpStartSchema.extend({
  token: z.string().trim().regex(/^\d{6}$/),
});
