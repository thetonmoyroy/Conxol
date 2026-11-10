import type { ITheme } from "@xterm/xterm";
import { themeMode, terminalThemes, terminalPresets, selectedTerminalPreset, type ColorTheme } from "./theme.ts";
export { terminalPresets, selectedTerminalPreset } from "./theme.ts";
export type TerminalAppearance = { colorTheme: string; background: string; foreground: string };
export const defaultTerminalAppearance: TerminalAppearance = { colorTheme: "", background: "", foreground: "" };
export function resolveTerminalTheme(mode: ColorTheme, appearance: TerminalAppearance): ITheme {
  // Legacy preset names retain the shared workspace theme.
  const preset = selectedTerminalPreset(mode);
  const base = preset ? terminalPresets[preset].theme : terminalThemes[themeMode(mode)];
  const background = appearance.background || base.background!;
  const foreground = appearance.foreground || base.foreground;
  return { ...base, background, foreground, cursor: foreground, cursorAccent: background };
}
export function terminalSurface(mode: ColorTheme, appearance: TerminalAppearance): string {
  const background = resolveTerminalTheme(mode, appearance).background!;
  return background;
}
