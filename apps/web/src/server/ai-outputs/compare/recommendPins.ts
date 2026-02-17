// apps/web/src/server/ai-outputs/compare/recommendPins.ts

import type { CompareResult, RecommendedPin } from "./types";

function uniqByPath(items: RecommendedPin[]) {
  const m = new Map<string, RecommendedPin>();
  for (const it of items) {
    const prev = m.get(it.path);
    if (!prev || it.score > prev.score) m.set(it.path, it);
  }
  return Array.from(m.values());
}

function isOnlyNoisePaths(paths: string[]) {
  if (paths.length === 0) return false;
  return paths.every(
    (p) =>
      p.includes("createdAt") ||
      p.includes("finishedAt") ||
      p.toLowerCase().includes("jobid") ||
      p.startsWith("meta."),
  );
}

function isOnlyMetadataLike(paths: string[]) {
  if (paths.length === 0) return false;

  // En tu modelo actual, lo más cercano a "metadata" del output está en headers/meta (y en algunos casos snapshots).
  // Esto es determinístico pero conservador:
  return paths.every(
    (p) =>
      p.startsWith("headers.") ||
      p === "headers" ||
      p.startsWith("meta.") ||
      p === "meta",
  );
}

function pickTopHotspotsFromChangedPaths(paths: string[], max = 7): string[] {
  // v1: como no hay hotspots explícitos en CompareResult,
  // usamos changedPaths como “hotspots” determinísticos.
  const cleaned: string[] = paths
    .map((p) => String(p).trim())
    .filter((p) => p.length > 0)
    // evita sugerir ruido repetido
    .filter((p) => !p.startsWith("meta."))
    .slice(0, 200);

  // de-dup conservador preservando orden
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const p of cleaned) {
    if (seen.has(p)) continue;
    seen.add(p);
    uniq.push(p);
  }

  return uniq.slice(0, max);
}

export function recommendPins(compare: CompareResult): RecommendedPin[] {
  const out: RecommendedPin[] = [];

  const changedPaths =
    compare.structural?.json?.changedPaths ?? compare.structural?.changed ?? [];

  // D) ruido timing/jobId/meta
  if (isOnlyNoisePaths(changedPaths)) {
    return [];
  }

  // A) “solo metadata” (headers/meta)
  if (isOnlyMetadataLike(changedPaths)) {
    out.push({
      path: "headers",
      reason:
        "Only headers/meta changed; pin headers to review provenance/settings changes.",
      score: 80,
      tags: ["metadata"],
    });
  }

  // C) settings (provider/model/version) — usando headers si existen
  const ha = compare.headers?.a;
  const hb = compare.headers?.b;

  if (ha && hb) {
    if ((ha.model ?? "") !== (hb.model ?? "")) {
      out.push({
        path: "headers.a.model",
        reason: "Model changed; pin model to confirm generation settings.",
        score: 70,
        tags: ["settings"],
      });
      out.push({
        path: "headers.b.model",
        reason: "Model changed; pin model to confirm generation settings.",
        score: 70,
        tags: ["settings"],
      });
    }

    if ((ha.provider ?? "") !== (hb.provider ?? "")) {
      out.push({
        path: "headers.a.provider",
        reason:
          "Provider changed; pin provider to confirm generation settings.",
        score: 70,
        tags: ["settings"],
      });
      out.push({
        path: "headers.b.provider",
        reason:
          "Provider changed; pin provider to confirm generation settings.",
        score: 70,
        tags: ["settings"],
      });
    }

    if ((ha.version ?? "") !== (hb.version ?? "")) {
      out.push({
        path: "headers.a.version",
        reason: "Version changed; pin version for traceability.",
        score: 65,
        tags: ["settings"],
      });
      out.push({
        path: "headers.b.version",
        reason: "Version changed; pin version for traceability.",
        score: 65,
        tags: ["settings"],
      });
    }
  }

  // B) semantic major shift
  if (compare.semantic?.classification === "MAJOR_SHIFT") {
    out.push({
      path: "semantic.summary",
      reason:
        "Major semantic shift detected; pin semantic summary to review meaning changes.",
      score: 95,
      tags: ["semantic"],
    });

    // Como el CompareResult trae snapshots, usamos esos como destino pinneable.
    out.push({
      path: "snapshots.aOutputJson",
      reason: "Major semantic shift; pin A output snapshot to compare content.",
      score: 90,
      tags: ["semantic"],
    });
    out.push({
      path: "snapshots.bOutputJson",
      reason: "Major semantic shift; pin B output snapshot to compare content.",
      score: 90,
      tags: ["semantic"],
    });
  }

  // E) hotspots v1 (desde changedPaths)
  const top = pickTopHotspotsFromChangedPaths(changedPaths, 7);
  let i = 0;
  for (const p of top) {
    out.push({
      path: p,
      reason:
        "High-change hotspot (from structural changedPaths); pin to review impactful diffs.",
      score: 55 - i, // orden estable
      tags: ["hotspot"],
    });
    i++;
  }

  return uniqByPath(out).sort((a, b) => b.score - a.score);
}
