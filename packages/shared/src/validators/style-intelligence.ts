import { z } from 'zod';

/**
 * StyleProfileSummary — JSON normalizado (determinista)
 */
export const StyleSignalsSchema = z.object({
  innovation: z.number().min(0).max(1),
  warmth: z.number().min(0).max(1),
  organic: z.number().min(0).max(1),
  luxury: z.number().min(0).max(1),
});

export const StyleProfileSummarySchema = z.object({
  schemaVersion: z.literal('style-profile-summary@1.0'),
  briefId: z.string().min(1),
  moodboardId: z.string().min(1),
  styleProfileId: z.string().min(1),
  locale: z.string().default('es'),
  updatedAt: z.string().min(1),

  signals: StyleSignalsSchema,

  keywords: z
    .object({
      likes: z.array(z.string()).default([]),
      dislikes: z.array(z.string()).default([]),
      mustHave: z.array(z.string()).default([]),
      avoid: z.array(z.string()).default([]),
    })
    .default({ likes: [], dislikes: [], mustHave: [], avoid: [] }),

  references: z
    .object({
      assetsCount: z
        .object({
          images: z.number().int().nonnegative().default(0),
          videos: z.number().int().nonnegative().default(0),
          links: z.number().int().nonnegative().default(0),
        })
        .default({ images: 0, videos: 0, links: 0 }),
      topTags: z.array(z.string()).default([]),
    })
    .default({ assetsCount: { images: 0, videos: 0, links: 0 }, topTags: [] }),
});

export type StyleProfileSummary = z.infer<typeof StyleProfileSummarySchema>;

/**
 * PromptPayload v1.0 — paquete para IA (pero aún no generamos)
 */
export const PromptPayloadSchema = z.object({
  schemaVersion: z.literal('prompt-payload@1.0'),
  requestId: z.string().min(1),
  createdAt: z.string().min(1),

  intent: z.object({
    task: z.enum(['GENERATE_STYLE_GUIDELINES']),
    outputFormat: z.enum(['JSON']),
    language: z.string().default('es'),
  }),

  context: z.object({
    project: z
      .object({
        domain: z.string().default('architecture'),
        scope: z.string().default('residential'),
        location: z.string().optional(),
        budgetTier: z.string().optional(),
        constraints: z.array(z.string()).default([]),
      })
      .default({ domain: 'architecture', scope: 'residential', constraints: [] }),
  }),

  style: StyleProfileSummarySchema,

  instructions: z.object({
    do: z.array(z.string()).default([]),
    dont: z.array(z.string()).default([]),
    qualityBar: z
      .object({
        specificity: z.enum(['low', 'medium', 'high']).default('high'),
        brevity: z.enum(['low', 'medium', 'high']).default('medium'),
        safety: z.enum(['standard', 'strict']).default('strict'),
      })
      .default({ specificity: 'high', brevity: 'medium', safety: 'strict' }),
  }),

  outputs: z.object({
    expectedKeys: z.array(z.string()).default([]),
  }),

  telemetry: z.object({
    app: z.literal('innova-architect'),
    module: z.literal('moodboard'),
    styleSignalsActive: z.array(z.string()).default([]),
  }),
});

export type PromptPayload = z.infer<typeof PromptPayloadSchema>;
