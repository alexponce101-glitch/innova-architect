// apps/web/src/server/ai-outputs/compare/semantic.ts
import type { SemanticClassification } from "./types";

function extractTextish(
  input: unknown,
  out: string[] = [],
  depth = 0,
): string[] {
  if (depth > 10) return out;

  if (typeof input === "string") {
    const s = input.trim();
    if (s) out.push(s);
    return out;
  }
  if (typeof input === "number" || typeof input === "boolean") return out;
  if (!input || typeof input !== "object") return out;

  if (Array.isArray(input)) {
    for (const v of input) extractTextish(v, out, depth + 1);
    return out;
  }

  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    // include keys lightly (helps semantic hints)
    if (typeof k === "string" && k.length <= 40) out.push(k);
    extractTextish(v, out, depth + 1);
  }
  return out;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[\u2019’]/g, "'")
    .replace(/[^a-z0-9áéíóúüñ' ]+/gi, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

function classify(score: number): SemanticClassification {
  // Tunable thresholds
  if (score >= 0.985) return "UNCHANGED";
  if (score >= 0.93) return "MINOR";
  if (score >= 0.8) return "MEANINGFUL";
  return "MAJOR_SHIFT";
}

export function semanticCompare(
  aOutputJson: unknown,
  bOutputJson: unknown,
): {
  score: number;
  classification: SemanticClassification;
  summary: string;
  method: "HEURISTIC_TEXT_JACCARD";
} {
  const aParts = extractTextish(aOutputJson);
  const bParts = extractTextish(bOutputJson);

  const aTokens = new Set(tokenize(aParts.join(" ")));
  const bTokens = new Set(tokenize(bParts.join(" ")));

  const score = jaccard(aTokens, bTokens);
  const classification = classify(score);

  // lightweight summary
  const summary =
    classification === "UNCHANGED"
      ? "Sin cambios semánticos detectables."
      : classification === "MINOR"
        ? "Cambios menores (probablemente cosméticos)."
        : classification === "MEANINGFUL"
          ? "Cambios relevantes en contenido o intención."
          : "Cambio fuerte: posible cambio de enfoque/resultado.";

  return { score, classification, summary, method: "HEURISTIC_TEXT_JACCARD" };
}
