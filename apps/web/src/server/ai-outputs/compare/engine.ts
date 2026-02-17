// apps/web/src/server/ai-outputs/compare/engine.ts
import type { CompareMode, CompareResult } from "./types";
import { structuralCompare } from "./structural";
import { semanticCompare } from "./semantic";
import { recommendPins } from "./recommendPins";
import { detectZones } from "./zones";
import { explainWhyAndConfidence } from "./explainWhy";

type AiOutputLike = {
  id: string;
  payloadHash?: string;
  payloadJson?: unknown;
  outputJson?: unknown;
};

// --- helpers (local, safe) ---
function emptyCompareResult(
  aId: string,
  bId: string,
  mode: CompareMode,
  createdAt: string,
): CompareResult {
  return {
    a: aId,
    b: bId,
    mode,

    // Core shape required by UI + WOW #9/#10
    summary: { changed: 0, added: 0, removed: 0, total: 0 },
    diff: { changedPaths: [], addedPaths: [], removedPaths: [] },
    hotspots: [],
    zones: {},

    // Optional meta (we fill by default to avoid "possibly undefined")
    meta: {
      createdAt,
      engineVersion: "v1",
    },
  };
}

function ensureMeta(result: CompareResult, createdAt: string) {
  result.meta ??= { createdAt, engineVersion: "v1" };
}

function applyWow3_4_5Meta(result: CompareResult, createdAt: string) {
  ensureMeta(result, createdAt);

  // ✅ WOW #3
  result.meta!.recommendedPins = recommendPins(result);

  // ✅ WOW #4
  result.meta!.zones = detectZones(result);

  // ✅ WOW #5
  const ex = explainWhyAndConfidence(result);
  result.meta!.why = ex.why;
  result.meta!.confidence = ex.confidence;
}

export function compareAiOutputs(opts: {
  a: AiOutputLike;
  b: AiOutputLike;
  mode: CompareMode;
}): CompareResult {
  const { a, b, mode } = opts;

  const createdAt = new Date().toISOString();

  // Always start with a fully-shaped result (prevents missing summary/diff/hotspots/zones)
  const result: CompareResult = emptyCompareResult(a.id, b.id, mode, createdAt);

  // Smart short-circuit for payload compare
  if (
    mode === "payload" &&
    a.payloadHash &&
    b.payloadHash &&
    a.payloadHash === b.payloadHash
  ) {
    result.shortCircuit = {
      reusedBecause: "PAYLOAD_HASH_MATCH",
      payloadHash: a.payloadHash,
    };

    result.structural = {
      changed: [],
      unchanged: ["<payload>"],
      json: {
        changedPaths: [],
        addedPaths: [],
        removedPaths: [],
        changedCount: 0,
        addedCount: 0,
        removedCount: 0,
      },
    };

    // Even in short-circuit we keep WOW meta consistent
    applyWow3_4_5Meta(result, createdAt);
    return result;
  }

  if (mode === "payload") {
    result.structural = structuralCompare(
      a.payloadJson ?? null,
      b.payloadJson ?? null,
    );

    // Keep meta consistent (and avoids undefined meta errors)
    ensureMeta(result, createdAt);
    result.meta!.recommendedPins = recommendPins(result);
    result.meta!.zones = detectZones(result);

    // Optional: why/confidence (safe)
    const ex = explainWhyAndConfidence(result);
    result.meta!.why = ex.why;
    result.meta!.confidence = ex.confidence;

    return result;
  }

  if (mode === "output") {
    result.structural = structuralCompare(
      a.outputJson ?? null,
      b.outputJson ?? null,
    );

    ensureMeta(result, createdAt);
    result.meta!.recommendedPins = recommendPins(result);
    result.meta!.zones = detectZones(result);

    const ex = explainWhyAndConfidence(result);
    result.meta!.why = ex.why;
    result.meta!.confidence = ex.confidence;

    return result;
  }

  // mode === "semantic"
  // Semantic se calcula sobre outputs.
  result.semantic = semanticCompare(a.outputJson ?? null, b.outputJson ?? null);

  // 🔥 structural diff en semantic debe usar outputJson para habilitar paths/pins.
  // Fallback: si falta outputJson en alguno, cae a payloadJson.
  const aStructBase = a.outputJson ?? a.payloadJson ?? null;
  const bStructBase = b.outputJson ?? b.payloadJson ?? null;
  result.structural = structuralCompare(aStructBase, bStructBase);

  ensureMeta(result, createdAt);
  result.meta!.recommendedPins = recommendPins(result);
  result.meta!.zones = detectZones(result);

  const ex = explainWhyAndConfidence(result);
  result.meta!.why = ex.why;
  result.meta!.confidence = ex.confidence;

  return result;
}
