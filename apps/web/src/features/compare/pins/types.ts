export type CompareRowId = string & { __brand: "CompareRowId" };

export type DiffTone = "changed" | "added" | "removed";

export type JsonPointer = string & { __brand: "JsonPointer" };

export type UnixMs = number & { __brand: "UnixMs" };

export type CompareMode = "payload" | "output" | "semantic";

export type PinReason =
  | "QA"
  | "DesignReview"
  | "PMReview"
  | "Regression"
  | "Other";

export type Pin = {
  rowId: CompareRowId;
  pointer: JsonPointer; // usamos "path" normalizado (dot/bracket -> dot si aplica)
  tone: DiffTone;
  label?: string;
  reason?: PinReason;
  createdAtMs: UnixMs;
  updatedAtMs: UnixMs;
};

export type PinnedStateV1 = {
  version: 1;
  compareSessionKey: string;
  pinsById: Record<string, Pin>; // key = rowId (string)
};

export type PinnedAction =
  | { type: "PIN_ADD"; pin: Pin }
  | { type: "PIN_REMOVE"; rowId: CompareRowId }
  | { type: "PIN_TOGGLE"; pin: Pin }
  | { type: "PIN_CLEAR_ALL" }
  | { type: "PIN_BULK_SET"; pins: Pin[] };

/**
 * Export JSON v1 — estable, machine-friendly (ideal para snapshots/import/share)
 * Nota: esto NO reemplaza tu buildPinnedSnapshotV1 si ya existe en ./export,
 * pero estandariza el shape para que sea consistente en el proyecto.
 */
export type PinsExportJsonV1 = {
  schema: "innova.compare.pins.export.v1";
  exportedAtMs: UnixMs;

  compareSessionKey: string;
  a: string; // prevOutputId
  b: string; // nextOutputId
  mode: CompareMode;

  pins: Array<{
    rowId: CompareRowId;
    path: string; // pointer como string
    tone: DiffTone;
    label?: string;
    reason?: PinReason;
    createdAtMs: UnixMs;
    updatedAtMs: UnixMs;
  }>;
};
