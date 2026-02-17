"use client";

import * as React from "react";
import type { SmartPreset } from "../../../src/server/ai-outputs/compare/presets/types";

export function SmartPresetsPanel(props: {
  presets: SmartPreset[];
  onApplyPreset: (preset: SmartPreset, opts: { startTour: boolean }) => void;
}) {
  const { presets, onApplyPreset } = props;

  if (!presets.length) return null;

  return (
    <div className="rounded-xl border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Presets</div>
        <div className="text-xs text-muted-foreground">Auto (engine)</div>
      </div>

      <div className="space-y-2">
        {presets.map((p) => {
          const confPct = Math.round((p.confidence ?? 0) * 100);

          return (
            <div key={p.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{p.icon}</span>
                  <div className="font-medium">{p.label}</div>
                  <span className="text-xs rounded-full border px-2 py-0.5">
                    🧠 Auto
                  </span>
                </div>

                <span className="text-xs text-muted-foreground">
                  Confidence: {confPct}%
                </span>
              </div>

              {!!p.why?.length && (
                <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                  {p.why.slice(0, 4).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
                  onClick={() => onApplyPreset(p, { startTour: false })}
                >
                  Apply
                </button>
                <button
                  className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
                  onClick={() => onApplyPreset(p, { startTour: true })}
                >
                  Apply + Tour
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
