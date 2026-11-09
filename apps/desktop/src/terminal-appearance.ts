import type { ITheme } from "@xterm/xterm";
import { terminalThemes, type ColorTheme } from "./theme.ts";
export type TerminalAppearance = { colorTheme: string; background: string; foreground: string };
export const defaultTerminalAppearance: TerminalAppearance = { colorTheme: "", background: "", foreground: "" };
export function resolveTerminalTheme(mode: ColorTheme, appearance: TerminalAppearance): ITheme {
  // Ignore saved terminal presets from older versions: the workspace theme is shared.
  const base = terminalThemes[mode];
  const background = appearance.background || base.background!;
  const foreground = appearance.foreground || base.foreground;
  return { ...base, background, foreground, cursor: foreground, cursorAccent: background };
}
export function terminalSurface(mode: ColorTheme, appearance: TerminalAppearance): string {
  const background = resolveTerminalTheme(mode, appearance).background!;
  return background;
}
