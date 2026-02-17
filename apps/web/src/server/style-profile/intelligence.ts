import crypto from "crypto";
import { z } from "zod";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const normList = (xs: unknown, limit = 50) => {
  const arr = Array.isArray(xs) ? xs : [];
  const clean = arr
    .map((x) =>
      String(x ?? "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
  return Array.from(new Set(clean)).slice(0, limit);
};

export const StyleProfileSummaryZ = z.object({
  schemaVersion: z.literal("style-profile-summary@1.0"),
  briefId: z.string().min(1),
  moodboardId: z.string().min(1),
  styleProfileId: z.string().min(1),
  locale: z.string().default("es"),
  updatedAt: z.string().min(1),

  signals: z.object({
    innovation: z.number().min(0).max(1),
    warmth: z.number().min(0).max(1),
    organic: z.number().min(0).max(1),
    luxury: z.number().min(0).max(1),
  }),

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
export type StyleProfileSummary = z.infer<typeof StyleProfileSummaryZ>;

export const PromptPayloadZ = z.object({
  schemaVersion: z.literal("prompt-payload@1.0"),
  requestId: z.string().min(1),
  createdAt: z.string().min(1),

  intent: z.object({
    task: z.literal("GENERATE_STYLE_GUIDELINES"),
    outputFormat: z.literal("JSON"),
    language: z.string().default("es"),
  }),

  context: z.object({
    project: z.object({
      domain: z.string().default("architecture"),
      scope: z.string().default("residential"),
      location: z.string().optional(),
      budgetTier: z.string().optional(),
      constraints: z.array(z.string()).default([]),
    }),
  }),

  style: StyleProfileSummaryZ,

  instructions: z.object({
    do: z.array(z.string()).default([]),
    dont: z.array(z.string()).default([]),
    qualityBar: z.object({
      specificity: z.enum(["low", "medium", "high"]).default("high"),
      brevity: z.enum(["low", "medium", "high"]).default("medium"),
      safety: z.enum(["standard", "strict"]).default("strict"),
    }),
  }),

  outputs: z.object({
    expectedKeys: z.array(z.string()).default([]),
  }),

  telemetry: z.object({
    app: z.literal("innova-architect"),
    module: z.literal("moodboard"),
    styleSignalsActive: z.array(z.string()).default([]),
  }),
});
export type PromptPayload = z.infer<typeof PromptPayloadZ>;

export function buildStyleProfileSummary(input: {
  briefId: string;
  moodboardId: string;
  styleProfileId: string;
  locale?: string;

  preferences: {
    innovationLevel?: number;
    warmthLevel?: number;
    organicLevel?: number;
    luxuryLevel?: number;
  };

  topTags?: unknown;
  assetsCount?: { images?: number; videos?: number; links?: number };

  keywords?: {
    likes?: unknown;
    dislikes?: unknown;
    mustHave?: unknown;
    avoid?: unknown;
  };
}): StyleProfileSummary {
  const now = new Date().toISOString();

  const summary: StyleProfileSummary = {
    schemaVersion: "style-profile-summary@1.0",
    briefId: input.briefId,
    moodboardId: input.moodboardId,
    styleProfileId: input.styleProfileId,
    locale: input.locale ?? "es",
    updatedAt: now,
    signals: {
      innovation: clamp01(input.preferences.innovationLevel ?? 0.5),
      warmth: clamp01(input.preferences.warmthLevel ?? 0.5),
      organic: clamp01(input.preferences.organicLevel ?? 0.5),
      luxury: clamp01(input.preferences.luxuryLevel ?? 0.5),
    },
    keywords: {
      likes: normList(input.keywords?.likes),
      dislikes: normList(input.keywords?.dislikes),
      mustHave: normList(input.keywords?.mustHave),
      avoid: normList(input.keywords?.avoid),
    },
    references: {
      assetsCount: {
        images: Math.max(0, input.assetsCount?.images ?? 0),
        videos: Math.max(0, input.assetsCount?.videos ?? 0),
        links: Math.max(0, input.assetsCount?.links ?? 0),
      },
      topTags: normList(input.topTags, 25),
    },
  };

  return StyleProfileSummaryZ.parse(summary);
}

export function buildPromptPayload(input: {
  summary: StyleProfileSummary;
  project?: { location?: string; budgetTier?: string; constraints?: string[] };
  language?: string;
}) {
  const payload: PromptPayload = {
    schemaVersion: "prompt-payload@1.0",
    requestId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    intent: {
      task: "GENERATE_STYLE_GUIDELINES",
      outputFormat: "JSON",
      language: input.language ?? input.summary.locale ?? "es",
    },
    context: {
      project: {
        domain: "architecture",
        scope: "residential",
        location: input.project?.location,
        budgetTier: input.project?.budgetTier,
        constraints: input.project?.constraints ?? [],
      },
    },
    style: input.summary,
    instructions: {
      do: [
        "producir lineamientos claros aplicables",
        "priorizar coherencia con señales",
        "evitar contradicciones",
      ],
      dont: [
        "no inventar requerimientos no presentes",
        "no usar marcas comerciales",
        "no mencionar políticas internas",
      ],
      qualityBar: { specificity: "high", brevity: "medium", safety: "strict" },
    },
    outputs: {
      expectedKeys: [
        "designPrinciples",
        "materials",
        "palette",
        "lighting",
        "furniture",
        "doDont",
        "shortSummary",
      ],
    },
    telemetry: {
      app: "innova-architect",
      module: "moodboard",
      styleSignalsActive: ["innovation", "warmth", "organic", "luxury"],
    },
  };

  return PromptPayloadZ.parse(payload);
}

export function sha256(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex");
}
