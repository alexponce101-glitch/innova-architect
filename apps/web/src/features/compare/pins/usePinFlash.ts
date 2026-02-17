export function usePinFlash() {
  function flash(el: HTMLElement | null) {
    if (!el) return;
    el.classList.remove("pin-flash");
    // reflow para re-disparar la animación incluso si se pinnea rápido
    void el.offsetWidth;
    el.classList.add("pin-flash");
  }

  return { flash };
}
