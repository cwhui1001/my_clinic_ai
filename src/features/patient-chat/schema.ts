import { z } from "zod";

export const patientMessageRequestSchema = z
  .object({
    clientMessageId: z.string().uuid(),
    message: z.string().trim().min(1).max(2000),
  })
  .strict();

export type PatientMessageRequest = z.infer<typeof patientMessageRequestSchema>;
