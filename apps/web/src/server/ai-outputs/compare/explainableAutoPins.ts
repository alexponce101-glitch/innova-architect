// apps/web/src/server/ai-outputs/compare/explainableAutoPins.ts

import type { CompareResult } from "./types";
import type {
  ExplainableAutoPinsResult,
  ExplainableAutoPin,
} from "./autoPinsTypes";

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

// Intenta extraer paths cambiados desde distintos shapes posibles sin romper.
function extractChangedPaths(cr: any): string[] {
  const out: string[] = [];

  // Helper: soporta DiffEntry[] o string[]
  const pushFromEntries = (entries: any) => {
    if (!entries) return;
    if (!Array.isArray(entries)) return;

    for (const e of entries) {
      if (typeof e === "string") {
        out.push(e);
        continue;
      }
      if (!e || typeof e !== "object") continue;

      // soporta varios shapes
      const p =
        (typeof (e as any).path === "string" && (e as any).path) ||
        (typeof (e as any).jsonPath === "string" && (e as any).jsonPath) ||
        (typeof (e as any).key === "string" && (e as any).key) ||
        (typeof (e as any).p === "string" && (e as any).p) ||
        (typeof (e as any).id === "string" && (e as any).id) ||
        "";

      if (p) out.push(p);
    }
  };

  // ✅ Tu shape real (WOW #9/#10)
  pushFromEntries(cr?.diff?.changedPaths);
  pushFromEntries(cr?.diff?.addedPaths);
  pushFromEntries(cr?.diff?.removedPaths);

  // ✅ Structural (tu UI usa "Structural changedPaths")
  if (cr?.structural?.changed && Array.isArray(cr.structural.changed)) {
    pushFromEntries(cr.structural.changed);
  }

  // ✅ Zonas (paths suelen ser string[])
  const zones = cr?.zones;
  if (zones && typeof zones === "object") {
    for (const k of Object.keys(zones)) {
      const z = zones[k];
      if (z?.paths && Array.isArray(z.paths)) pushFromEntries(z.paths);
    }
  }

  // Limpieza + dedupe (NO filtramos <root>)
  const flat = out
    .map((p) => (typeof p === "string" ? p : ""))
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return Array.from(new Set(flat));
}

function clamp01(n: number) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function confidenceFromShare(share: number): "high" | "medium" | "low" {
  const s = clamp01(share);
  if (s >= 0.7) return "high";
  if (s >= 0.35) return "medium";
  return "low";
}

function pct(share: number) {
  return Math.round(clamp01(share) * 100);
}

function makePin(
  compareSessionKey: string,
  path: string,
  label: string,
  confidence: "high" | "medium" | "low",
  reason: string,
  evidencePaths: string[],
): ExplainableAutoPin {
  const evidence = evidencePaths.slice(0, 5).map((p) => ({
    kind: "diff" as const,
    path: p,
  }));

  return {
    key: `${compareSessionKey}:${path}`,
    path,
    label,
    confidence,
    reason,
    evidenceCount: evidencePaths.length,
    evidence,
  };
}

export function deriveExplainableAutoPins(
  compareResult: CompareResult,
  compareSessionKey: string,
): ExplainableAutoPinsResult {
  const changed = extractChangedPaths(compareResult);

  // 🔥 PRIORIDAD: zones reales (excluyendo UNKNOWN)
  {
    const zones = compareResult.zones ?? {};
    const entries = Object.entries(zones) as Array<
      [string, { changed: number; paths: string[] }]
    >;

    const zoneEntries = entries
      .filter(
        ([k, v]) =>
          k !== "UNKNOWN" && Array.isArray(v?.paths) && v.paths.length > 0,
      )
      .sort((a, b) => (b[1]?.changed ?? 0) - (a[1]?.changed ?? 0));

    const first = zoneEntries[0];
    if (first) {
      const zoneKey = first[0];
      const zoneValue = first[1];

      return {
        compareSessionKey,
        generatedAt: new Date().toISOString(),
        version: "wow12@1",
        pins: [
          makePin(
            compareSessionKey,
            `${zoneKey}.*`,
            `Zone: ${zoneKey}.*`,
            "high",
            `Most changes concentrated in zone "${zoneKey}".`,
            zoneValue.paths ?? [],
          ),
        ],
      };
    }
  }

  // No señales → no sugerimos
  if (!changed.length) {
    return {
      compareSessionKey,
      generatedAt: new Date().toISOString(),
      version: "wow12@1",
      pins: [],
    };
  }

  // ✅ Caso especial: solo cambio estructural en root
  const onlyRoot = changed.length === 1 && changed[0] === "<root>";

  if (onlyRoot) {
    // 🔥 Si el engine ya recomendó root, no duplicamos
    const engineSuggested = compareResult.meta?.recommendedPins ?? [];
    const engineHasRoot = engineSuggested.some(
      (r: any) => r?.path === "<root>.*" || r?.path === "<root>",
    );

    if (engineHasRoot) {
      return {
        compareSessionKey,
        generatedAt: new Date().toISOString(),
        version: "wow12@1",
        pins: [],
      };
    }

    return {
      compareSessionKey,
      generatedAt: new Date().toISOString(),
      version: "wow12@1",
      pins: [
        {
          key: `${compareSessionKey}:<root>.*`,
          path: "<root>.*",
          label: "Structural Diff (root level)",
          confidence: "medium",
          reason:
            "Structural change detected at root level — review high-impact differences.",
          evidenceCount: 1,
          evidence: [{ kind: "diff", path: "<root>" }],
        },
      ],
    };
  }

  // Clasificación simple por prefijo
  const meta = changed.filter(
    (p) =>
      p.startsWith("metadata.") ||
      p === "metadata" ||
      p.startsWith("headers.") ||
      p.startsWith("summary."),
  );

  const content = changed.filter(
    (p) =>
      p.startsWith("content.") ||
      p.startsWith("sections.") ||
      p.includes("section"),
  );

  const model = changed.filter(
    (p) =>
      p.startsWith("model.") ||
      p.startsWith("input.") ||
      p.startsWith("prompt."),
  );

  // Si hay <root> mezclado con otros, lo mantenemos como señal adicional
  const rootish = changed.filter(
    (p) => p === "<root>" || p.startsWith("<root>."),
  );

  const pins: ExplainableAutoPin[] = [];

  // Heurística 1: solo metadata cambió
  if (meta.length > 0 && content.length === 0 && model.length === 0) {
    pins.push(
      makePin(
        compareSessionKey,
        "metadata.*",
        "metadata.*",
        "high",
        "Only metadata changed — pin metadata to review quickly.",
        meta,
      ),
    );
  } else {
    // Heurística 2: concentración (top prefijo domina)
    const buckets = new Map<string, string[]>();
    for (const p of changed) {
      const k = p === "<root>" ? "<root>" : p.split(".")[0] || p;
      const arr = buckets.get(k) ?? [];
      arr.push(p);
      buckets.set(k, arr);
    }

    const ranked = Array.from(buckets.entries()).sort(
      (a, b) => b[1].length - a[1].length,
    );
    const [topKey, topPaths] = ranked[0] ?? [];

    if (
      topKey &&
      topPaths &&
      topPaths.length >= Math.max(3, Math.ceil(changed.length * 0.5))
    ) {
      const total = Math.max(1, changed.length);
      const share = topPaths.length / total;
      const conf = confidenceFromShare(share);

      pins.push(
        makePin(
          compareSessionKey,
          topKey === "<root>" ? "<root>.*" : `${topKey}.*`,
          topKey === "<root>"
            ? "Structural Diff (root level)"
            : `Zone: ${topKey}`,
          conf,
          `Most changes are in ${topKey} (${pct(share)}% of changed paths).`,
          topPaths,
        ),
      );
    } else {
      // Heurística 3: disperso → sugerir buckets básicos (máx 3) + root si aplica
      if (meta.length) {
        pins.push(
          makePin(
            compareSessionKey,
            "metadata.*",
            "metadata.*",
            "medium",
            "Some metadata changed.",
            meta,
          ),
        );
      }
      if (content.length) {
        pins.push(
          makePin(
            compareSessionKey,
            "content.*",
            "content.*",
            "medium",
            "Some content changed.",
            content,
          ),
        );
      }
      if (model.length) {
        pins.push(
          makePin(
            compareSessionKey,
            "model.*",
            "model.*",
            "low",
            "Some model/input fields changed.",
            model,
          ),
        );
      }
      if (rootish.length) {
        pins.push(
          makePin(
            compareSessionKey,
            "<root>.*",
            "<root>.*",
            "medium",
            "Structural/root-level changes detected.",
            rootish,
          ),
        );
      }
    }
  }

  return {
    compareSessionKey,
    generatedAt: new Date().toISOString(),
    version: "wow12@1",
    pins: pins.slice(0, 8),
  };
}
