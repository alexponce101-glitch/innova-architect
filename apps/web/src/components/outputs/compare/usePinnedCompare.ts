"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type PinnedRow = {
  path: string;
  type: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
};

export type PinnedExport = {
  schemaVersion: "pinned-diff@1.0";
  createdAt: string;
  baseOutputId: string;
  currentOutputId: string;
  mode: "parentDiff" | "recomputed";
  pinnedCount: number;
  pinned: Array<{
    path: string;
    type: "added" | "removed" | "changed";
    before?: unknown;
    after?: unknown;
  }>;
};

function safeJsonStringify(x: unknown) {
  try {
    return JSON.stringify(x);
  } catch {
    return '"[unserializable]"';
  }
}

function csvEscape(v: unknown) {
  if (v === null || v === undefined) return "";
  const s =
    typeof v === "string"
      ? v
      : typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : safeJsonStringify(v);

  // CSV escape: wrap in quotes if contains comma/quote/newline
  const needs = /[,"\r\n]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needs ? `"${escaped}"` : escaped;
}

function storageKey(baseId: string, curId: string, mode: string) {
  return `innova:pins:${mode}:${baseId}:${curId}`;
}

export function usePinnedCompare(opts: {
  baseOutputId: string;
  currentOutputId: string;
  mode: "parentDiff" | "recomputed";
}) {
  const { baseOutputId, currentOutputId, mode } = opts;

  const [pinnedPaths, setPinnedPaths] = useState<string[]>([]);

  // load pins when base/current/mode changes
  useEffect(() => {
    if (!baseOutputId || !currentOutputId) {
      setPinnedPaths([]);
      return;
    }
    const key = storageKey(baseOutputId, currentOutputId, mode);
    const raw =
      typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    if (!raw) {
      setPinnedPaths([]);
      return;
    }
    try {
      const arr = JSON.parse(raw);
      setPinnedPaths(
        Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [],
      );
    } catch {
      setPinnedPaths([]);
    }
  }, [baseOutputId, currentOutputId, mode]);

  const persist = useCallback(
    (next: string[]) => {
      setPinnedPaths(next);
      if (!baseOutputId || !currentOutputId) return;
      const key = storageKey(baseOutputId, currentOutputId, mode);
      window.localStorage.setItem(key, JSON.stringify(next));
    },
    [baseOutputId, currentOutputId, mode],
  );

  const isPinned = useCallback(
    (path: string) => pinnedPaths.includes(path),
    [pinnedPaths],
  );

  const pin = useCallback(
    (path: string) => {
      if (!path) return;
      if (pinnedPaths.includes(path)) return;
      persist([path, ...pinnedPaths]);
    },
    [pinnedPaths, persist],
  );

  const unpin = useCallback(
    (path: string) => {
      if (!path) return;
      persist(pinnedPaths.filter((p) => p !== path));
    },
    [pinnedPaths, persist],
  );

  const togglePin = useCallback(
    (path: string) => {
      if (!path) return;
      if (pinnedPaths.includes(path)) unpin(path);
      else pin(path);
    },
    [pinnedPaths, pin, unpin],
  );

  const clearPins = useCallback(() => persist([]), [persist]);

  const pinnedCount = pinnedPaths.length;

  // Build export payload from current diff rows
  const buildPinnedRows = useCallback(
    (rows: PinnedRow[]): PinnedRow[] => {
      if (!pinnedPaths.length) return [];
      const map = new Map(rows.map((r) => [r.path, r]));
      return pinnedPaths.map((p) => map.get(p)).filter(Boolean) as PinnedRow[];
    },
    [pinnedPaths],
  );

  const exportPinnedJson = useCallback(
    (rows: PinnedRow[]): PinnedExport => {
      const pinned = buildPinnedRows(rows).map((r) => ({
        path: r.path,
        type: r.type,
        before: r.before,
        after: r.after,
      }));
      return {
        schemaVersion: "pinned-diff@1.0",
        createdAt: new Date().toISOString(),
        baseOutputId,
        currentOutputId,
        mode,
        pinnedCount: pinned.length,
        pinned,
      };
    },
    [baseOutputId, currentOutputId, mode, buildPinnedRows],
  );

  const exportPinnedCsv = useCallback(
    (rows: PinnedRow[]) => {
      const pinned = buildPinnedRows(rows);
      const header = "path,type,before,after";
      const lines = pinned.map((r) => {
        return [
          csvEscape(r.path),
          csvEscape(r.type),
          csvEscape(r.before),
          csvEscape(r.after),
        ].join(",");
      });
      return [header, ...lines].join("\n");
    },
    [buildPinnedRows],
  );

  const exportAllPins = useMemo(
    () => ({
      pinnedPaths,
      pinnedCount,
      isPinned,
      pin,
      unpin,
      togglePin,
      clearPins,
      exportPinnedJson,
      exportPinnedCsv,
    }),
    [
      pinnedPaths,
      pinnedCount,
      isPinned,
      pin,
      unpin,
      togglePin,
      clearPins,
      exportPinnedJson,
      exportPinnedCsv,
    ],
  );

  return exportAllPins;
}
