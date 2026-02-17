"use client";

import {
  STYLE_SIGNAL_META,
  type StyleSignalKey,
} from "../../../../../packages/shared/src/validators/style/signals";

type Props = {
  signal: StyleSignalKey;
  value: number;
  onChange: (v: number) => void;

  // UI signals
  saveState?: "idle" | "saving" | "error";
  lastSavedAt?: string | null;
  saveError?: string | null;

  debug?: boolean;
};

export default function StyleSignalSlider({
  signal,
  value,
  onChange,
  saveState = "idle",
  lastSavedAt = null,
  saveError = null,
  debug = false,
}: Props) {
  const meta = STYLE_SIGNAL_META[signal] ?? {
    label: String(signal),
    min: 0,
    max: 1,
    step: 0.05,
  };

  return (
    <div>
      <div style={{ fontSize: 13, opacity: 0.8 }}>
        {meta.label}: {value.toFixed(2)}
      </div>

      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>
        {saveState === "saving" ? "Guardando…" : null}
        {saveState === "idle" && lastSavedAt
          ? `Guardado: ${lastSavedAt}`
          : null}
        {saveState === "error" ? "Error al guardar" : null}
      </div>

      {saveError ? (
        <div
          style={{
            fontSize: 12,
            opacity: 0.9,
            color: "crimson",
            marginBottom: 6,
          }}
        >
          {saveError}
        </div>
      ) : null}

      <input
        type="range"
        min={meta.min}
        max={meta.max}
        step={meta.step}
        value={value}
        onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
        style={{ width: "100%" }}
      />

      {debug ? (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
          debug({signal})={String(value)}
        </div>
      ) : null}
    </div>
  );
}
