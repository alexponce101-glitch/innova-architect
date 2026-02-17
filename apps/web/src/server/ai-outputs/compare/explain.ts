// apps/web/src/server/ai-outputs/compare/explain.ts
import type { CompareResult } from "./types";

export type ExplainSemanticDiffResult = {
  summary: string;
  bullets: string[];
  confidence: "high" | "medium" | "low";
};

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

function topPrefixes(paths: string[], max = 5) {
  // agrupa por primer segmento: "metadata.hash" -> "metadata"
  const prefixes = paths
    .map((p) => (p.startsWith("$.") ? p.slice(2) : p))
    .map((p) => p.split(".")[0] || p)
    .filter(Boolean);

  const counts = new Map<string, number>();
  for (const pref of prefixes) counts.set(pref, (counts.get(pref) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k, n]) => ({ key: k, count: n }));
}

function isOnlyMetadata(paths: string[]) {
  if (!paths.length) return false;
  return paths.every((p) => p.includes("metadata"));
}

export function explainCompareDeterministic(
  compare: CompareResult,
): ExplainSemanticDiffResult {
  const classification = compare.semantic?.classification ?? "UNKNOWN";
  const score =
    typeof compare.semantic?.score === "number"
      ? compare.semantic!.score
      : null;

  const sjson = compare.structural?.json;
  const changed = (sjson?.changedPaths ?? []) as string[];
  const added = (sjson?.addedPaths ?? []) as string[];
  const removed = (sjson?.removedPaths ?? []) as string[];

  const changedCount = Number(sjson?.changedCount ?? changed.length ?? 0);
  const addedCount = Number(sjson?.addedCount ?? added.length ?? 0);
  const removedCount = Number(sjson?.removedCount ?? removed.length ?? 0);

  const allPaths = uniq([...changed, ...added, ...removed]);

  // Normalizamos classification a nuestro vocabulario de UI
  const rawClass = String(classification ?? "").toUpperCase();

  const uiClass: "MAJOR_SHIFT" | "MINOR_SHIFT" | "STABLE" =
    rawClass === "MEANINGFUL" || rawClass === "MAJOR_SHIFT"
      ? "MAJOR_SHIFT"
      : rawClass === "MINOR" || rawClass === "MINOR_SHIFT"
        ? "MINOR_SHIFT"
        : "STABLE";

  // Mensaje principal (WOW)
  let summary = "";
  if (uiClass === "MAJOR_SHIFT") {
    summary =
      "Cambio fuerte: el resultado parece haber cambiado de enfoque o intención general.";
  } else if (uiClass === "MINOR_SHIFT") {
    summary =
      "Cambio moderado: hay ajustes visibles, pero mantiene la intención general.";
  } else {
    summary =
      "Estable: los resultados son muy similares; los cambios (si existen) son menores.";
  }

  const bullets: string[] = [];

  if (score !== null) {
    bullets.push(`Score semántico: ${score.toFixed(3)} (${uiClass})`);
  } else {
    bullets.push(`Clasificación semántica: ${classification},`);
  }

  // Si prácticamente no hay diffs estructurales
  const structuralTotal = changedCount + addedCount + removedCount;
  if (structuralTotal === 0) {
    bullets.push(
      "No se detectaron diffs estructurales (Changed/Added/Removed = 0).",
    );
    bullets.push(
      "Si ves una diferencia semántica, probablemente viene de cómo el modelo interpretó el contexto (no de cambios del JSON base).",
    );
  } else {
    bullets.push(
      `Diffs estructurales: Changed=${changedCount}, Added=${addedCount}, Removed=${removedCount}.`,
    );

    if (isOnlyMetadata(allPaths)) {
      bullets.push(
        "Los cambios están concentrados en `metadata` (hash, timestamps, jobId, etc.).",
      );
      bullets.push(
        "Esto suele indicar que el contenido principal es casi igual, pero cambió la corrida/registro del resultado.",
      );
    } else {
      const tops = topPrefixes(allPaths, 5);
      if (tops.length) {
        bullets.push(
          "Zonas más afectadas: " +
            tops.map((t) => `\`${t.key}\` (${t.count})`).join(", "),
        );
      }

      // ejemplo: mostrar algunas paths
      const sample = allPaths.slice(0, 6);
      if (sample.length) {
        bullets.push(
          "Ejemplos de paths: " + sample.map((p) => `\`${p}\``).join(", "),
        );
      }
    }
  }

  // Confianza (deterministica)
  let confidence: ExplainSemanticDiffResult["confidence"] = "medium";

  if (uiClass === "STABLE" && structuralTotal === 0) confidence = "high";
  if (uiClass === "MAJOR_SHIFT" && structuralTotal > 0) confidence = "high";
  if (structuralTotal === 0 && score != null && score < 0.35)
    confidence = "low";

  return { summary, bullets, confidence };
}
