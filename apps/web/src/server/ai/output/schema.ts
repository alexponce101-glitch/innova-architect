import { z } from "zod";

export const AiOutputV1Z = z.object({
  version: z.literal("1.0"),
  summary: z.object({
    style_name: z.string().min(1),
    one_liner: z.string().min(1),
    confidence: z.number().min(0).max(1),
  }),
  style_profile: z.object({
    innovation_level: z.number().min(0).max(1),
    keywords: z.array(z.string().min(1)).default([]),
    do: z.array(z.string().min(1)).default([]),
    dont: z.array(z.string().min(1)).default([]),
  }),
  recommendations: z.object({
    materials: z.array(z.string().min(1)).default([]),
    colors: z.array(z.string().min(1)).default([]),
    lighting: z.array(z.string().min(1)).default([]),
  }),
  rationale: z.object({
    based_on: z.object({
      tags: z.array(z.string()).default([]),
      notes: z.array(z.string()).default([]),
      signals: z.array(z.string()).default([]),
    }),
    explanation: z.string().min(1),
  }),
  audit: z.object({
    payload_hash: z.string().min(16),
    prompt_version: z.string().min(1),
    generated_at: z.string().min(10),
    model: z.string().min(1),
  }),
});

export type AiOutputV1 = z.infer<typeof AiOutputV1Z>;
