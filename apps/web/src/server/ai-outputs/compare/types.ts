// apps/web/src/server/ai-outputs/compare/types.ts

export type CompareMode = "payload" | "output" | "semantic";

export type SemanticClassification =
  | "UNCHANGED"
  | "MINOR"
  | "MEANINGFUL"
  | "MAJOR_SHIFT";

export type JsonDiff = {
  changedPaths: string[];
  addedPaths: string[];
  removedPaths: string[];
  changedCount: number;
  addedCount: number;
  removedCount: number;
};

export type AiOutputHeader = {
  id: string;
  moodboardId: string;
  kind: "GENERATE" | "REFINE";
  version: string;
  parentOutputId?: string;

  payloadHash?: string;
  provider?: string;
  model?: string;

  tokensIn?: number;
  tokensOut?: number;

  createdAt: string;
  finishedAt?: string;
};

export type RecommendedPin = {
  path: string;
  reason: string;
  score: number;
  tags?: string[];
};

// ✅ WOW #4
export type ChangeZone =
  | "METADATA"
  | "MODEL"
  | "PAYLOAD"
  | "OUTPUT"
  | "CONTENT"
  | "SECTIONS"
  | "STRUCTURE"
  | "TIMING"
  | "UNKNOWN";

export type ZoneSummary = {
  zone: ChangeZone;
  score: number; // 0..100
  reason: string;
  examples?: string[];
};

/**
 * DiffEntry / HotspotEntry are used by WOW #9/#10 UI.
 * If you already define these elsewhere, keep ONE canonical definition.
 */
export type DiffTone = "changed" | "added" | "removed";

export type DiffEntry = {
  path: string; // e.g. "metadata.version"
  tone: DiffTone;
  score?: number; // impact (semantic/structural)
  zone?: string; // e.g. "metadata", "sections", "other"
};

export type HotspotEntry = {
  prefix: string; // "<root>" | "metadata." | "sections." ...
  score: number; // aggregated impact
  tone: "changed";
  tags: string[]; // e.g. ["hotspot","structural"]
  paths: string[]; // real paths inside the hotspot
};

export type CompareResult = {
  // 🔹 Existing (do not remove)
  a: string;
  b: string;
  mode: CompareMode;

  headers?: {
    a: AiOutputHeader;
    b: AiOutputHeader;
  };

  // 🔥 WOW #9 + WOW #10 (core compare product shape)
  summary: {
    changed: number;
    added: number;
    removed: number;
    total: number;
  };

  diff: {
    changedPaths: DiffEntry[];
    addedPaths: DiffEntry[];
    removedPaths: DiffEntry[];
  };

  // 🔥 Hotspots + Zones feed: Hotspots UI, Suggested Pins, Pin Prefix, Auto-Pin
  hotspots: HotspotEntry[];

  zones: Record<
    string,
    {
      changed: number;
      paths: string[];
    }
  >;

  // -------------------------
  // Optional fields used by UI / engine shortcuts
  // -------------------------

  snapshots?: {
    aPayloadJson?: unknown;
    bPayloadJson?: unknown;
    aOutputJson?: unknown;
    bOutputJson?: unknown;
  };

  shortCircuit?: {
    reusedBecause: "PAYLOAD_HASH_MATCH";
    payloadHash?: string;
  };

  structural?: {
    changed: string[];
    unchanged: string[];
    json?: JsonDiff;
  };

  semantic?: {
    score: number; // 0..1
    classification: SemanticClassification;
    summary: string;
    method: "HEURISTIC_TEXT_JACCARD";
  };

  // Meta is useful but should be optional: not all modes/engines will attach it.
  meta?: {
    createdAt: string;
    engineVersion: "v1";

    // ✅ WOW #3
    recommendedPins?: RecommendedPin[];

    // ✅ WOW #4
    zones?: ZoneSummary[];

    // ✅ WOW #5
    why?: string[];
    confidence?: number; // 0..100
  };
};
