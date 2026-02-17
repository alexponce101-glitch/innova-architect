// apps/web/src/lib/ui/pulseFocus.ts
export function pulseFocus(el: HTMLElement | null) {
  if (!el) return;

  // reset
  el.classList.remove("ia-focus-pulse");
  // force reflow (re-trigger animation)
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  el.offsetWidth;
  // apply
  el.classList.add("ia-focus-pulse");

  // limpieza opcional (no necesaria, pero deja DOM limpio)
  window.setTimeout(() => {
    el.classList.remove("ia-focus-pulse");
  }, 220);
}
