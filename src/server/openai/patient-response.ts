import "server-only";

import { z } from "zod";

import type { PipelineKnowledgeSource } from "@/src/features/patient-chat/pipeline";
import { getGeminiEnv } from "@/src/config/server-env";
import { fetchWithProviderTimeout, ProviderRequestTimeoutError } from "@/src/server/openai/provider-timeout";

type GeminiResponsePayload = {
  responseId?: string;
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

const patientModelSchema = z
  .object({
    riskLevel: z.enum(["low", "medium", "high"]),
    riskReason: z.string().trim().min(1).max(160),
    confidence: z.enum(["low", "med", "high"]),
    answer: z.string().trim().min(1).max(1200),
    asksForDiagnosis: z.boolean(),
    asksForClarity: z.boolean(),
    soundsUnsure: z.boolean(),
    citationSourceIds: z.array(z.string().uuid()).max(2),
    memoryProposals: z.array(z.object({
      kind: z.enum(["chief_complaint", "symptom", "medication", "allergy"]),
      canonicalKey: z.string().trim().min(1).max(80),
      value: z.string().trim().min(1).max(500),
      status: z.enum(["active", "stopped", "resolved", "corrected"]),
      confidence: z.enum(["low", "med", "high"]),
      effectiveAt: z.string().datetime().nullable(),
    }).strict()).max(8),
  })
  .strict();

export class PatientModelError extends Error {
  constructor(public readonly code: "configuration" | "timeout" | "provider" | "invalid_output") {
    super(code);
  }
}

export async function createPatientModelResponse(input: {
  redactedMessage: string;
  sources: PipelineKnowledgeSource[];
}) {
  let env: ReturnType<typeof getGeminiEnv>;
  try {
    env = getGeminiEnv();
  } catch {
    throw new PatientModelError("configuration");
  }

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
              "You are Nightingale AI in an authenticated patient intake messenger. You are not a doctor.",
              "Assess risk conservatively. Never diagnose, recommend a medication change, prescribe treatment, or reassure the patient that symptoms are safe.",
              "Low risk may receive empathetic general support grounded only in the supplied approved sources.",
              "Medium or High risk must not receive clinical advice. The server will replace your draft with approved safety copy.",
              "If the patient requests a diagnosis, requests more clinical clarity, sounds unsure, or the evidence is insufficient, set the corresponding flag and do not classify Low.",
              "For a Low result, cite at least one supplied source ID. Never invent a source ID or medical fact.",
              "Do not reproduce, infer, or guess identifiers represented by [REDACTED].",
              "Extract only facts explicitly stated in this message into memoryProposals: chief complaint, key symptoms with stated timeline, current medications, and allergies.",
              "Use a short lowercase snake_case canonicalKey. Never infer a diagnosis, medication, allergy, date, or correction. Use low confidence when uncertain; the server will omit it.",
            ].join("\n"),
          }],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: JSON.stringify({
                  patient_message: input.redactedMessage,
                  approved_sources: input.sources.map((source) => ({
                    id: source.id,
                    title: source.title,
                    publisher: source.publisher,
                    content: source.content,
                  })),
                }),
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 600,
          responseMimeType: "application/json",
          responseJsonSchema: {
              type: "object",
              additionalProperties: false,
              properties: {
                riskLevel: { type: "string", enum: ["low", "medium", "high"] },
                riskReason: { type: "string" },
                confidence: { type: "string", enum: ["low", "med", "high"] },
                answer: { type: "string" },
                asksForDiagnosis: { type: "boolean" },
                asksForClarity: { type: "boolean" },
                soundsUnsure: { type: "boolean" },
                citationSourceIds: {
                  type: "array",
                  maxItems: 2,
                  items: { type: "string" },
                },
                memoryProposals: {
                  type: "array",
                  maxItems: 8,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      kind: { type: "string", enum: ["chief_complaint", "symptom", "medication", "allergy"] },
                      canonicalKey: { type: "string" },
                      value: { type: "string" },
                      status: { type: "string", enum: ["active", "stopped", "resolved", "corrected"] },
                      confidence: { type: "string", enum: ["low", "med", "high"] },
                      effectiveAt: { type: ["string", "null"] },
                    },
                    required: ["kind", "canonicalKey", "value", "status", "confidence", "effectiveAt"],
                  },
                },
              },
              required: [
                "riskLevel",
                "riskReason",
                "confidence",
                "answer",
                "asksForDiagnosis",
                "asksForClarity",
                "soundsUnsure",
                "citationSourceIds",
                "memoryProposals",
              ],
          },
        },
      }),
    }, env.GEMINI_REQUEST_TIMEOUT_MS);

    if (!response.ok) throw new PatientModelError("provider");
    const payload = (await response.json()) as GeminiResponsePayload;
    const outputText = extractOutputText(payload);
    if (!outputText) throw new PatientModelError("invalid_output");

    let candidate: unknown;
    try {
      candidate = JSON.parse(outputText);
    } catch {
      throw new PatientModelError("invalid_output");
    }
    const parsed = patientModelSchema.safeParse(candidate);
    if (!parsed.success) throw new PatientModelError("invalid_output");

    return {
      proposal: parsed.data,
      model: env.GEMINI_MODEL,
      providerResponseId: payload.responseId ?? null,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof PatientModelError) throw error;
    if (error instanceof ProviderRequestTimeoutError) {
      throw new PatientModelError("timeout");
    }
    throw new PatientModelError("provider");
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
