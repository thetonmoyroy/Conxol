import type { Terminal } from "@xterm/xterm";

// Keep ASCII terminal geometry; use script-capable fonts for missing glyphs.
export const TERMINAL_FONT_FAMILY = '"Conxol Terminal", Consolas, "SFMono-Regular", "Nirmala UI", "Noto Sans Bengali", "Noto Sans Devanagari", monospace';

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
