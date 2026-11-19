export const TERMINAL_MIN_FONT_SIZE = 8;
export const TERMINAL_MAX_FONT_SIZE = 32;
export const IS_WINDOWS_TERMINAL = typeof navigator !== "undefined" && /^Win/i.test(navigator.platform);
export const TERMINAL_DEFAULT_FONT_SIZE = IS_WINDOWS_TERMINAL ? 14 : 13;
export const WINDOWS_TERMINAL_LINE_HEIGHT = 1.05;

export type TerminalZoomAction = "increase" | "decrease" | "reset";

export function terminalFontSizeAfterZoom(current: number, action: TerminalZoomAction): number {
  const bounded = Number.isFinite(current)
    ? Math.min(TERMINAL_MAX_FONT_SIZE, Math.max(TERMINAL_MIN_FONT_SIZE, Math.round(current)))
    : TERMINAL_DEFAULT_FONT_SIZE;
  if (action === "reset") return TERMINAL_DEFAULT_FONT_SIZE;
  const next = bounded + (action === "increase" ? 1 : -1);
  return Math.min(TERMINAL_MAX_FONT_SIZE, Math.max(TERMINAL_MIN_FONT_SIZE, next));
}
