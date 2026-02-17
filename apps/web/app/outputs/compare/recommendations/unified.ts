// apps/web/app/outputs/compare/recommendations/unified.ts
import type { RecommendedPin } from "../../../../src/server/ai-outputs/compare/types";

// apps/web/app/outputs/compare/recommendations/unified.ts

type Kind = RecommendationItem["kind"];

// Ajusta prioridad si quieres: engine > heuristic > hotspot
const KIND_PRIORITY: Record<RecommendationKind, number> = {
  engine: 4,
  hybrid: 3,
  heuristic: 2,
  hotspot: 1,
};

function isChildPath(parent: string, child: string) {
  if (!parent) return false;
  if (child === parent) return false;
  return child.startsWith(parent + ".") || child.startsWith(parent + "[");
}

/**
 * Normaliza paths para dedupe visual:
 * - quita prefijos "<root>." / "<root>" si existen
 * - colapsa "root." si algún legado lo dejó así
 */
export function normalizePinPath(pinPath: string) {
  let p = (pinPath ?? "").trim();

  if (p === "<root>") return "";
  if (p.startsWith("<root>.")) p = p.slice("<root>.".length);
  if (p.startsWith("root.")) p = p.slice("root.".length);
  if (p === "root") return "";

  return p;
}

/**
 * Une señales del mismo pinPath.
 * Reglas:
 * - nos quedamos con el item de mayor prioridad kind (engine > heuristic > hotspot)
 * - score: max
 * - signals: merge (max por campo)
 * - why: preferimos el de mayor prioridad; si ambos tienen details, concatenamos sin duplicados
 * - sourceRefs: merge + unique
 * - tags: unique
 */
export function mergeSamePathSignals(
  items: RecommendationItem[],
): RecommendationItem[] {
  const map = new Map<string, RecommendationItem>();

  for (const raw of items) {
    const pinPath = normalizePinPath(raw.pinPath);
    const canonicalPath = (raw.canonicalPath ?? "").trim();

    // si pinPath queda vacío, es "<root>" → no lo consideramos pin “real”
    const key = pinPath || canonicalPath || raw.id;

    const next: RecommendationItem = {
      ...raw,
      pinPath,
      canonicalPath,
    };

    const prev = map.get(key);
    if (!prev) {
      map.set(key, next);
      continue;
    }

    const prevPriority = KIND_PRIORITY[prev.kind] ?? 0;
    const nextPriority = KIND_PRIORITY[next.kind] ?? 0;

    // El “winner” por prioridad; si empatan, por score
    const winner =
      nextPriority > prevPriority
        ? next
        : nextPriority < prevPriority
          ? prev
          : next.score >= prev.score
            ? next
            : prev;
    const loser = winner === next ? prev : next;

    const mergedSignals: RecommendationItem["signals"] = {
      engineScore:
        Math.max(
          winner.signals?.engineScore ?? 0,
          loser.signals?.engineScore ?? 0,
        ) || undefined,
      zoneShare:
        Math.max(
          winner.signals?.zoneShare ?? 0,
          loser.signals?.zoneShare ?? 0,
        ) || undefined,
      hotspotWeight:
        Math.max(
          winner.signals?.hotspotWeight ?? 0,
          loser.signals?.hotspotWeight ?? 0,
        ) || undefined,
      changedConfidence:
        Math.max(
          winner.signals?.changedConfidence ?? 0,
          loser.signals?.changedConfidence ?? 0,
        ) || undefined,
    };

    const mergeUnique = (a?: string[], b?: string[]) =>
      Array.from(new Set([...(a ?? []), ...(b ?? [])])).filter(Boolean);

    const mergedWhyDetails = mergeUnique(
      winner.why?.details,
      loser.why?.details,
    );

    map.set(key, {
      ...winner,
      // score final: max (mantiene el más fuerte)
      score: Math.max(winner.score ?? 0, loser.score ?? 0),
      // kind final: winner.kind
      kind: winner.kind,
      // zone: winner.zone (si quieres, puedes resolver por engineScore/zoneShare)
      zone: winner.zone ?? loser.zone,
      signals: Object.values(mergedSignals).some(
        (v) => typeof v === "number" && v > 0,
      )
        ? mergedSignals
        : undefined,
      why: {
        title: winner.why?.title || loser.why?.title || "Recommendation",
        details: mergedWhyDetails?.length ? mergedWhyDetails : undefined,
        reasonKey: winner.why?.reasonKey || loser.why?.reasonKey,
      },
      sourceRefs: {
        engine: mergeUnique(
          winner.sourceRefs?.engine,
          loser.sourceRefs?.engine,
        ),
        heuristic: mergeUnique(
          winner.sourceRefs?.heuristic,
          loser.sourceRefs?.heuristic,
        ),
        hotspot: mergeUnique(
          winner.sourceRefs?.hotspot,
          loser.sourceRefs?.hotspot,
        ),
      },
      tags: mergeUnique(winner.tags, loser.tags),
    });
  }

  return Array.from(map.values());
}

/**
 * Dedupe visual por prefijos redundantes:
 * Elimina padres (p.ej. "metadata") si hay hijos ("metadata.title") con score >=.
 *
 * Nota: esto se hace sobre pinPath normalizado (sin <root>).
 */
export function dedupeStructural(
  items: RecommendationItem[],
): RecommendationItem[] {
  const normalized = items.map((it) => ({
    ...it,
    pinPath: normalizePinPath(it.pinPath),
  }));

  return normalized.filter((pin) => {
    const p = pin.pinPath;
    if (!p) return false; // no renderizamos "<root>" como pin
    return !normalized.some((other) => {
      if (other.id === pin.id) return false;
      if (!other.pinPath) return false;

      // other es “hijo” de pin y es al menos igual de fuerte
      const child = isChildPath(p, other.pinPath);
      if (!child) return false;

      // preferimos score; si quieres usar signals.engineScore como tie-breaker, lo agregamos
      const otherScore = other.score ?? 0;
      const pinScore = pin.score ?? 0;

      if (otherScore > pinScore) return true;
      if (otherScore < pinScore) return false;

      // empate → kindPriority gana
      return (KIND_PRIORITY[other.kind] ?? 0) >= (KIND_PRIORITY[pin.kind] ?? 0);
    });
  });
}

/**
 * Post-process de WOW #14.2
 * Orden sugerido:
 * 1) merge mismo path (hotspot+heuristic+engine)
 * 2) dedupe estructural (<root>/prefijos)
 * 3) (opcional) re-rank si todavía no está aplicado en engine
 */
export function refineRecommendationsWOW142(
  items: RecommendationItem[],
): RecommendationItem[] {
  const merged = mergeSamePathSignals(items);
  const deduped = dedupeStructural(merged);
  return deduped;
}

export function groupByZone(items: RecommendationItem[]) {
  const out = new Map<RecommendationItem["zone"], RecommendationItem[]>();
  for (const it of items) {
    const z = it.zone ?? "other";
    if (!out.has(z)) out.set(z, []);
    out.get(z)!.push(it);
  }
  return out;
}

/**
 * Unified recommendation contract for WOW #13.2
 * - Explainable -> kind:"heuristic"
 * - Hotspots -> kind:"hotspot"
 * - Real ranking: engineScore > zoneShare > hotspotWeight (weighted + explicit tie-breaks)
 * - Visual dedupe (merge by canonicalPath) with hybrid kind
 */

export type RecommendationKind = "engine" | "heuristic" | "hotspot" | "hybrid";

export type RecommendationZone =
  | "content"
  | "output"
  | "input"
  | "model"
  | "metadata"
  | "other";

export type RecommendationWhy = {
  title: string;
  details?: string[]; // max 2 in UI
  reasonKey?: string; // stable key for analytics/dedupe explanation
};

export type RecommendationItem = {
  id: string;
  canonicalPath: string;
  pinPath: string;

  kind: RecommendationKind;
  zone: RecommendationZone;

  // 0..1 (finalScore after ranking)
  score: number;

  // signals for ranking / explainability (all 0..1)
  signals?: {
    engineScore?: number; // 0..1
    zoneShare?: number; // 0..1
    hotspotWeight?: number; // 0..1
    changedConfidence?: number; // 0..1
  };

  why: RecommendationWhy;

  // for merge explanation / debugging
  sourceRefs?: {
    engine?: string[];
    heuristic?: string[];
    hotspot?: string[];
  };

  tags?: string[];
};

export type UnifiedRecommendations = {
  items: RecommendationItem[]; // deduped + ranked
  recommended: RecommendationItem[]; // subset for the main button
  newCount: number; // optional: for "(new N)"
};

/**
 * Existing UI "auto pins" shape (paths-only)
 */
export type UiAutoPinsLike = {
  category?: string;
  recommendedPins: string[];
  reasons?: string[];
};

/**
 * New: Explainable heuristic input shape (adapt from deriveExplainableAutoPins)
 * Keep optional fields so it’s easy to pipe.
 */
export type ExplainableAutoPinLike = {
  path: string;
  title?: string; // short title for why
  details?: string[]; // extra details (we'll clamp to 2)
  reasonKey?: string;
  confidence?: number; // 0..1
  weight?: number; // 0..1 preferred; if bigger we'll normalize
  zone?: RecommendationZone;
  tags?: string[];
  sourceRef?: string; // optional ref id
};

/**
 * New: Hotspot input shape (adapt from computeHotspots)
 */
export type HotspotLike = {
  path: string;
  weight?: number; // any scale, we normalize across hotspots
  zone?: RecommendationZone;
  sourceRef?: string;
  detail?: string; // optional 1-liner
};

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function clampDetails(details?: string[], max = 2) {
  const xs = Array.isArray(details) ? details.map(String).filter(Boolean) : [];
  return xs.slice(0, max);
}

/**
 * Canonicalize a JSON-like path into a stable comparable string.
 * Keep it simple & deterministic (we can refine later).
 */
export function canonicalizePath(path: string): string {
  let p = (path ?? "").trim();
  if (!p) return "";
  // strip leading "$." or "$"
  if (p === "$") return "";
  p = p.replace(/^\$\./, "");
  p = p.replace(/^\$/, "");
  // normalize brackets spacing
  p = p.replace(/\s+/g, "");
  // normalize array indices like [01] -> [1]
  p = p.replace(/\[(\d+)\]/g, (_, d) => `[${String(Number(d))}]`);
  // remove accidental leading dots
  p = p.replace(/^\./, "");
  return p;
}

function zoneFromTagsOrPath(
  tags?: string[],
  path?: string,
): RecommendationZone {
  const t = (tags ?? []).map((x) => String(x).toLowerCase());
  if (t.includes("metadata")) return "metadata";
  if (t.includes("model")) return "model";
  if (t.includes("input")) return "input";
  if (t.includes("output")) return "output";
  if (t.includes("content")) return "content";

  const p = (path ?? "").toLowerCase();
  if (
    p.startsWith("meta.") ||
    p.startsWith("metadata.") ||
    p.includes(".meta.")
  )
    return "metadata";
  if (p.startsWith("model.") || p.includes(".model.")) return "model";
  if (p.startsWith("input.") || p.includes(".input.")) return "input";
  if (p.startsWith("output.") || p.includes(".output.")) return "output";
  if (p.startsWith("content.") || p.includes(".content.")) return "content";
  return "other";
}

/**
 * Normalize a list of weights to 0..1 by dividing by max (safe).
 */
function normalizeByMax(values: number[]): number[] {
  const xs = values.map((v) => (Number.isFinite(v) ? v : 0));
  const max = xs.reduce((m, v) => (v > m ? v : m), 0) || 1;
  return xs.map((v) => clamp01(v / max));
}

function kindToPri(k: RecommendationKind) {
  // for tie-breaks only (ranking is signal-driven first)
  return k === "engine" ? 4 : k === "hybrid" ? 3 : k === "heuristic" ? 2 : 1;
}

/**
 * Convert engine RecommendedPin[] into unified items.
 * Assumes engine score may be any scale; we normalize using max score.
 */
export function fromEnginePins(
  enginePins: RecommendedPin[],
): RecommendationItem[] {
  const pins = Array.isArray(enginePins) ? enginePins : [];
  if (pins.length === 0) return [];

  // normalize score to 0..1 using max
  const maxScore = pins.reduce((m, p) => (p?.score > m ? p.score : m), 0) || 1;

  return pins
    .filter((p) => !!p?.path)
    .map((p, idx) => {
      const canonical = canonicalizePath(p.path);
      const normScore = clamp01((p.score ?? 0) / maxScore);
      const zone = zoneFromTagsOrPath(p.tags, p.path);

      const why: RecommendationWhy = {
        title: p.reason || "Recommended by engine",
        details: p.tags?.length
          ? clampDetails([`Tags: ${p.tags.join(", ")}`])
          : undefined,
        reasonKey: "ENGINE",
      };

      return {
        id: `engine:${canonical}:${idx}`,
        canonicalPath: canonical,
        pinPath: canonical || p.path,
        kind: "engine",
        zone,
        score: 0, // set in rank()
        signals: { engineScore: normScore },
        why,
        tags: p.tags,
        sourceRefs: { engine: [p.path] },
      } satisfies RecommendationItem;
    });
}

/**
 * Convert UI-layer auto pins ({recommendedPins: string[], reasons?: string[]}) into unified items.
 * These are treated as "engine" kind but with weaker engineScore (we don't know real engine score).
 */
export function fromUiAutoPins(
  ui: UiAutoPinsLike | null | undefined,
): RecommendationItem[] {
  if (!ui?.recommendedPins?.length) return [];
  const paths = ui.recommendedPins.filter(Boolean);
  const reasons = Array.isArray(ui.reasons) ? ui.reasons : [];

  // heuristic scoring: earlier items slightly higher
  const n = paths.length;
  return paths.map((path, i) => {
    const canonical = canonicalizePath(path);
    const zone = zoneFromTagsOrPath(undefined, path);

    // descending from ~0.65..0.40 (tunable)
    const base = 0.65;
    const span = 0.25;
    const engineScore = clamp01(base - (span * i) / Math.max(1, n - 1));

    const reason = reasons[i] ?? "Recommended (UI derived)";
    const why: RecommendationWhy = {
      title: reason,
      reasonKey: "UI_DERIVED",
    };

    return {
      id: `ui:${canonical}:${i}`,
      canonicalPath: canonical,
      pinPath: canonical || path,
      kind: "engine",
      zone,
      score: 0, // set in rank()
      signals: { engineScore },
      why,
      sourceRefs: { engine: [path] },
    } satisfies RecommendationItem;
  });
}

/**
 * Convert explainable auto pins into unified items (kind:"heuristic")
 * Weight/confidence are optional; we normalize weights across the list when building.
 */
export function fromExplainablePins(
  explainable: ExplainableAutoPinLike[],
): RecommendationItem[] {
  const xs = Array.isArray(explainable) ? explainable : [];
  if (!xs.length) return [];

  const weightsRaw = xs.map((p) =>
    typeof p.weight === "number" ? p.weight : 1,
  );
  const weights01 = normalizeByMax(weightsRaw);

  return xs
    .filter((p) => !!p?.path)
    .map((p, i) => {
      const canonical = canonicalizePath(p.path);
      const zone = p.zone ?? zoneFromTagsOrPath(p.tags, p.path);

      const engineScore = weights01[i]; // heuristic “engineScore” signal
      const conf = clamp01(
        typeof p.confidence === "number" ? p.confidence : 0.7,
      );

      const why: RecommendationWhy = {
        title: p.title || "Heuristic recommendation",
        details: clampDetails(p.details),
        reasonKey: p.reasonKey || "HEURISTIC",
      };

      return {
        id: `heur:${canonical}:${i}`,
        canonicalPath: canonical,
        pinPath: canonical || p.path,
        kind: "heuristic",
        zone,
        score: 0, // set in rank()
        signals: {
          engineScore,
          changedConfidence: conf,
        },
        why,
        tags: p.tags,
        sourceRefs: { heuristic: [p.sourceRef ?? p.path] },
      } satisfies RecommendationItem;
    });
}

/**
 * Convert hotspots into unified items (kind:"hotspot")
 * We normalize hotspot weights across the list.
 */
export function fromHotspots(hotspots: HotspotLike[]): RecommendationItem[] {
  const xs = Array.isArray(hotspots) ? hotspots : [];
  if (!xs.length) return [];

  const weightsRaw = xs.map((h) => {
    const w = typeof h.weight === "number" ? h.weight : 1;
    return w;
  });
  const weights01 = normalizeByMax(weightsRaw);

  return xs
    .filter((h) => !!h?.path)
    .map((h, i) => {
      const canonical = canonicalizePath(h.path);
      const zone = h.zone ?? zoneFromTagsOrPath(undefined, h.path);

      const hw = weights01[i];

      const why: RecommendationWhy = {
        title: "Hotspot detected",
        details: clampDetails([
          h.detail ?? `High change density (${String(weightsRaw[i])})`,
        ]),
        reasonKey: "HOTSPOT",
      };

      return {
        id: `hot:${canonical}:${i}`,
        canonicalPath: canonical,
        pinPath: canonical || h.path,
        kind: "hotspot",
        zone,
        score: 0, // set in rank()
        signals: {
          hotspotWeight: hw,
        },
        why,
        sourceRefs: { hotspot: [h.sourceRef ?? h.path] },
      } satisfies RecommendationItem;
    });
}

/**
 * Apply zone share signals (0..1) to items.
 * If a zone isn't provided, we keep whatever is there.
 */
export function applyZoneShares(
  items: RecommendationItem[],
  zoneShareByZone:
    | Partial<Record<RecommendationZone, number>>
    | null
    | undefined,
): RecommendationItem[] {
  const m = zoneShareByZone ?? {};
  return items.map((it) => {
    const zs = m[it.zone];
    if (typeof zs !== "number") return it;
    return {
      ...it,
      signals: {
        ...it.signals,
        zoneShare: clamp01(zs),
      },
    };
  });
}

/**
 * Dedupe + merge: one item per canonicalPath (or canonical->pin path if different).
 * Merge signals + refs + tags. If multiple kinds contribute, mark as "hybrid".
 */
export function dedupeAndMerge(
  items: RecommendationItem[],
): RecommendationItem[] {
  const byKey = new Map<string, RecommendationItem>();

  for (const it of items) {
    if (!it?.pinPath) continue;
    const canonical = it.canonicalPath || canonicalizePath(it.pinPath);
    const key = canonical ? canonical : it.pinPath;

    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...it, canonicalPath: canonical || it.canonicalPath });
      continue;
    }

    const mergedKinds = uniq([prev.kind, it.kind]);
    const mergedKind: RecommendationKind =
      mergedKinds.length >= 2
        ? "hybrid"
        : (mergedKinds[0] as RecommendationKind);

    const keep =
      // prefer the one with higher *engineScore* signal, then higher score, then kind priority
      (it.signals?.engineScore ?? 0) > (prev.signals?.engineScore ?? 0)
        ? it
        : (it.signals?.engineScore ?? 0) < (prev.signals?.engineScore ?? 0)
          ? prev
          : it.score > prev.score
            ? it
            : it.score < prev.score
              ? prev
              : kindToPri(it.kind) > kindToPri(prev.kind)
                ? it
                : prev;

    const merged: RecommendationItem = {
      ...keep,
      canonicalPath: canonical || keep.canonicalPath,
      kind: mergedKind,
      // merge refs
      sourceRefs: {
        engine: uniq([
          ...(prev.sourceRefs?.engine ?? []),
          ...(it.sourceRefs?.engine ?? []),
        ]),
        heuristic: uniq([
          ...(prev.sourceRefs?.heuristic ?? []),
          ...(it.sourceRefs?.heuristic ?? []),
        ]),
        hotspot: uniq([
          ...(prev.sourceRefs?.hotspot ?? []),
          ...(it.sourceRefs?.hotspot ?? []),
        ]),
      },
      // merge tags
      tags: uniq([...(prev.tags ?? []), ...(it.tags ?? [])]),
      // merge why details (keep compact)
      why: mergeWhy(prev, it, keep, mergedKind),
      // keep signals max-per-signal
      signals: {
        engineScore: Math.max(
          prev.signals?.engineScore ?? 0,
          it.signals?.engineScore ?? 0,
        ),
        zoneShare: Math.max(
          prev.signals?.zoneShare ?? 0,
          it.signals?.zoneShare ?? 0,
        ),
        hotspotWeight: Math.max(
          prev.signals?.hotspotWeight ?? 0,
          it.signals?.hotspotWeight ?? 0,
        ),
        changedConfidence: Math.max(
          prev.signals?.changedConfidence ?? 0,
          it.signals?.changedConfidence ?? 0,
        ),
      },
      // score recalculated in rank()
      score: 0,
      // preserve zone (prefer non-other)
      zone: preferZone(prev.zone, it.zone),
    };

    byKey.set(key, merged);
  }

  return Array.from(byKey.values());
}

function preferZone(
  a: RecommendationZone,
  b: RecommendationZone,
): RecommendationZone {
  if (a !== "other" && b === "other") return a;
  if (b !== "other" && a === "other") return b;
  return a;
}

function uniq(xs: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const v = String(x);
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function mergeWhy(
  a: RecommendationItem,
  b: RecommendationItem,
  keep: RecommendationItem,
  mergedKind: RecommendationKind,
): RecommendationWhy {
  const title =
    keep.why?.title ||
    a.why?.title ||
    b.why?.title ||
    (mergedKind === "hybrid" ? "Recommended (multi-signal)" : "Recommended");

  // 1) Construye soporte (compacto) sin inflar ruido
  const kinds = uniq([a.kind, b.kind]);

  const supports: string[] = [];
  if (kinds.includes("engine")) supports.push("engine");
  if (kinds.includes("heuristic")) supports.push("heuristics");
  if (kinds.includes("hotspot")) supports.push("hotspots");

  const supportLine = supports.length
    ? `Supported by: ${supports.join(" + ")}`
    : undefined;

  // 2) Merge de details con dedupe
  const baseDetails = uniq([
    ...(a.why?.details ?? []),
    ...(b.why?.details ?? []),
  ]).filter(Boolean);

  // 3) Solo agrega supportLine si aporta y no compite con details útiles
  const hasSupportAlready = baseDetails.some((d) =>
    d.toLowerCase().includes("supported by:"),
  );

  const details = uniq([
    ...baseDetails,
    ...(!hasSupportAlready && supportLine && baseDetails.length < 2
      ? [supportLine]
      : []),
  ])
    .filter(Boolean)
    .slice(0, 2);

  return {
    title,
    details: details.length ? details : undefined,
    reasonKey: keep.why?.reasonKey ?? a.why?.reasonKey ?? b.why?.reasonKey,
  };
}

/**
 * Ranking policy (real): engineScore > zoneShare > hotspotWeight.
 * Implementation:
 *  - compute finalScore using weighted sum
 *  - tie-break explicitly in that priority order
 */
export function rankRecommendations(
  items: RecommendationItem[],
): RecommendationItem[] {
  // weights (tunable) but must respect priority
  const W_ENGINE = 0.6;
  const W_ZONE = 0.25;
  const W_HOTSPOT = 0.15;

  const kindPri: Record<RecommendationKind, number> = {
    engine: 4,
    hybrid: 3,
    heuristic: 2,
    hotspot: 1,
  };

  const zonePri: Record<RecommendationZone, number> = {
    content: 6,
    output: 5,
    input: 4,
    model: 3,
    metadata: 2,
    other: 1,
  };

  const scored = items.map((it) => {
    const es = clamp01(it.signals?.engineScore ?? 0);
    const zs = clamp01(it.signals?.zoneShare ?? 0);
    const hw = clamp01(it.signals?.hotspotWeight ?? 0);

    const finalScore = clamp01(es * W_ENGINE + zs * W_ZONE + hw * W_HOTSPOT);

    return { ...it, score: finalScore };
  });

  scored.sort((a, b) => {
    // primary: final score
    if (b.score !== a.score) return b.score - a.score;

    // explicit priority: engineScore > zoneShare > hotspotWeight
    const aes = a.signals?.engineScore ?? 0;
    const bes = b.signals?.engineScore ?? 0;
    if (bes !== aes) return bes - aes;

    const azs = a.signals?.zoneShare ?? 0;
    const bzs = b.signals?.zoneShare ?? 0;
    if (bzs !== azs) return bzs - azs;

    const ahw = a.signals?.hotspotWeight ?? 0;
    const bhw = b.signals?.hotspotWeight ?? 0;
    if (bhw !== ahw) return bhw - ahw;

    // tie-breaks: kind, zone, shallow path, lex
    const ka = kindPri[a.kind] ?? 0;
    const kb = kindPri[b.kind] ?? 0;
    if (kb !== ka) return kb - ka;

    const za = zonePri[a.zone] ?? 0;
    const zb = zonePri[b.zone] ?? 0;
    if (zb !== za) return zb - za;

    const da = (a.canonicalPath.match(/[.[\]]/g) ?? []).length;
    const db = (b.canonicalPath.match(/[.[\]]/g) ?? []).length;
    if (da !== db) return da - db;

    return a.canonicalPath.localeCompare(b.canonicalPath);
  });

  return scored;
}

/**
 * Pick subset for "Pin Recommended (N)".
 * Use score threshold + cap. If none, fallback to top 3.
 */
export function pickRecommended(
  items: RecommendationItem[],
  opts?: { threshold?: number; cap?: number },
): RecommendationItem[] {
  const threshold = opts?.threshold ?? 0.55;
  const cap = opts?.cap ?? 10;

  const strong = items.filter((it) => it.score >= threshold);
  const base = strong.length
    ? strong
    : items.slice(0, Math.min(3, items.length));
  return base.slice(0, cap);
}

/**
 * Build unified recommendations from the sources:
 *  - enginePins: RecommendedPin[] (full)
 *  - uiAutoPins: {recommendedPins: string[], reasons?: string[]} (paths-only)
 *  - explainablePins: ExplainableAutoPinLike[] (deriveExplainableAutoPins)
 *  - hotspots: HotspotLike[] (computeHotspots)
 *  - zoneShareByZone: { content:0.4, metadata:0.2 ... } optional
 */
export function buildUnifiedRecommendations(args: {
  enginePins?: RecommendedPin[];
  uiAutoPins?: UiAutoPinsLike | null;
  explainablePins?: ExplainableAutoPinLike[];
  hotspots?: HotspotLike[];
  zoneShareByZone?: Partial<Record<RecommendationZone, number>> | null;
  recommendedOpts?: { threshold?: number; cap?: number };
}): UnifiedRecommendations {
  const engineItems = fromEnginePins(args.enginePins ?? []);
  const uiItems = fromUiAutoPins(args.uiAutoPins ?? null);
  const heuristicItems = fromExplainablePins(args.explainablePins ?? []);
  const hotspotItems = fromHotspots(args.hotspots ?? []);

  const withZones = applyZoneShares(
    [...engineItems, ...uiItems, ...heuristicItems, ...hotspotItems],
    args.zoneShareByZone ?? null,
  );

  const merged = dedupeAndMerge(withZones);
  const ranked = rankRecommendations(merged);
  const recommended = pickRecommended(ranked, args.recommendedOpts);

  return {
    items: ranked,
    recommended,
    newCount: 0, // wire later (based on pinned state)
  };
}

/**
 * Back-compat: existing callers
 * Build unified recommendations from the two engine sources you have today.
 */
export function buildUnifiedFromEngineOnly(args: {
  enginePins?: RecommendedPin[];
  uiAutoPins?: UiAutoPinsLike | null;
}): UnifiedRecommendations {
  return buildUnifiedRecommendations({
    enginePins: args.enginePins,
    uiAutoPins: args.uiAutoPins,
  });
}
