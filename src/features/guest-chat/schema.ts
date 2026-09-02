import { z } from "zod";

export const guestMessageRequestSchema = z
  .object({
    clientMessageId: z.string().uuid(),
    message: z.string().trim().min(1).max(2000),
  })
  .strict();

export type GuestMessageRequest = z.infer<typeof guestMessageRequestSchema>;
