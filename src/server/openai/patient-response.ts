import "server-only";

import { z } from "zod";

import type { PipelineKnowledgeSource } from "@/src/features/patient-chat/pipeline";
import { getOpenAIEnv } from "@/src/config/server-env";

type OpenAIResponsePayload = {
  id?: string;
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
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
  safetyIdentifier: string;
}) {
  let env: ReturnType<typeof getOpenAIEnv>;
  try {
    env = getOpenAIEnv();
  } catch {
    throw new PatientModelError("configuration");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.OPENAI_REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        store: false,
        safety_identifier: input.safetyIdentifier,
        max_output_tokens: 600,
        instructions: [
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
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
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
        text: {
          format: {
            type: "json_schema",
            name: "nightingale_patient_safety_response",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                riskLevel: { type: "string", enum: ["low", "medium", "high"] },
                riskReason: { type: "string", minLength: 1, maxLength: 160 },
                confidence: { type: "string", enum: ["low", "med", "high"] },
                answer: { type: "string", minLength: 1, maxLength: 1200 },
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
                      canonicalKey: { type: "string", minLength: 1, maxLength: 80 },
                      value: { type: "string", minLength: 1, maxLength: 500 },
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
        },
      }),
    });

    if (!response.ok) throw new PatientModelError("provider");
    const payload = (await response.json()) as OpenAIResponsePayload;
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
      model: env.OPENAI_MODEL,
      providerResponseId: payload.id ?? null,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof PatientModelError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new PatientModelError("timeout");
    }
    throw new PatientModelError("provider");
  } finally {
    clearTimeout(timeout);
  }
}

function extractOutputText(payload: OpenAIResponsePayload) {
  if (payload.output_text) return payload.output_text;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return null;
}
