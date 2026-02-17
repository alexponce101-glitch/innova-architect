import { StyleProfile as StyleProfileZ } from "../../../../../packages/shared/src/validators/style-profile";
import type { StyleProfile } from "../../../../../packages/shared/src/validators/style-profile";

function nowIso() {
  return new Date().toISOString();
}

function genId(prefix: string) {
  // suficientemente bueno para MVP; luego cambia a uuid/nanoid
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

/**
 * Crea un StyleProfile draft v1.0.0 (stub MVP).
 * Luego conectamos assets+texto+scoring real sin romper contratos.
 */
export function generateStyleProfileDraft(moodboardId: string): StyleProfile {
  // TODO: aquí conectaremos la extracción real (assets + texto + scoring).
  const createdAt = nowIso();
  const draft: StyleProfile = {
    id: genId("sp"),
    moodboardId,
    version: "1.0.0",
    status: "draft",
    createdAt,
    updatedAt: createdAt,

    primaryStyle: { key: "japandi", confidence: 0.82 },
    secondaryStyles: [
      { key: "minimalist", confidence: 0.63 },
      { key: "natural", confidence: 0.58 },
    ],

    preferences: {
      mood: ["calma", "orden", "calidez"],
      materials: ["madera_clara", "concreto_pulido", "lino"],
      palette: ["neutros_calidos", "blanco_roto", "gris_suave"],
      geometry: ["rectilineo", "lineas_limpias"],
      ornamentation: "low",
      lightPreference: "natural_abundant",
      spatialFeel: "open",
      connectionToNature: true,
      visualNoiseTolerance: "very_low",
      innovationLevel: 0.35,
    },

    constraints: {
      dislikes: ["industrial_pesado", "colores_saturados"],
      hardConstraints: ["no_ladrillo_expuesto", "no_negro_dominante"],
    },

    signalsSummary: {
      assetsAnalyzed: 0,
      textSignals: 0,
      topStyleScores: [
        { key: "japandi", score: 18.2 },
        { key: "minimalist", score: 14.7 },
      ],
      confidenceReason: "stub_v1: gap_primary_secondary + consistency_unknown",
    },

    userEdits: [],
  };

  // Validación runtime (si algo está mal, truena aquí)
  return StyleProfileZ.parse(draft);
}

/**
 * Incrementa el patch: x.y.z -> x.y.(z+1)
 * (para cada PATCH del usuario)
 */
export function bumpPatchVersion(prev: string): string {
  // semver patch bump: x.y.z -> x.y.(z+1)
  const [maj, min, patWithSuffix] = prev.split(".");
  const pat = patWithSuffix?.split("-")[0] ?? "0";
  const nextPat = Number(pat) + 1;

  if (!Number.isFinite(nextPat)) return "1.0.1";
  return `${maj}.${min}.${nextPat}`;
}
