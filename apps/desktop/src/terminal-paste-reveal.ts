import type { Terminal } from "@xterm/xterm";
type Target = Pick<Terminal, "scrollToBottom" | "onWriteParsed" | "onRender" | "element">;
type Clock = { frame: (callback: () => void) => number; cancelFrame: (id: number) => void; delay: (callback: () => void, ms: number) => number; cancelDelay: (id: number) => void };
const controllers = new WeakMap<Target, { reveal: () => void }>();
const browserClock: Clock = { frame: callback => window.requestAnimationFrame(callback), cancelFrame: id => window.cancelAnimationFrame(id), delay: (callback, ms) => window.setTimeout(callback, ms), cancelDelay: id => window.clearTimeout(id) };

/** Native input bypasses xterm paste: follow delayed echo through parse and paint. */
export function registerTerminalPasteReveal(terminal: Target, refit: () => void, clock: Clock = browserClock) {
  let following = false, disposed = false;
  let frame: number | null = null, expiry: number | null = null;
  const stop = () => {
    following = false;
    if (frame !== null) clock.cancelFrame(frame);
    if (expiry !== null) clock.cancelDelay(expiry);
    frame = expiry = null;
  };
  const schedule = () => {
    if (!following || disposed || frame !== null) return;
    frame = clock.frame(() => { frame = null; if (following && !disposed) terminal.scrollToBottom(); });
  };
  const controller = { reveal: () => {
    if (disposed) return;
    stop(); following = true;
    refit();
    terminal.scrollToBottom();
    schedule();
    expiry = clock.delay(stop, 5000);
  } };
  const subscriptions = [terminal.onWriteParsed(schedule), terminal.onRender(schedule)];
  const host = terminal.element;
  const manualScroll = () => stop();
  const keyScroll = (event: KeyboardEvent) => { if (["PageUp", "PageDown"].includes(event.key) || (event.shiftKey && ["Home", "End", "ArrowUp", "ArrowDown"].includes(event.key))) stop(); };
  for (const event of ["wheel", "pointerdown", "touchstart"]) host?.addEventListener(event, manualScroll, { capture: true, passive: true });
  host?.addEventListener("keydown", keyScroll, true);
  controllers.set(terminal, controller);
  return { dispose: () => {
    disposed = true; stop(); subscriptions.forEach(subscription => subscription.dispose());
    for (const event of ["wheel", "pointerdown", "touchstart"]) host?.removeEventListener(event, manualScroll, true);
    host?.removeEventListener("keydown", keyScroll, true);
    if (controllers.get(terminal) === controller) controllers.delete(terminal);
  } };
}
export function revealPastedTerminal(terminal: Target): void {
  const controller = controllers.get(terminal);
  if (controller) controller.reveal(); else terminal.scrollToBottom();
}
