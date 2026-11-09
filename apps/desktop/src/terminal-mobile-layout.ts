// Keep the PTY width stable across phone rotation and keyboard visibility.
export const ANDROID_TERMINAL_COLUMNS = 120;

export function fitAndroidTerminal(
  terminal: { resize: (cols: number, rows: number) => void },
  fit: { proposeDimensions: () => { cols: number; rows: number } | undefined },
): boolean {
  const size = fit.proposeDimensions();
  if (!size || !Number.isFinite(size.rows) || size.rows < 1) return false;
  terminal.resize(ANDROID_TERMINAL_COLUMNS, size.rows);
  return true;
}

/** xterm consumes touch moves for scrollback. Capture only horizontal swipes. */
export function attachTerminalHorizontalPan(viewport: HTMLElement, enabled: () => boolean) {
  let drag: { x: number; y: number; left: number; axis: "x" | "y" | null } | null = null;
  const reset = () => { drag = null; };
  const start = (event: TouchEvent) => {
    if (!enabled() || event.touches.length !== 1) { reset(); return; }
    const touch = event.touches[0];
    drag = { x: touch.clientX, y: touch.clientY, left: viewport.scrollLeft, axis: null };
  };
  const move = (event: TouchEvent) => {
    if (!drag || !enabled() || event.touches.length !== 1) { reset(); return; }
    const dx = drag.x - event.touches[0].clientX;
    const dy = drag.y - event.touches[0].clientY;
    if (!drag.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 8) {
      drag.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (drag.axis !== "x") return;
    event.preventDefault();
    event.stopPropagation();
    viewport.scrollLeft = drag.left + dx;
  };
  viewport.addEventListener("touchstart", start, { capture: true, passive: true });
  viewport.addEventListener("touchmove", move, { capture: true, passive: false });
  viewport.addEventListener("touchend", reset, true);
  viewport.addEventListener("touchcancel", reset, true);
  return () => {
    reset();
    viewport.removeEventListener("touchstart", start, { capture: true });
    viewport.removeEventListener("touchmove", move, { capture: true });
    viewport.removeEventListener("touchend", reset, { capture: true });
    viewport.removeEventListener("touchcancel", reset, { capture: true });
  };
}
