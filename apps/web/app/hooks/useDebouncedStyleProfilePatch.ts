"use client";

import { useEffect, useRef, useState } from "react";

type SaveState = "idle" | "saving" | "error";

export function useDebouncedStyleProfilePatch(opts: {
  enabled: boolean;
  url: string | null;
  body: any;
  debounceMs?: number;
  onSuccess?: () => Promise<void> | void;
  debug?: boolean;
}) {
  const { enabled, url, body, debounceMs = 600, onSuccess, debug } = opts;

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const inFlightAbortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!url) return;

    if (timerRef.current) window.clearTimeout(timerRef.current);

    timerRef.current = window.setTimeout(async () => {
      try {
        setSaveState("saving");
        setSaveError(null);

        if (inFlightAbortRef.current) inFlightAbortRef.current.abort();
        const ac = new AbortController();
        inFlightAbortRef.current = ac;

        if (debug) console.log("AUTO PATCH body =>", body);

        const res = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify(body),
        });

        const json = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(`PARCHE: ${res.status} ${json?.error ?? ""}`.trim());
        }

        setSaveState("idle");
        setLastSavedAt(new Date().toLocaleTimeString());

        if (onSuccess) await onSuccess();
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setSaveState("error");
        setSaveError(e?.message ?? "No se pudo guardar");
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [enabled, url, debounceMs, debug, JSON.stringify(body)]);

  return { saveState, lastSavedAt, saveError };
}
