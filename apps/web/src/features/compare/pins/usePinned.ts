"use client";

import * as React from "react";
import type {
  DiffTone,
  Pin,
  CompareRowId,
  PinnedStateV1,
  UnixMs,
} from "./types";
import { LocalPinnedStorage, type PinnedStorage } from "./storage";
import {
  makeEmptyPinnedState,
  pinnedReducer,
  pinnedList,
  pinnedCount,
  isPinned,
} from "./reducer";
import {
  buildPinnedSnapshotV1,
  pinsToCsv,
  parsePinnedSnapshotV1,
} from "./export";
import { usePinFlash } from "./usePinFlash";

export type UsePinnedCompareApi = {
  state: PinnedStateV1;
  pins: Pin[];
  count: number;
  hydrated: boolean;
  lastImportError: string | null;

  isPinned: (rowId: CompareRowId) => boolean;
  makeRowId: (path: string, tone: DiffTone) => CompareRowId;

  togglePin: (input: { path: string; tone: DiffTone; label?: string }) => void;
  unpin: (rowId: CompareRowId) => void;
  clearAll: () => void;

  exportJson: () => void;
  exportCsv: () => void;

  importPinsJsonText: (jsonText: string) => { imported: number; total: number };

  flashByPath: (path: string) => void;
};

function toUnixMs(n: number): UnixMs {
  return n as UnixMs;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function filenameStamp(ms: number) {
  const d = new Date(ms);
  // YYYYMMDD_HHMMSS
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(
    d.getHours(),
  )}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function downloadTextFile(filename: string, mime: string, text: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;

  document.body.appendChild(a);
  a.click();
  a.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function makeRowId(path: string, tone: DiffTone): CompareRowId {
  return `${tone}:${path}` as CompareRowId;
}

function mergePinsLatestWins(existing: Record<string, Pin>, incoming: Pin[]) {
  const out: Record<string, Pin> = { ...existing };

  for (const p of incoming) {
    const key = String(p.rowId);
    const cur = out[key];
    if (!cur) {
      out[key] = p;
      continue;
    }
    const curU = Number(cur.updatedAtMs) || 0;
    const inU = Number(p.updatedAtMs) || 0;
    out[key] = inU >= curU ? p : cur;
  }

  return out;
}

/**
 * Selector helper for data-path. Uses CSS.escape when available, else a safe fallback.
 */
function selectorForPath(path: string) {
  const raw = String(path ?? "");
  const escaped =
    typeof (globalThis as any).CSS?.escape === "function"
      ? (globalThis as any).CSS.escape(raw)
      : raw.replace(/"/g, '\\"');

  return `[data-path="${escaped}"]`;
}

export function usePinnedCompare(args: {
  compareSessionKey: string;
  prevOutputId: string;
  nextOutputId: string;
  storage?: PinnedStorage;
}): UsePinnedCompareApi {
  // ✅ storage estable (y si te pasan uno nuevo, lo usamos)
  const storage: PinnedStorage = React.useMemo(
    () => args.storage ?? new LocalPinnedStorage(),
    [args.storage],
  );

  const [state, dispatch] = React.useReducer(
    pinnedReducer,
    args.compareSessionKey,
    (k) => makeEmptyPinnedState(k),
  );

  const [lastImportError, setLastImportError] = React.useState<string | null>(
    null,
  );

  // ✅ “hydrated” evita persist antes del load inicial
  const [hydrated, setHydrated] = React.useState(false);

  // ref al estado más reciente para import/merge robusto
  const pinsByIdRef = React.useRef(state.pinsById);
  React.useEffect(() => {
    pinsByIdRef.current = state.pinsById;
  }, [state.pinsById]);

  // WOW #11 — Flash hook
  const { flash } = usePinFlash();

  /**
   * Best-effort flash by path.
   * - Runs after DOM paint using rAF
   * - No-ops safely if element is not found
   * - Root paths flash the whole diff container
   */
  const flashByPath = React.useCallback(
    (path: string) => {
      const p = (path ?? "").trim();
      if (!p) return;

      const isRoot =
        p === "<root>" ||
        p === "<root>." ||
        p === "$" ||
        p === "/" ||
        p === ".";

      requestAnimationFrame(() => {
        const el = isRoot
          ? (document.querySelector(
              `[data-pin-scope="diff"]`,
            ) as HTMLElement | null)
          : (document.querySelector(selectorForPath(p)) as HTMLElement | null);

        flash(el);
      });
    },
    [flash],
  );

  // load on key change
  React.useEffect(() => {
    let cancelled = false;

    setHydrated(false);

    (async () => {
      const loaded = await storage.load(args.compareSessionKey);
      if (cancelled) return;

      if (loaded) {
        dispatch({
          type: "PIN_BULK_SET",
          pins: Object.values(loaded.pinsById),
        });
      } else {
        dispatch({ type: "PIN_CLEAR_ALL" });
      }

      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [args.compareSessionKey, storage]);

  // persist (debounced) — solo después de hydrated
  const persistTimer = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!hydrated) return;

    if (persistTimer.current) window.clearTimeout(persistTimer.current);

    persistTimer.current = window.setTimeout(() => {
      const snapshot: PinnedStateV1 = {
        version: 1,
        compareSessionKey: args.compareSessionKey,
        pinsById: state.pinsById,
      };

      storage.save(snapshot).catch(() => {});
    }, 250);

    return () => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
    };
  }, [hydrated, state.pinsById, args.compareSessionKey, storage]);

  const pins = React.useMemo(() => pinnedList(state), [state]);
  const count = React.useMemo(() => pinnedCount(state), [state]);

  function togglePin(input: { path: string; tone: DiffTone; label?: string }) {
    const path = (input.path ?? "").trim();
    if (!path) return;

    const now = Date.now();
    const rowId = makeRowId(path, input.tone);
    const existing = state.pinsById[rowId];

    const pin: Pin = existing
      ? {
          ...existing,
          label: input.label ?? existing.label,
          updatedAtMs: toUnixMs(now),
        }
      : {
          rowId,
          pointer: path as unknown as Pin["pointer"],
          tone: input.tone,
          label: input.label,
          createdAtMs: toUnixMs(now),
          updatedAtMs: toUnixMs(now),
        };

    dispatch({ type: "PIN_TOGGLE", pin });

    // WOW #11 — flash feedback (path-level)
    flashByPath(path);
  }

  function unpin(rowId: CompareRowId) {
    // derive path from rowId: "tone:path"
    const raw = String(rowId);
    const idx = raw.indexOf(":");
    const path = idx >= 0 ? raw.slice(idx + 1) : raw;

    dispatch({ type: "PIN_REMOVE", rowId });

    // flash the row even on unpin (subtle but satisfying)
    flashByPath(path);
  }

  function clearAll() {
    dispatch({ type: "PIN_CLEAR_ALL" });
    storage.clear(args.compareSessionKey).catch(() => {});

    // Optional: if you later add a container like data-pin-scope="compare",
    // we can flash the container instead of individual rows.
    requestAnimationFrame(() => {
      const el = document.querySelector(
        `[data-pin-scope="compare"]`,
      ) as HTMLElement | null;
      flash(el);
    });
  }

  function exportJson() {
    const now = Date.now();

    const snap = buildPinnedSnapshotV1({
      nowMs: now,
      compareSessionKey: args.compareSessionKey,
      prevOutputId: args.prevOutputId,
      nextOutputId: args.nextOutputId,
      pins,
    });

    const name = `compare-pins_${args.prevOutputId}__${args.nextOutputId}_${filenameStamp(
      now,
    )}.json`;

    downloadTextFile(name, "application/json", JSON.stringify(snap, null, 2));
  }

  function exportCsv() {
    const now = Date.now();

    const csv = pinsToCsv({
      prevOutputId: args.prevOutputId,
      nextOutputId: args.nextOutputId,
      pins,
    });

    const name = `compare-pins_${args.prevOutputId}__${args.nextOutputId}_${filenameStamp(
      now,
    )}.csv`;

    downloadTextFile(name, "text/csv;charset=utf-8", csv);
  }

  /**
   * Import pins from a JSON text (exported snapshot).
   * - Validates schema
   * - Protects against wrong compare session (prev/next mismatch)
   * - Merges by rowId, latest updatedAt wins
   */
  function importPinsJsonText(jsonText: string): {
    imported: number;
    total: number;
  } {
    setLastImportError(null);

    const parsed = parsePinnedSnapshotV1(jsonText);

    // Strict safety: must match the current compare pair.
    // This prevents accidental "cross-compare contamination".
    if (
      parsed.meta.prevOutputId !== args.prevOutputId ||
      parsed.meta.nextOutputId !== args.nextOutputId
    ) {
      const msg =
        "Import failed: this pins file belongs to a different compare pair.\n" +
        `Expected prev/next: ${args.prevOutputId} / ${args.nextOutputId}\n` +
        `Got prev/next: ${parsed.meta.prevOutputId} / ${parsed.meta.nextOutputId}`;
      setLastImportError(msg);
      throw new Error(msg);
    }

    const mergedById = mergePinsLatestWins(pinsByIdRef.current, parsed.pins);
    const mergedPins = Object.values(mergedById);

    dispatch({ type: "PIN_BULK_SET", pins: mergedPins });

    // Optional: you could flash multiple pins, but keep it premium (avoid strobe).
    // If you want: flashByPath(parsed.pins[0]?.pointer as string)

    return { imported: parsed.pins.length, total: mergedPins.length };
  }

  return {
    state,
    pins,
    count,
    hydrated, // ✅ extra: útil para UI (no rompe nada)
    lastImportError,

    isPinned: (rowId: CompareRowId) => isPinned(state, rowId),
    makeRowId,

    togglePin,
    unpin,
    clearAll,

    exportJson,
    exportCsv,

    importPinsJsonText,

    // WOW #11 — expose for other UX actions (pin packs, recommended pins, focus)
    flashByPath,
  };
}
