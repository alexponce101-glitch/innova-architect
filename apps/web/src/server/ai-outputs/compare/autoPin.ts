// apps/web/src/server/ai-outputs/compare/autoPin.ts
// WOW #10 — Auto-Pin Decision Engine (para tu shape REAL de CompareResult)

export type AutoPinCategory = "metadata" | "semantic" | "structural" | "mixed";

export type AutoPinDecision = {
  category: AutoPinCategory;
  recommendedPins: string[]; // pins por prefijo ("metadata.*") o por path exacto
  reasons: string[]; // mensajes humanos para UX
  debug?: {
    changedCount: number;
    addedCount: number;
    removedCount: number;
    totalEntries: number;
    zoneKeys: string[];
    topZones: Array<{ zone: string; changed: number }>;
    topHotspots: Array<{ prefix: string; score: number; tags: string[] }>;
  };
};

export type DiffEntry = {
  path: string;
  tone: "changed" | "added" | "removed";
  score?: number;
  zone?: string;
};

export type HotspotEntry = {
  prefix: string; // "<root>" | "metadata." | "sections." ...
  score: number;
  tone: "changed";
  tags: string[]; // e.g. ["hotspot","structural"]
  paths: string[];
};

type AutoPinInput = {
  summary: {
    changed: number;
    added: number;
    removed: number;
    total: number;
  };

  diff: {
    changedPaths: DiffEntry[];
    addedPaths: DiffEntry[];
    removedPaths: DiffEntry[];
  };

  hotspots: HotspotEntry[];

  zones: Record<
    string,
    {
      changed: number;
      paths: string[];
    }
  >;
};

export function deriveAutoPins(compareResult: AutoPinInput): AutoPinDecision {
  const diffList = [
    ...(compareResult.diff.changedPaths ?? []),
    ...(compareResult.diff.addedPaths ?? []),
    ...(compareResult.diff.removedPaths ?? []),
  ];

  const allPaths = uniqStable(
    diffList
      .map((d) => d?.path)
      .filter(isNonEmptyString)
      .map(cleanPath),
  );

  const zoneKeys = Object.keys(compareResult.zones ?? {});
  const topZones = rankZones(compareResult.zones);

  const topHotspots = rankHotspots(compareResult.hotspots);

  const hasMetadataChanges =
    hasZone(topZones, "metadata") || allPaths.some(isMetadataPath);
  const hasStructuralHotspot = topHotspots.some((h) =>
    hasStructuralTag(h.tags),
  );
  const hasNonMetadataChanges = allPaths.some((p) => !isMetadataPath(p));

  // Metadata-only = SOLO metadata cambió (no sections/other) y sin señales estructurales fuertes
  const isMetadataOnly =
    hasMetadataChanges && !hasNonMetadataChanges && !hasStructuralHotspot;

  // Structural = hotspots con tag structural o prefijos típicos + scores altos
  const isStructural = !isMetadataOnly && hasStructuralHotspot;

  // Semantic = hay cambios fuera de metadata pero NO dominan señales estructurales
  // (No dependemos de "semantic.ts" aquí: inferimos desde zonas + paths + scores)
  const isSemantic =
    !isMetadataOnly &&
    hasNonMetadataChanges &&
    !isStructural &&
    (hasZone(topZones, "sections") ||
      diffList.some((d) => (d.score ?? 0) >= 0.2) ||
      allPaths.some(isContentLikePath));

  const category: AutoPinCategory = pickCategory(
    isMetadataOnly,
    isSemantic,
    isStructural,
  );

  const recommendedPins = uniqStable([
    ...recommendFromMetadata(isMetadataOnly, compareResult, diffList),
    ...recommendFromStructural(isStructural, compareResult, topHotspots),
    ...recommendFromSemantic(isSemantic, compareResult, topZones, diffList),
  ]).slice(0, 12);

  const reasons = buildReasons(category, {
    isMetadataOnly,
    isSemantic,
    isStructural,
  });

  return {
    category,
    recommendedPins,
    reasons,
    debug: {
      changedCount: compareResult.summary?.changed ?? 0,
      addedCount: compareResult.summary?.added ?? 0,
      removedCount: compareResult.summary?.removed ?? 0,
      totalEntries: diffList.length,
      zoneKeys,
      topZones: topZones.slice(0, 6),
      topHotspots: topHotspots
        .slice(0, 6)
        .map((h: HotspotEntry) => ({
          prefix: h.prefix,
          score: h.score,
          tags: h.tags,
        })),
    },
  };
}

/* ----------------------------- Recommend ----------------------------- */

function recommendFromMetadata(
  isMetadataOnly: boolean,
  r: AutoPinInput,
  diffList: DiffEntry[],
): string[] {
  if (!isMetadataOnly) return [];

  // UX: siempre pinneamos "metadata.*" para máximo ROI
  const pins: string[] = ["metadata.*"];

  // Si tus hotspots traen "metadata." como prefix, lo incluimos (consistente con Pin Prefix)
  const metaHotspot = (r.hotspots ?? []).find(
    (h) => normalizePrefix(h.prefix) === "metadata.",
  );
  if (metaHotspot) pins.push(prefixToPin(metaHotspot.prefix));

  // Adicional: si el zone metadata tiene paths específicos, pinneamos el prefijo común (si aplica)
  const metaZonePaths = r.zones?.metadata?.paths ?? [];
  const common = commonPrefix(metaZonePaths, 1); // top-level: "metadata"
  if (common && common !== "metadata") pins.push(`${common}.*`);

  // Guard: si por alguna razón no existe metadata.* en tus paths reales, pinneamos paths top (máx 3)
  if (!diffList.some((d) => isMetadataPath(d.path))) {
    for (const d of diffList.filter((x) => x.zone === "metadata").slice(0, 3))
      pins.push(d.path);
  }

  return uniqStable(pins);
}

function recommendFromStructural(
  isStructural: boolean,
  r: AutoPinInput,
  topHotspots: HotspotEntry[],
): string[] {
  if (!isStructural) return [];

  const pins: string[] = [];

  // 1) Usar hotspots (es lo más “real” en tu UX)
  for (const h of topHotspots) {
    if (!hasStructuralTag(h.tags)) continue;

    // Evita <root> salvo que sea el único relevante
    const pref = normalizePrefix(h.prefix);
    if (pref === "<root>") continue;

    pins.push(prefixToPin(h.prefix));
  }

  // 2) Si no capturamos nada, usar los prefijos más fuertes aunque no estén taggeados
  if (pins.length === 0) {
    for (const h of topHotspots) {
      const pref = normalizePrefix(h.prefix);
      if (pref === "<root>") continue;
      pins.push(prefixToPin(h.prefix));
    }
  }

  // 3) Fallback: pinnear zonas “colección” típicas si existen
  const z = r.zones ?? {};
  for (const key of [
    "sections",
    "items",
    "nodes",
    "children",
    "blocks",
    "components",
  ]) {
    if (z[key]?.changed) pins.push(`${key}.*`);
  }

  // 4) Último fallback: pinnear paths dentro del hotspot top
  if (pins.length === 0) {
    const best = topHotspots[0];
    for (const p of best?.paths?.slice(0, 6) ?? []) pins.push(p);
  }

  return uniqStable(pins);
}

function recommendFromSemantic(
  isSemantic: boolean,
  r: AutoPinInput,
  topZones: Array<{ zone: string; changed: number; paths: string[] }>,
  diffList: DiffEntry[],
): string[] {
  if (!isSemantic) return [];

  const pins: string[] = [];

  // 1) Prioriza zonas por “changed” (evita metadata)
  for (const z of topZones) {
    if (z.zone === "metadata") continue;

    // pin por prefijo de zona
    pins.push(`${z.zone}.*`);

    // si la zona tiene paths “content-like”, pinneamos prefijos más específicos
    const contentPaths = (z.paths ?? []).filter(isContentLikePath);
    const pref2 = commonPrefix(contentPaths, 2); // ej: "sections.0" -> "sections.0" (pero cuidamos índices)
    const safe = stripNumericSegments(pref2);
    if (safe && safe !== z.zone) pins.push(`${safe}.*`);

    if (pins.length >= 6) break;
  }

  // 2) Agrega prefijos de hotspots aunque no sean estructurales (semántico también vive ahí)
  const nonStructuralHotspots = (r.hotspots ?? [])
    .filter(
      (h) =>
        normalizePrefix(h.prefix) !== "<root>" && !hasStructuralTag(h.tags),
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 2);

  for (const h of nonStructuralHotspots) pins.push(prefixToPin(h.prefix));

  // 3) Fallback: paths con score alto
  const highScore = diffList
    .filter((d) => !isMetadataPath(d.path))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 4);

  for (const d of highScore) pins.push(d.path);

  return uniqStable(pins);
}

/* ----------------------------- Reasons ----------------------------- */

function buildReasons(
  category: AutoPinCategory,
  flags: {
    isMetadataOnly: boolean;
    isSemantic: boolean;
    isStructural: boolean;
  },
): string[] {
  if (flags.isMetadataOnly)
    return ["Only metadata changed — pinned metadata for you"];
  if (category === "semantic")
    return ["Semantic changes detected — pinned relevant content"];
  if (category === "structural")
    return ["Structural changes detected — pinned hotspots"];
  if (flags.isSemantic && flags.isStructural)
    return ["Multiple change types detected — pinned what matters first"];
  return ["Changes detected — pinned recommended focus areas"];
}

function pickCategory(
  isMetadataOnly: boolean,
  isSemantic: boolean,
  isStructural: boolean,
): AutoPinCategory {
  if (isMetadataOnly) return "metadata";
  if (isStructural && isSemantic) return "mixed";
  if (isStructural) return "structural";
  if (isSemantic) return "semantic";
  return "mixed";
}

/* ----------------------------- Utils ----------------------------- */

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

function cleanPath(p: string): string {
  const s = p.trim();
  return s.startsWith(".") ? s.slice(1) : s;
}

function uniqStable<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

function isMetadataPath(path: string): boolean {
  return path === "metadata" || path.startsWith("metadata.");
}

function isContentLikePath(path: string): boolean {
  const p = path.toLowerCase();
  return (
    p.includes("summary") ||
    p.includes("content") ||
    p.includes("text") ||
    p.includes("description") ||
    p.includes("prompt") ||
    p.includes("instructions") ||
    p.includes("rationale") ||
    p.includes("analysis") ||
    p.includes("recommend")
  );
}

function normalizePrefix(prefix: string): string {
  const s = (prefix ?? "").trim();
  if (!s) return "<root>";
  if (s === "<root>") return "<root>";
  return s.endsWith(".") ? s : `${s}.`;
}

function prefixToPin(prefix: string): string {
  const p = normalizePrefix(prefix);
  if (p === "<root>") return "<root>";
  // UI pin-by-prefix ya trabaja con "metadata." / "sections." etc.
  // Para el engine devolvemos pins tipo "metadata.*" consistentes con el resto.
  const root = p.endsWith(".") ? p.slice(0, -1) : p;
  return `${root}.*`;
}

function hasStructuralTag(tags: string[]): boolean {
  const t = (tags ?? []).map((x) => (x ?? "").toLowerCase());
  return (
    t.includes("structural") ||
    t.includes("structure") ||
    t.includes("reorder") ||
    t.includes("added") ||
    t.includes("removed")
  );
}

function rankHotspots(hotspots: HotspotEntry[]): HotspotEntry[] {
  return (hotspots ?? [])
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function rankZones(
  zones: AutoPinInput["zones"],
): Array<{ zone: string; changed: number; paths: string[] }> {
  const entries = Object.entries(zones ?? {}).map(([zone, v]) => ({
    zone,
    changed: v?.changed ?? 0,
    paths: v?.paths ?? [],
  }));
  return entries.sort((a, b) => b.changed - a.changed);
}

function hasZone(
  ranked: Array<{ zone: string; changed: number }>,
  zone: string,
): boolean {
  return ranked.some((z) => z.zone === zone && (z.changed ?? 0) > 0);
}

function commonPrefix(paths: string[], depth: number): string {
  // depth por segmentos, ej depth=2 -> "sections.0" o "sections.title"
  const segs = (paths ?? [])
    .filter(isNonEmptyString)
    .map((p) => p.split(".").slice(0, depth).join("."))
    .filter(isNonEmptyString);
  return uniqStable(segs)[0] ?? "";
}

function stripNumericSegments(prefix: string): string {
  if (!prefix) return "";
  const parts = prefix.split(".").filter(Boolean);
  const cleaned = parts.filter((p) => !/^\d+$/.test(p));
  return cleaned.join(".");
}
