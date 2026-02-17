export function flashAccent(el: HTMLElement | null) {
  if (!el) return;

  el.classList.remove("ia-accent-flash");
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  el.offsetWidth;
  el.classList.add("ia-accent-flash");

  window.setTimeout(() => {
    el.classList.remove("ia-accent-flash");
  }, 220);
}
