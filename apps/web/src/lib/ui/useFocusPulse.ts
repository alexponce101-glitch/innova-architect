// apps/web/src/lib/ui/useFocusPulse.ts
import { useEffect } from "react";
import { pulseFocus } from "./pulseFocus";

type Options = {
  /**
   * Dado un focusKey/focusPath, regresa el elemento objetivo.
   * Ej: document.querySelector(`[data-path="${focusPath}"]`)
   */
  getEl: (focusKey: string) => HTMLElement | null;
  /**
   * Si quieres scroll elegante al target.
   */
  scrollIntoView?: boolean;
};

export function useFocusPulse(
  focusKey: string | null | undefined,
  opts: Options,
) {
  useEffect(() => {
    if (!focusKey) return;

    const el = opts.getEl(focusKey);
    if (!el) return;

    if (opts.scrollIntoView) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    pulseFocus(el);
  }, [focusKey, opts]);
}
