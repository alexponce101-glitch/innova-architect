import { z } from 'zod';

export const Semver = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);

export const StyleKey = z.string().min(2).max(64);

export const StyleRank = z.object({
  key: StyleKey,
  confidence: z.number().min(0).max(1),
});

export const Preferences = z.object({
  mood: z.array(z.string().min(2).max(64)).max(8).default([]),
  materials: z.array(z.string().min(2).max(64)).max(12).default([]),
  palette: z.array(z.string().min(2).max(64)).max(12).default([]),
  geometry: z.array(z.string().min(2).max(64)).max(6).default([]),

  ornamentation: z.enum(['none', 'low', 'medium', 'high']),
  lightPreference: z.enum(['natural_abundant', 'balanced', 'dim_cozy']),
  spatialFeel: z.enum(['open', 'semi_open', 'cozy_compact']),
  connectionToNature: z.boolean(),
  visualNoiseTolerance: z.enum(['very_low', 'low', 'medium', 'high']),
  innovationLevel: z.number().min(0).max(1),
});

export const Constraints = z.object({
  dislikes: z.array(z.string().min(2).max(96)).max(24).default([]),
  hardConstraints: z.array(z.string().min(2).max(96)).max(24).default([]),
});

export const SignalsSummary = z.object({
  assetsAnalyzed: z.number().int().min(0).max(100000),
  textSignals: z.number().int().min(0).max(100000),
  topStyleScores: z
    .array(
      z.object({
        key: StyleKey,
        score: z.number(),
      }),
    )
    .min(1)
    .max(10),
  confidenceReason: z.string().min(3).max(512),
});

export const UserEdit = z.object({
  at: z.string().datetime(),
  path: z.string().min(1).max(256),
  from: z.unknown(),
  to: z.unknown(),
  reason: z.string().max(256).default(''),
});

export const StyleProfile = z.object({
  id: z.string().min(6).max(128),
  moodboardId: z.string().min(6).max(128),
  version: Semver,
  status: z.enum(['draft', 'confirmed', 'locked']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),

  primaryStyle: StyleRank,
  secondaryStyles: z.array(StyleRank).max(6).default([]),

  preferences: Preferences,
  constraints: Constraints,
  signalsSummary: SignalsSummary,
  userEdits: z.array(UserEdit).max(200).default([]),
});

export type StyleProfile = z.infer<typeof StyleProfile>;

/**
 * PATCH payload (parcial) — el server crea nueva versión.
 * Permitimos editar SOLO lo que el usuario debería editar.
 */
export const StyleProfilePatch = z
  .object({
    primaryStyle: StyleRank.optional(),
    secondaryStyles: z.array(StyleRank).max(6).optional(),
    preferences: Preferences.partial().optional(),
    constraints: Constraints.partial().optional(),
    editReason: z.string().max(256).optional(),
  })
  .strict();
export type StyleProfilePatch = z.infer<typeof StyleProfilePatch>;
