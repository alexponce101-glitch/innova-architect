import { z } from "zod";
import type {
  Pin,
  UnixMs,
  CompareRowId,
  JsonPointer,
  DiffTone,
  PinReason,
} from "./types";

export type PinnedSnapshotV1 = {
  schema: "innova.compare.pins.snapshot.v1";
  createdAtMs: UnixMs;
  compareSessionKey: string;
  prevOutputId: string;
  nextOutputId: string;
  pins: Array<{
    rowId: string;
    pointer: string;
    tone: "changed" | "added" | "removed";
    label?: string;
    reason?: string;
    createdAtMs: number;
    updatedAtMs: number;
  }>;
};

function sortPinsStable(pins: Pin[]): Pin[] {
  return [...pins].sort((a, b) => {
    const d = (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0);
    if (d !== 0) return d;
    return String(a.rowId).localeCompare(String(b.rowId));
  });
}

export function buildPinnedSnapshotV1(args: {
  nowMs: number;
  compareSessionKey: string;
  prevOutputId: string;
  nextOutputId: string;
  pins: Pin[];
}): PinnedSnapshotV1 {
  const pinsSorted = sortPinsStable(args.pins);

  return {
    schema: "innova.compare.pins.snapshot.v1",
    createdAtMs: args.nowMs as UnixMs,
    compareSessionKey: args.compareSessionKey,
    prevOutputId: args.prevOutputId,
    nextOutputId: args.nextOutputId,
    pins: pinsSorted.map((p) => ({
      rowId: p.rowId,
      pointer: p.pointer,
      tone: p.tone,
      label: p.label,
      reason: p.reason,
      createdAtMs: p.createdAtMs,
      updatedAtMs: p.updatedAtMs,
    })),
  };
}

// ----------------------
// Import (Parse Snapshot)
// ----------------------

const PinReasonZ = z.enum([
  "QA",
  "DesignReview",
  "PMReview",
  "Regression",
  "Other",
]);
const DiffToneZ = z.enum(["changed", "added", "removed"]);

const SnapshotPinZ = z.object({
  rowId: z.string().min(1),
  pointer: z.string().min(1),
  tone: DiffToneZ,
  label: z.string().optional(),
  reason: z.string().optional(), // snapshot legacy: string
  createdAtMs: z.number(),
  updatedAtMs: z.number(),
});

const PinnedSnapshotV1Z = z.object({
  schema: z.literal("innova.compare.pins.snapshot.v1"),
  createdAtMs: z.number(),
  compareSessionKey: z.string().min(1),
  prevOutputId: z.string().min(1),
  nextOutputId: z.string().min(1),
  pins: z.array(SnapshotPinZ),
});

export type ParsedPinsImport = {
  meta: {
    schema: "innova.compare.pins.snapshot.v1";
    createdAtMs: number;
    compareSessionKey: string;
    prevOutputId: string;
    nextOutputId: string;
  };
  pins: Pin[];
};

/**
 * Parse JSON text of a pins snapshot. Throws a readable Error on invalid format.
 */
export function parsePinnedSnapshotV1(jsonText: string): ParsedPinsImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Import failed: invalid JSON.");
  }

  const v = PinnedSnapshotV1Z.safeParse(parsed);
  if (!v.success) {
    throw new Error("Import failed: JSON does not match snapshot schema v1.");
  }

  const data = v.data;

  const pins: Pin[] = data.pins.map((p) => {
    // reason: snapshot is string; we only accept known reasons, otherwise omit.
    const reasonParsed = PinReasonZ.safeParse(p.reason);
    const reason = reasonParsed.success
      ? (reasonParsed.data as PinReason)
      : undefined;

    return {
      rowId: p.rowId as CompareRowId,
      pointer: p.pointer as JsonPointer,
      tone: p.tone as DiffTone,
      label: p.label,
      reason,
      createdAtMs: p.createdAtMs as UnixMs,
      updatedAtMs: p.updatedAtMs as UnixMs,
    };
  });

  return {
    meta: {
      schema: "innova.compare.pins.snapshot.v1",
      createdAtMs: data.createdAtMs,
      compareSessionKey: data.compareSessionKey,
      prevOutputId: data.prevOutputId,
      nextOutputId: data.nextOutputId,
    },
    pins,
  };
}

// ----------------------
// CSV (Excel/QA/PM friendly)
// ----------------------

function csvEscape(val: unknown): string {
  const s = String(val ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function pinsToCsv(args: {
  prevOutputId: string;
  nextOutputId: string;
  pins: Pin[];
}): string {
  const header = [
    "rowId",
    "pointer",
    "tone",
    "label",
    "reason",
    "createdAt",
    "updatedAt",
    "prevOutputId",
    "nextOutputId",
  ];

  const pinsSorted = sortPinsStable(args.pins);

  const lines = [header.join(",")];

  for (const p of pinsSorted) {
    const row = [
      p.rowId,
      p.pointer,
      p.tone,
      p.label ?? "",
      p.reason ?? "",
      new Date(Number(p.createdAtMs)).toISOString(),
      new Date(Number(p.updatedAtMs)).toISOString(),
      args.prevOutputId,
      args.nextOutputId,
    ].map(csvEscape);

    lines.push(row.join(","));
  }

  // newline final = friendly for tools
  return lines.join("\n") + "\n";
}
