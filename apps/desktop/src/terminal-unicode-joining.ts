import type { Terminal } from "@xterm/xterm";
import { IS_WINDOWS_TERMINAL } from "./terminal-zoom.ts";

// Keep ASCII terminal geometry; use script-capable fonts for missing glyphs.
export type TerminalFont = "default" | "original" | "slim";
export function terminalBoldWeight(font: TerminalFont): "normal" | "bold" {
  return IS_WINDOWS_TERMINAL && font !== "default" ? "normal" : "bold";
}

export function terminalFontFamily(font: TerminalFont): string {
  const original = IS_WINDOWS_TERMINAL && font !== "default" ? '"DejaVu Sans Mono"' : '"Conxol Terminal"';
  const latinFonts = IS_WINDOWS_TERMINAL && font === "slim" ? `"Conxol Mono Slim", ${original}` : original;
  return `${latinFonts}, Consolas, "SFMono-Regular", "Nirmala UI", "Noto Sans Bengali", "Noto Sans Devanagari", monospace`;
}

export function loadTerminalFont(family: string, size: number, boldWeight: Terminal["options"]["fontWeightBold"]) {
  const regular = `400 ${size}px ${family}`;
  return Promise.all([
    document.fonts.load(regular),
    boldWeight === "normal"
      ? document.fonts.load(regular, "─")
      : document.fonts.load(`700 ${size}px ${family}`),
  ]);
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const nonAscii = /[^\u0020-\u007e]/u;

/** xterm join ranges use UTF-16 offsets, not codepoint or terminal-cell offsets.
 * Shape multi-codepoint graphemes together without changing their cell widths. */
export function unicodeJoinRanges(text: string): [number, number][] {
  if (!nonAscii.test(text)) return [];
  const ranges: [number, number][] = [];
  for (const { segment, index } of segmenter.segment(text)) {
    const firstCodepointLength = segment.codePointAt(0)! > 0xffff ? 2 : 1;
    if (segment.length > firstCodepointLength) ranges.push([index, index + segment.length]);
  }
  return ranges;
}

export function attachTerminalUnicodeJoining(terminal: Pick<Terminal, "registerCharacterJoiner" | "deregisterCharacterJoiner">) {
  const id = terminal.registerCharacterJoiner(unicodeJoinRanges);
  return () => terminal.deregisterCharacterJoiner(id);
}
