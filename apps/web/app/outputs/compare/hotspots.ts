export type Zone = "metadata" | "content" | "model" | "input" | "other";

export type Hotspot = {
  zone: Zone;
  pathPrefix: string; // e.g. "metadata.", "content.sections", "model."
  count: number; // cuántos diffs caen aquí
  score: number; // para ordenar (por ahora = count)
  samplePaths: string[];
};

// Heurística simple y robusta
export function zoneForPath(path: string): Zone {
  const p = path.toLowerCase();
  if (p.startsWith("metadata.") || p.startsWith("meta.")) return "metadata";
  if (
    p.startsWith("content.") ||
    p.includes(".sections") ||
    p.includes("sections[")
  )
    return "content";
  if (p.startsWith("model.") || p.includes("provider") || p.includes("tokens"))
    return "model";
  if (
    p.startsWith("input.") ||
    p.startsWith("prompt.") ||
    p.includes("instructions")
  )
    return "input";
  return "other";
}

// Tomamos un prefix “usable” para chips (no demasiado granular)
export function prefixForPath(path: string): string {
  // corta a 2 segmentos: a.b
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return path;
  if (parts.length === 1) return parts[0] + ".";
  return parts[0] + "." + parts[1]; // e.g. "content.sections"
}

// diffList puede tener shape distinta: lo único que exigimos es "path" string
export function computeHotspots(
  diffList: Array<{ path?: unknown }>,
): Hotspot[] {
  const buckets = new Map<
    string,
    { zone: Zone; prefix: string; count: number; samples: Set<string> }
  >();

  for (const d of diffList) {
    const path = typeof d?.path === "string" ? d.path : "";
    if (!path) continue;

    const zone = zoneForPath(path);
    const prefix = prefixForPath(path);
    const key = `${zone}::${prefix}`;

    const cur = buckets.get(key) ?? {
      zone,
      prefix,
      count: 0,
      samples: new Set<string>(),
    };
    cur.count += 1;
    if (cur.samples.size < 5) cur.samples.add(path);
    buckets.set(key, cur);
  }

  const out: Hotspot[] = Array.from(buckets.values()).map((b) => ({
    zone: b.zone,
    pathPrefix: b.prefix,
    count: b.count,
    score: b.count,
    samplePaths: Array.from(b.samples),
  }));

  out.sort((a, b) => b.score - a.score);
  return out;
}

export function topZones(
  hotspots: Hotspot[],
): Array<{ zone: Zone; count: number }> {
  const m = new Map<Zone, number>();
  for (const h of hotspots) m.set(h.zone, (m.get(h.zone) ?? 0) + h.count);
  return Array.from(m.entries())
    .map(([zone, count]) => ({ zone, count }))
    .sort((a, b) => b.count - a.count);
}
