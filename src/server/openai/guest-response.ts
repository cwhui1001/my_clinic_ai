import "server-only";

import { z } from "zod";

import { getGeminiEnv } from "@/src/config/server-env";
import { fetchWithProviderTimeout, ProviderRequestTimeoutError } from "@/src/server/openai/provider-timeout";
import type { GuestIntent } from "@/src/features/guest-chat/policy";

type ClinicPublicProfile = {
  services: string[];
  hoursSummary: string;
  availabilitySummary: string;
  generalNote: string;
};

type GeminiResponsePayload = {
  responseId?: string;
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

export class GuestModelError extends Error {
  constructor(public readonly code: "configuration" | "timeout" | "provider" | "invalid_output") {
    super(code);
  }
}

function extractOutputText(payload: GeminiResponsePayload) {
  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.text) return part.text;
    }
  }
  return null;
}

export async function createGuestModelReply(input: {
  intent: Exclude<GuestIntent, "emergency" | "trust">;
  redactedMessage: string;
  redactedPreloadedContext: string | null;
  clinicName: string;
  clinicProfile: ClinicPublicProfile;
}) {
  let env: ReturnType<typeof getGeminiEnv>;
  try {
    env = getGeminiEnv();
  } catch {
    throw new GuestModelError("configuration");
  }

  const concernMode = input.intent === "clinical_summary";
  const maximumLength = concernMode ? 240 : 1000;
  const outputSchema = z.object({
    answer: z.string().trim().min(1).max(maximumLength),
  });
  const startedAt = Date.now();

  try {
    const response = await fetchWithProviderTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: [
              "You are Nightingale AI, an assistant for a healthcare clinic guest portal.",
              "You are not a doctor. Never diagnose, assess risk, recommend treatment, recommend medication changes, or reassure a guest that a symptom is safe.",
              "Use only the supplied clinic profile for clinic-specific claims. Never invent services, hours, availability, statistics, outcomes, or clinician involvement.",
              concernMode
                ? "Return only a neutral, empathetic, first-person concern-sharing summary the guest could send to the clinic. Keep it at or below 240 characters and do not add advice."
                : "Answer the general question helpfully and concisely. If the question needs patient-specific clinical judgment, explain that secure human follow-up is needed.",
              "Do not reproduce or guess identifiers represented by [REDACTED].",
            ].join("\n"),
          }],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: JSON.stringify({
                  requested_mode: input.intent,
                  clinic: {
                    name: input.clinicName,
                    services: input.clinicProfile.services,
                    hours: input.clinicProfile.hoursSummary,
                    availability: input.clinicProfile.availabilitySummary,
                    boundary: input.clinicProfile.generalNote,
                  },
                  preloaded_context: input.redactedPreloadedContext,
                  guest_message: input.redactedMessage,
                }),
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 350,
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
              answer: { type: "string" },
            },
            required: ["answer"],
          },
        },
      }),
    }, env.GEMINI_REQUEST_TIMEOUT_MS);

    if (!response.ok) throw new GuestModelError("provider");

    const payload = (await response.json()) as GeminiResponsePayload;
    const outputText = extractOutputText(payload);
    if (!outputText) throw new GuestModelError("invalid_output");

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(outputText);
    } catch {
      throw new GuestModelError("invalid_output");
    }
    const parsed = outputSchema.safeParse(parsedJson);
    if (!parsed.success) throw new GuestModelError("invalid_output");

    return {
      answer: parsed.data.answer,
      model: env.GEMINI_MODEL,
      providerResponseId: payload.responseId ?? null,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof GuestModelError) throw error;
    if (error instanceof ProviderRequestTimeoutError) {
      throw new GuestModelError("timeout");
    }
    throw new GuestModelError("provider");
  }
}
