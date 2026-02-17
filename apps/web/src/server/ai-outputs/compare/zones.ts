import type { CompareResult, ZoneSummary } from "./types";

function takeExamples(paths: string[], n = 5) {
  return paths.slice(0, n);
}

function startsAny(p: string, prefixes: string[]) {
  return prefixes.some((x) => p === x || p.startsWith(x + "."));
}

export function detectZones(compare: CompareResult): ZoneSummary[] {
  const changed =
    compare.structural?.json?.changedPaths ?? compare.structural?.changed ?? [];

  const paths = (Array.isArray(changed) ? changed : []).map((x) => String(x));

  // Header diffs (settings)
  const ha = compare.headers?.a;
  const hb = compare.headers?.b;
  const modelChanged = !!ha && !!hb && (ha.model ?? "") !== (hb.model ?? "");
  const providerChanged =
    !!ha && !!hb && (ha.provider ?? "") !== (hb.provider ?? "");
  const versionChanged =
    !!ha && !!hb && (ha.version ?? "") !== (hb.version ?? "");

  // Noise/timing
  const isTiming = (p: string) =>
    p.includes("createdAt") ||
    p.includes("finishedAt") ||
    p.toLowerCase().includes("jobid") ||
    p.includes("durationMs") ||
    p.startsWith("meta.");

  const timingPaths = paths.filter(isTiming);
  const nonTimingPaths = paths.filter((p) => !isTiming(p));

  const zones: ZoneSummary[] = [];

  // TIMING
  if (timingPaths.length && nonTimingPaths.length === 0) {
    zones.push({
      zone: "TIMING",
      score: 90,
      reason: "Only timing/job/meta fields changed (noise).",
      examples: takeExamples(timingPaths),
    });
    return zones;
  }

  // MODEL
  if (
    modelChanged ||
    providerChanged ||
    versionChanged ||
    paths.some((p) => startsAny(p, ["headers.a", "headers.b"]))
  ) {
    const ex: string[] = [];
    if (modelChanged) ex.push("headers.*.model");
    if (providerChanged) ex.push("headers.*.provider");
    if (versionChanged) ex.push("headers.*.version");
    zones.push({
      zone: "MODEL",
      score: 85,
      reason: "Provider/model/version changed (generation settings).",
      examples: ex.length
        ? ex
        : takeExamples(paths.filter((p) => p.startsWith("headers."))),
    });
  }

  // METADATA (headers/meta-ish)
  const metadataPaths = paths.filter(
    (p) => p === "headers" || p.startsWith("headers."),
  );
  if (metadataPaths.length && metadataPaths.length === nonTimingPaths.length) {
    zones.push({
      zone: "METADATA",
      score: 80,
      reason: "Changes are confined to headers/metadata.",
      examples: takeExamples(metadataPaths),
    });
  }

  // SECTIONS / CONTENT / STRUCTURE heuristics
  const sectionPaths = nonTimingPaths.filter(
    (p) => p === "sections" || p.startsWith("sections."),
  );
  if (sectionPaths.length) {
    zones.push({
      zone: "SECTIONS",
      score: Math.min(100, 50 + sectionPaths.length),
      reason: "Section-level changes detected.",
      examples: takeExamples(sectionPaths),
    });
  }

  const contentPaths = nonTimingPaths.filter((p) =>
    startsAny(p, ["content", "summary", "semantic"]),
  );
  if (contentPaths.length) {
    zones.push({
      zone: "CONTENT",
      score: Math.min(100, 55 + contentPaths.length),
      reason: "Meaning/content-related paths changed.",
      examples: takeExamples(contentPaths),
    });
  }

  const structurePaths = nonTimingPaths.filter((p) =>
    startsAny(p, ["snapshots", "outputJson", "payloadJson"]),
  );
  if (structurePaths.length) {
    zones.push({
      zone: "STRUCTURE",
      score: Math.min(100, 45 + structurePaths.length),
      reason: "Snapshot/structure paths changed.",
      examples: takeExamples(structurePaths),
    });
  }

  if (!zones.length) {
    zones.push({
      zone: "UNKNOWN",
      score: 40,
      reason: "No clear dominant zone; fallback based on structural paths.",
      examples: takeExamples(nonTimingPaths),
    });
  }

  // Orden: score desc
  return zones.sort((a, b) => b.score - a.score).slice(0, 4);
}
