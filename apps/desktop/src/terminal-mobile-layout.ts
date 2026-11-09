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

type TouchScroll = {
  rowHeight: () => number;
  scrollLines: (lines: number) => void;
  viewportY: () => number;
  normalBuffer: () => boolean;
};

/** Lock the gesture axis; batch vertical movement and continue a fling after release. */
export function attachTerminalTouchPan(viewport: HTMLElement, enabled: () => boolean, vertical?: TouchScroll) {
  let drag: { x: number; y: number; left: number; axis: "x" | "y" | null } | null = null;
  let frame: number | undefined;
  let pendingPixels = 0, velocity = 0, lastY = 0, lastTime = 0, frameTime = 0, rowHeight = 1;

  const stopMotion = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    pendingPixels = 0; velocity = 0;
  };
  const reset = () => { drag = null; stopMotion(); };
  const scrollPending = () => {
    if (!vertical) return true;
    const lines = Math.trunc(pendingPixels / rowHeight);
    if (!lines) return true;
    pendingPixels -= lines * rowHeight;
    const before = vertical.viewportY();
    vertical.scrollLines(lines);
    return before !== vertical.viewportY();
  };
  const tick = (time: number) => {
    frame = undefined;
    if (!vertical || !enabled() || !vertical.normalBuffer()) { reset(); return; }
    const elapsed = Math.min(32, Math.max(0, time - frameTime));
    // Integrate exponential deceleration in milliseconds, so a 120Hz display
    // covers the same distance as 60Hz instead of slowing the fling by half.
    const decayTime = -16 / Math.log(0.94);
    const decay = Math.exp(-elapsed / decayTime);
    pendingPixels += velocity * decayTime * (1 - decay);
    velocity *= decay;
    frameTime = time;
    if (!scrollPending()) { stopMotion(); return; }
    if (Math.abs(velocity) >= 0.02) frame = requestAnimationFrame(tick);
  };
  const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(tick); };
  const start = (event: TouchEvent) => {
    if (!enabled() || event.touches.length !== 1) { reset(); return; }
    stopMotion();
    const touch = event.touches[0];
    lastY = touch.clientY; lastTime = event.timeStamp; frameTime = 0;
    rowHeight = Math.max(1, vertical?.rowHeight() ?? 1);
    drag = { x: touch.clientX, y: touch.clientY, left: viewport.scrollLeft, axis: null };
  };
  const move = (event: TouchEvent) => {
    if (!drag || !enabled() || event.touches.length !== 1) { reset(); return; }
    const dx = drag.x - event.touches[0].clientX;
    const dy = drag.y - event.touches[0].clientY;
    if (!drag.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 8) {
      drag.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (drag.axis === "y" && vertical?.normalBuffer()) {
      event.preventDefault();
      event.stopPropagation();
      const currentY = event.touches[0].clientY;
      const elapsed = Math.max(1, event.timeStamp - lastTime);
      const delta = lastY - currentY;
      pendingPixels += delta;
      velocity = Math.max(-3, Math.min(3, delta / elapsed));
      lastY = currentY; lastTime = event.timeStamp;
      // Xterm already coalesces rendering to requestAnimationFrame. Applying
      // the buffer offset here avoids queueing a second frame ahead of it.
      scrollPending();
      return;
    }
    if (drag.axis !== "x") return;
    event.preventDefault();
    event.stopPropagation();
    viewport.scrollLeft = drag.left + dx;
  };
  const end = (event: TouchEvent) => {
    if (drag?.axis === "y" && vertical && enabled() && vertical.normalBuffer()) {
      drag = null;
      // A pause before lifting is a stop, not a fling.
      if (event.timeStamp - lastTime > 80) velocity = 0;
      frameTime = performance.now();
      if (Math.abs(velocity) >= 0.02) schedule();
    } else reset();
  };
  viewport.addEventListener("touchstart", start, { capture: true, passive: true });
  viewport.addEventListener("touchmove", move, { capture: true, passive: false });
  viewport.addEventListener("touchend", end, true);
  viewport.addEventListener("touchcancel", reset, true);
  return () => {
    reset();
    viewport.removeEventListener("touchstart", start, { capture: true });
    viewport.removeEventListener("touchmove", move, { capture: true });
    viewport.removeEventListener("touchend", end, { capture: true });
    viewport.removeEventListener("touchcancel", reset, { capture: true });
  };
}
