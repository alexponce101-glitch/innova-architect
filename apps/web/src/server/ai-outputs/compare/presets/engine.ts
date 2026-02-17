// apps/web/src/server/ai-outputs/compare/presets/engine.ts
import type { ComparePresetSignal, SmartPreset } from "./types";

function clamp01(n: number) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function avg(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function deriveSmartPresets(signal: ComparePresetSignal): SmartPreset[] {
  const suggested = signal.suggestedPins ?? [];

  // Heurística base: si hay pins sugeridos mayormente de "content" / paths con "content"
  const contentPins = suggested.filter((s) => {
    const p = s.path ?? "";
    return (
      s.kind === "content" ||
      p.startsWith("content.") ||
      p.includes(".sections")
    );
  });

  // Confidence: si tenemos confidences, promediamos los contentPins; si no, inferimos por proporción.
  const contentConf = avg(
    contentPins.map((x) =>
      typeof x.confidence === "number" ? x.confidence : 0,
    ),
  ).toFixed(4);
  const inferred = contentPins.length / Math.max(1, suggested.length);

  const confidence = clamp01(
    contentPins.some((x) => typeof x.confidence === "number")
      ? Number(contentConf)
      : inferred,
  );

  // Gate: solo creamos Semantic Review si hay señal fuerte de "content"
  const shouldCreateSemanticReview =
    contentPins.length >= 2 ||
    (signal.zones?.content ?? 0) > (signal.zones?.metadata ?? 0);

  const presets: SmartPreset[] = [];

  if (shouldCreateSemanticReview) {
    const why = [
      "Content changes appear dominant vs metadata.",
      "Suggested pins indicate structural/section deltas.",
      ...contentPins.flatMap((x) => x.why ?? []).slice(0, 3),
    ].filter(Boolean);

    const pins = dedupe([
      // Seed “smart defaults” (puedes ajustar a tu schema real)
      "content.sections.*",
      "content.*",
      // Enriquecimiento: lo que ya sugiere el motor
      ...contentPins.map((x) => x.path),
    ]);

    presets.push({
      id: "preset.semantic_review",
      label: "Semantic Review",
      icon: "🧠",
      origin: "engine",
      confidence: clamp01(Math.max(0.72, confidence)), // mínimo “wow”
      why: why.slice(0, 5),
      pins,
      tourId: "tour.semantic_review",
    });
  }

  // (Siguiente preset futuro) Metadata-only, Model-change, Input-review, etc.
  // pero hoy solo entregamos 1 preset WOW y lo hacemos impecable.

  return presets;
}

function dedupe(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const k = (x ?? "").trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}
