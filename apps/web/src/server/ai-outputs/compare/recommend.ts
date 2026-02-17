// apps/web/src/server/ai-outputs/compare/recommend.ts

export type RecommendedPin = {
  path: string;
  reason: string;
  score: number;
  tags?: string[];
};

// Ajusta estos nombres a tu compareResult real:
type CompareSemantic = "NO_CHANGE" | "MINOR" | "MAJOR_SHIFT" | "UNKNOWN";

type CompareHotspot = {
  path: string;
  score?: number; // si ya existe
  kind?: string; // optional
};

type CompareResultLike = {
  // lo mínimo que necesitamos (mapea desde tu compare real)
  semantic?: CompareSemantic;
  changes?: {
    onlyMetadata?: boolean;
    onlyTimingOrJob?: boolean;
    modelChanged?: boolean;
    providerChanged?: boolean;
    versionChanged?: boolean;
  };
  hotspots?: CompareHotspot[];
};

function uniqByPath(items: RecommendedPin[]) {
  const map = new Map<string, RecommendedPin>();
  for (const it of items) {
    const prev = map.get(it.path);
    if (!prev || it.score > prev.score) map.set(it.path, it);
  }
  return Array.from(map.values());
}

export function recommendPins(cr: CompareResultLike): RecommendedPin[] {
  const out: RecommendedPin[] = [];

  const semantic = cr.semantic ?? "UNKNOWN";
  const ch = cr.changes ?? {};
  const hotspots = cr.hotspots ?? [];

  // D) noise guard
  if (ch.onlyTimingOrJob) {
    // v1: no recomendar nada (o solo jobId si lo deseas)
    // out.push({ path: "jobId", reason: "Only job/timing changed; usually noise, pin if debugging.", score: 10, tags:["noise"] });
    return [];
  }

  // A) metadata only
  if (ch.onlyMetadata) {
    out.push({
      path: "metadata",
      reason:
        "Only metadata changed; pin metadata to review provenance/attributes.",
      score: 80,
      tags: ["metadata"],
    });
  }

  // C) generation settings changed
  if (ch.modelChanged) {
    out.push({
      path: "model",
      reason: "Model changed; pin model to confirm generation settings.",
      score: 70,
      tags: ["settings"],
    });
  }
  if (ch.providerChanged) {
    out.push({
      path: "provider",
      reason: "Provider changed; pin provider to confirm generation settings.",
      score: 70,
      tags: ["settings"],
    });
  }
  if (ch.versionChanged) {
    out.push({
      path: "version",
      reason: "Version changed; pin version for traceability.",
      score: 65,
      tags: ["settings"],
    });
  }

  // B) semantic major shift
  if (semantic === "MAJOR_SHIFT") {
    out.push({
      path: "summary",
      reason: "Major semantic shift; pin summary to review the new meaning.",
      score: 95,
      tags: ["semantic"],
    });
    out.push({
      path: "sections",
      reason:
        "Major semantic shift; pin sections to inspect structure/content changes.",
      score: 92,
      tags: ["semantic"],
    });
    out.push({
      path: "content",
      reason:
        "Major semantic shift; pin full content to validate the final output.",
      score: 90,
      tags: ["semantic"],
    });
  }

  // E) hotspots (top N)
  // (Si ya tienes hotspots con score, los respetamos; si no, les damos score base)
  const topHotspots = [...hotspots]
    .map((h) => ({
      path: h.path,
      score: typeof h.score === "number" ? h.score : 30,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 7);

  for (const h of topHotspots) {
    // no dupliques pins muy generales si ya están sugeridos
    out.push({
      path: h.path,
      reason:
        "High-change hotspot detected; pin to review the most impactful diffs.",
      score: 40 + Math.min(40, Math.floor(h.score)),
      tags: ["hotspot"],
    });
  }

  // normalización final: dedupe + sort
  return uniqByPath(out).sort((a, b) => b.score - a.score);
}
