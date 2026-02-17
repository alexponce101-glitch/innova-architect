import type { CompareResult, ZoneSummary } from "./types";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function take<T>(xs: T[] | undefined, n: number) {
  return (xs ?? []).slice(0, n);
}

function fmtZone(z: ZoneSummary | undefined) {
  if (!z) return null;
  const ex = (z.examples ?? []).slice(0, 3);
  const exText = ex.length ? ` (e.g. ${ex.join(" · ")})` : "";
  return `${z.zone} (${z.score}) — ${z.reason}${exText}`;
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : String(x ?? "");
}

export function explainWhyAndConfidence(compare: CompareResult): {
  why: string[];
  confidence: number;
} {
  const why: string[] = [];

  // meta is optional in the type; keep usage safe
  const zones = compare.meta?.zones ?? [];
  const top = zones[0];

  // --- WHY bullets (2–4)
  const zoneLine = fmtZone(top);
  if (zoneLine) why.push(`Top zone: ${zoneLine}`);

  if (compare.semantic) {
    const s = compare.semantic;
    const score = clamp(Number(s.score) || 0, 0, 1);
    why.push(
      `Semantic: ${s.classification} (score ${score.toFixed(3)}) — ${safeStr(s.summary)}`,
    );
  }

  // Prefer the most "evidence-rich" structural signal first
  const changed =
    compare.structural?.json?.changedPaths ?? compare.structural?.changed ?? [];

  const changedList = Array.isArray(changed) ? changed.map(safeStr) : [];

  if (changedList.length) {
    why.push(`Structural changedPaths: ${take(changedList, 3).join(" · ")}`);
  } else if (compare.shortCircuit?.reusedBecause === "PAYLOAD_HASH_MATCH") {
    why.push(
      `Short-circuit: payloadHash matched (${safeStr(compare.shortCircuit.payloadHash ?? "hash")})`,
    );
  } else {
    why.push(
      `No structural changedPaths detected (could be empty/normalized).`,
    );
  }

  // Settings diffs (if headers exist)
  const ha = compare.headers?.a;
  const hb = compare.headers?.b;
  if (ha && hb) {
    const diffs: string[] = [];
    if ((ha.provider ?? "") !== (hb.provider ?? "")) diffs.push("provider");
    if ((ha.model ?? "") !== (hb.model ?? "")) diffs.push("model");
    if ((ha.version ?? "") !== (hb.version ?? "")) diffs.push("version");
    if (diffs.length)
      why.push(`Generation settings changed: ${diffs.join(", ")}`);
  }

  // Keep it snappy (2–4 lines max)
  const whyTrimmed = why.filter((x) => x && x.trim().length > 0).slice(0, 4);

  // --- CONFIDENCE (0..100) deterministic
  // Factors:
  // - strong zone signal (top zone score)
  // - semantic available + classification strength
  // - amount of structural evidence (changed paths)
  // - short-circuit reduces ambiguity (high confidence)
  let c = 40;

  if (top) c += clamp(top.score, 0, 100) * 0.35; // up to +35
  if (compare.shortCircuit?.reusedBecause === "PAYLOAD_HASH_MATCH") c += 25;

  if (compare.semantic) {
    const cls = compare.semantic.classification;
    const sScore = clamp(Number(compare.semantic.score) || 0, 0, 1);
    c += 10 + sScore * 15; // up to +25
    if (cls === "MAJOR_SHIFT") c += 10;
    else if (cls === "MEANINGFUL") c += 6;
    else if (cls === "MINOR") c += 2;
  }

  const nPaths = changedList.length;
  if (nPaths >= 20) c += 12;
  else if (nPaths >= 8) c += 8;
  else if (nPaths >= 3) c += 4;

  // penalty if nothing to go on (no semantic, no paths, no short-circuit)
  if (!compare.semantic && nPaths === 0 && !compare.shortCircuit) c -= 10;

  const confidence = Math.round(clamp(c, 0, 100));

  return { why: whyTrimmed, confidence };
}
