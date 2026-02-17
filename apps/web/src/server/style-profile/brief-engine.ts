// apps/web/src/server/style-profile/brief-engine.ts
import type { StyleProfile } from "./validators";

export type DesignBrief = {
  moodboardId: string;
  styleProfileId: string;
  version: string;
  generatedAt: string;

  summary: string;
  styleDNA: {
    primary: string;
    secondary: string[];
    palette: string[];
    materials: string[];
    geometry: string[];
    ornamentation: string;
    lightPreference: string;
    spatialFeel: string;
  };

  preferencesNormalized: {
    innovationLevel: number; // 0..1
    visualNoiseTolerance: string;
    connectionToNature: boolean;
  };

  constraints: {
    dislikes: string[];
    hardConstraints: string[];
  };

  signals: {
    topStyleScores: Array<{ key: string; score: number }>;
    confidenceReason?: string;
  };
};

export type PromptPack = {
  system: string;
  user: string;
  params: Record<string, any>;
};

function clamp01(n: number) {
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function nowIso() {
  return new Date().toISOString();
}

function joinNatural(items: string[]) {
  const clean = items.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} y ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")} y ${clean[clean.length - 1]}`;
}

export function buildDesignBrief(profile: StyleProfile): {
  brief: DesignBrief;
  promptPack: PromptPack;
} {
  const p = profile;

  const primary = p.primaryStyle?.key ?? "unknown";
  const secondary = (p.secondaryStyles ?? []).map((s) => s.key);

  const pref = p.preferences;
  const innovation = clamp01(pref.innovationLevel ?? 0.5);

  const parts: string[] = [];

  parts.push(`Estilo principal: ${primary}.`);
  if (secondary.length) parts.push(`Secundarios: ${joinNatural(secondary)}.`);

  if ((pref.palette ?? []).length)
    parts.push(`Paleta: ${joinNatural(pref.palette ?? [])}.`);
  if ((pref.materials ?? []).length)
    parts.push(`Materiales: ${joinNatural(pref.materials ?? [])}.`);
  if ((pref.geometry ?? []).length)
    parts.push(`Geometría: ${joinNatural(pref.geometry ?? [])}.`);

  parts.push(`Ornamentación: ${pref.ornamentation}.`);
  parts.push(`Luz: ${pref.lightPreference}.`);
  parts.push(`Sensación espacial: ${pref.spatialFeel}.`);

  const summary = parts.join(" ");

  const brief: DesignBrief = {
    moodboardId: p.moodboardId,
    styleProfileId: p.id,
    version: p.version,
    generatedAt: nowIso(),

    summary,
    styleDNA: {
      primary,
      secondary,
      palette: pref.palette ?? [],
      materials: pref.materials ?? [],
      geometry: pref.geometry ?? [],
      ornamentation: pref.ornamentation,
      lightPreference: pref.lightPreference,
      spatialFeel: pref.spatialFeel,
    },

    preferencesNormalized: {
      innovationLevel: innovation,
      visualNoiseTolerance: pref.visualNoiseTolerance,
      connectionToNature: Boolean(pref.connectionToNature),
    },

    constraints: {
      dislikes: p.constraints?.dislikes ?? [],
      hardConstraints: p.constraints?.hardConstraints ?? [],
    },

    signals: {
      // compat: si el tipo aún no expone estos campos, caemos a defaults
      topStyleScores: ((p as any).topStyleScores ??
        (p as any).topStyles ??
        []) as Array<{ key: string; score: number }>,
      confidenceReason:
        (p as any).confidenceReason ?? (p as any).confidence ?? undefined,
    },
  };

  // PromptPack: listo para IA generativa (texto + params)
  const system =
    "Eres un arquitecto y diseñador senior. Genera propuestas coherentes con el Design Brief. " +
    "Evita lo que está en dislikes y respeta hardConstraints. Mantén consistencia de estilo.";

  const user =
    `Design Brief (JSON):\n${JSON.stringify(brief, null, 2)}\n\n` +
    `Tarea: Genera 3 conceptos de diseño distintos pero coherentes con el brief. ` +
    `Cada concepto debe incluir: nombre, idea central, materiales clave, paleta, iluminación, distribución espacial, y 3 puntos diferenciales.`;

  const params = {
    moodboardId: p.moodboardId,
    styleProfileId: p.id,
    stylePrimary: primary,
    styleSecondary: secondary,
    innovationLevel: innovation,
  };

  const promptPack: PromptPack = { system, user, params };

  return { brief, promptPack };
}
