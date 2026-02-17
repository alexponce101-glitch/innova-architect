export function flashNeutral(el: HTMLElement | null) {
  if (!el) return;

  el.classList.remove("ia-neutral-flash");
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  el.offsetWidth;
  el.classList.add("ia-neutral-flash");

  window.setTimeout(() => {
    el.classList.remove("ia-neutral-flash");
  }, 200);
}
