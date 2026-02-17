// apps/web/app/outputs/compare/AutoPinsCard.tsx

"use client";

import * as React from "react";
import type { ExplainableAutoPinsResult } from "../../../src/server/ai-outputs/compare/autoPinsTypes";
import type {
  CompareRowId,
  DiffTone,
} from "../../../src/features/compare/pins/types";

type TogglePinInput = { path: string; tone: DiffTone; label?: string };

type Props = {
  autoPins: ExplainableAutoPinsResult;

  // from usePinnedCompare()
  isPinned: (rowId: CompareRowId) => boolean;
  makeRowId: (path: string, tone: DiffTone) => CompareRowId;
  togglePin: (input: TogglePinInput) => void;
  excludePaths?: Set<string>;
  normalizePath?: (p: string) => string;
};

// UX mínimo: para auto-pins usamos un tone estable
const AUTO_TONE: DiffTone = "mixed" as DiffTone;

export default function AutoPinsCard(props: Props) {
  const { autoPins, isPinned, makeRowId, togglePin } = props;

  const exclude = props.excludePaths ?? new Set<string>();
  const norm = props.normalizePath ?? ((p: string) => p);

  const items = autoPins.pins
    .map((p) => {
      const pathN = norm(p.path);
      return { p, pathN };
    })
    .filter(({ pathN }) => !exclude.has(pathN))
    .map(({ p, pathN }) => {
      const rowId = makeRowId(pathN, AUTO_TONE);
      const alreadyPinned = isPinned(rowId);
      return { p, rowId, alreadyPinned, pathN };
    });

  const toPin = items.filter((x) => !x.alreadyPinned);

  function pinRecommended() {
    for (const x of toPin) {
      togglePin({ path: x.pathN, tone: AUTO_TONE, label: x.p.label });
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Auto-Pins (Recommended)</div>
          <div className="text-xs text-neutral-600">
            Explainable recommendations ({autoPins.pins.length})
          </div>
        </div>

        <button
          type="button"
          className="rounded-lg border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
          onClick={pinRecommended}
          disabled={toPin.length === 0}
          title={
            toPin.length === 0
              ? "All recommended pins are already pinned"
              : "Pin all recommended"
          }
        >
          ✨ Pin Recommended ({toPin.length})
        </button>
      </div>

      {!autoPins.pins.length ? (
        <div className="mt-2 text-xs text-neutral-600">
          No recommendations yet.
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {items.map(({ p, alreadyPinned }) => (
            <div
              key={p.key}
              className="rounded-lg border border-neutral-200 p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{p.label}</div>
                <div className="text-[11px] text-neutral-600">
                  {alreadyPinned ? "Pinned" : p.confidence.toUpperCase()}
                </div>
              </div>

              <div className="mt-1 text-xs text-neutral-700">{p.reason}</div>
              <div className="mt-1 text-[11px] text-neutral-500">
                Evidence: {p.evidenceCount}
              </div>

              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                  onClick={() =>
                    togglePin({
                      path: norm(p.path),
                      tone: AUTO_TONE,
                      label: p.label,
                    })
                  }
                  disabled={alreadyPinned}
                  title={
                    alreadyPinned ? "Already pinned" : "Pin this recommendation"
                  }
                >
                  Pin
                </button>

                <details className="text-xs">
                  <summary className="cursor-pointer text-neutral-600 hover:text-neutral-800">
                    Explain
                  </summary>
                  <div className="mt-2 space-y-1">
                    {p.evidence.slice(0, 5).map((e, idx) => (
                      <div
                        key={idx}
                        className="font-mono text-[11px] text-neutral-700"
                      >
                        {e.path}
                      </div>
                    ))}
                    {p.evidenceCount > p.evidence.length ? (
                      <div className="text-[11px] text-neutral-500">
                        Showing {p.evidence.length} of {p.evidenceCount}
                      </div>
                    ) : null}
                  </div>
                </details>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
