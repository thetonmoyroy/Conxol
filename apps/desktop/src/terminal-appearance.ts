import type { ITheme } from "@xterm/xterm";
import { terminalThemes, type ColorTheme } from "./theme";
export type TerminalAppearance = { colorTheme: string; background: string; foreground: string };
export const defaultTerminalAppearance: TerminalAppearance = { colorTheme: "", background: "", foreground: "" };
export function resolveTerminalTheme(mode: ColorTheme, appearance: TerminalAppearance): ITheme {
  const selected = appearance.colorTheme === "light" ? "light" : appearance.colorTheme === "dark" || appearance.colorTheme === "midnight" ? "dark" : mode;
  const base = terminalThemes[selected];
  const background = appearance.background || (appearance.colorTheme === "midnight" ? "#0f172a" : base.background!);
  const foreground = appearance.foreground || base.foreground;
  return { ...base, background, foreground, cursor: foreground, cursorAccent: background };
}
export function terminalSurface(mode: ColorTheme, appearance: TerminalAppearance): string {
  const background = resolveTerminalTheme(mode, appearance).background!;
  return background;
}
