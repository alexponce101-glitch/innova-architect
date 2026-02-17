import type { StyleProfileSummary, PromptPayload } from '../validators/style-intelligence';

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function normList(xs: unknown, limit = 50) {
  const arr = Array.isArray(xs) ? xs : [];
  const clean = arr
    .map((x) =>
      String(x ?? '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
  return Array.from(new Set(clean)).slice(0, limit);
}

export function buildStyleProfileSummary(input: {
  briefId: string;
  moodboardId: string;
  styleProfileId: string;
  locale?: string;

  // de tu backend actual (preferencesNormalized / params)
  preferences: {
    innovationLevel?: number;
    warmthLevel?: number;
    organicLevel?: number;
    luxuryLevel?: number;
  };

  // opcional: tags/resumen del moodboard
  topTags?: string[];
  assetsCount?: { images?: number; videos?: number; links?: number };

  keywords?: {
    likes?: unknown;
    dislikes?: unknown;
    mustHave?: unknown;
    avoid?: unknown;
  };
}): StyleProfileSummary {
  const now = new Date().toISOString();

  const signals = {
    innovation: clamp01(input.preferences.innovationLevel ?? 0.5),
    warmth: clamp01(input.preferences.warmthLevel ?? 0.5),
    organic: clamp01(input.preferences.organicLevel ?? 0.5),
    luxury: clamp01(input.preferences.luxuryLevel ?? 0.5),
  };

  return {
    schemaVersion: 'style-profile-summary@1.0',
    briefId: input.briefId,
    moodboardId: input.moodboardId,
    styleProfileId: input.styleProfileId,
    locale: input.locale ?? 'es',
    updatedAt: now,
    signals,
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
}

export function buildPromptPayload(input: {
  requestId: string;
  summary: StyleProfileSummary;
  project?: {
    location?: string;
    budgetTier?: string;
    constraints?: string[];
  };
  language?: string;
}): PromptPayload {
  const now = new Date().toISOString();

  return {
    schemaVersion: 'prompt-payload@1.0',
    requestId: input.requestId,
    createdAt: now,
    intent: {
      task: 'GENERATE_STYLE_GUIDELINES',
      outputFormat: 'JSON',
      language: input.language ?? input.summary.locale ?? 'es',
    },
    context: {
      project: {
        domain: 'architecture',
        scope: 'residential',
        location: input.project?.location,
        budgetTier: input.project?.budgetTier,
        constraints: input.project?.constraints ?? [],
      },
    },
    style: input.summary,
    instructions: {
      do: [
        'producir lineamientos claros aplicables',
        'priorizar coherencia con señales',
        'evitar contradicciones',
      ],
      dont: [
        'no inventar requerimientos no presentes',
        'no usar marcas comerciales',
        'no mencionar políticas internas',
      ],
      qualityBar: { specificity: 'high', brevity: 'medium', safety: 'strict' },
    },
    outputs: {
      expectedKeys: [
        'designPrinciples',
        'materials',
        'palette',
        'lighting',
        'furniture',
        'doDont',
        'shortSummary',
      ],
    },
    telemetry: {
      app: 'innova-architect',
      module: 'moodboard',
      styleSignalsActive: ['innovation', 'warmth', 'organic', 'luxury'],
    },
  };
}
