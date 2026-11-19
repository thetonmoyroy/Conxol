import type { IUnicodeVersionProvider, Terminal } from "@xterm/xterm";
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
const bengali = /[\u0980-\u09ff]/u;
const bengaliRun = /^[\u0964\u0965\u0980-\u09ff\u200c\u200d]+$/u;
const bengaliFont = IS_WINDOWS_TERMINAL
  ? '"Nirmala UI", "Noto Sans Bengali", sans-serif'
  : '"Noto Sans Bengali", "Bangla Sangam MN", "Nirmala UI", sans-serif';

/** Correct Bengali combining marks missing from xterm 5.5's Unicode 6 table. */
export function configureTerminalUnicodeWidths(terminal: Terminal) {
  // xterm exposes provider registration but has no public getter for the active
  // provider. Delegate to the pinned version's provider so all other widths
  // and join rules stay intact. Fall back to the built-in table if it changes.
  const core = terminal as unknown as { _core?: { unicodeService?: { _activeProvider?: IUnicodeVersionProvider } } };
  const base = core._core?.unicodeService?._activeProvider;
  if (base?.version !== "6" || typeof base.wcwidth !== "function" || typeof base.charProperties !== "function") return;

  // Keep the spacing cell for U+09BE (া), as used by the reference shell.
  const isBengaliCombiningMark = (codepoint: number) => codepoint === 0x09d7 || codepoint === 0x09fe;
  const version = "6-conxol";
  terminal.unicode.register({
    version,
    wcwidth: codepoint => isBengaliCombiningMark(codepoint) ? 0 : base.wcwidth(codepoint),
    // Bengali virama already uses xterm's zero-width combining behavior.
    charProperties: (codepoint, preceding) => base.charProperties(isBengaliCombiningMark(codepoint) ? 0x09cd : codepoint, preceding),
  });
  terminal.unicode.activeVersion = version;
}

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

/** Fit shaped Bangla glyphs without xterm's per-character letter spacing. */
export function attachTerminalBengaliLayout(terminal: Terminal) {
  const rows = terminal.element?.querySelector<HTMLElement>(".xterm-rows");
  const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
  if (!rows || !screen) return () => {};

  const observer = new MutationObserver(records => {
    const changed = new Set(records.map(record => record.target).filter(target => target.parentNode === rows));
    if (!changed.size) return;
    const cellWidth = Number.parseFloat(screen.style.width) / terminal.cols;
    if (!(cellWidth > 0)) return;
    const buffer = terminal.buffer.active;
    for (const [index, row] of Array.from(rows.children).entries()) {
      if (!changed.has(row) || !bengali.test(row.textContent ?? "")) continue;
      const line = buffer.getLine(buffer.viewportY + index);
      if (!line) continue;

      // Match rendered text boundaries to buffer columns, including wide and
      // combined cells. A stale render can be skipped until the next repaint.
      const columns = new Map<number, number>([[0, 0]]);
      let offset = 0;
      for (let col = 0; col < line.length;) {
        const cell = line.getCell(col);
        const width = cell?.getWidth() || 1;
        offset += cell?.getChars().length || 1;
        col += width;
        columns.set(offset, col);
      }
      const rendered = (row.textContent ?? "").replaceAll("\u00a0", " ");
      if (rendered !== line.translateToString(false).slice(0, rendered.length).replaceAll("\u00a0", " ")) continue;

      offset = 0;
      const spans = Array.from(row.children).filter((span): span is HTMLElement => span instanceof HTMLElement);
      for (let i = 0; i < spans.length; i++) {
        const span = spans[i];
        const text = span.textContent ?? "";
        const start = columns.get(offset);
        offset += text.length;
        let end = columns.get(offset);
        if (span.firstElementChild || !bengaliRun.test(text) || start === undefined || end === undefined) continue;
        let run = text;
        // Keep cursor and selection styling on their original cell spans.
        // Within a run, let the font determine spacing and leave spare cell
        // width at the end of the word instead of between syllables.
        const style = span.style.cssText.replace(/letter-spacing:[^;]+;\s*/g, "");
        while (!span.classList.contains("xterm-cursor") && i + 1 < spans.length) {
          const next = spans[i + 1];
          const nextText = next.textContent ?? "";
          const nextEnd = columns.get(offset + nextText.length);
          if (next.firstElementChild || !bengaliRun.test(nextText) || next.className !== span.className || nextEnd === undefined ||
              next.style.cssText.replace(/letter-spacing:[^;]+;\s*/g, "") !== style) break;
          run += nextText;
          offset += nextText.length;
          end = nextEnd;
          next.remove();
          i++;
        }
        const width = (end - start) * cellWidth;
        const glyphs = document.createElement("bdi");
        glyphs.dir = "ltr";
        glyphs.lang = "bn";
        glyphs.style.fontFamily = bengaliFont;
        glyphs.style.fontSize = ".80em";
        glyphs.style.fontKerning = "normal";
        glyphs.textContent = run;
        span.style.letterSpacing = "normal";
        span.style.width = `${width}px`;
        span.replaceChildren(glyphs);
      }
    }
  });
  observer.observe(rows, { childList: true, subtree: true });
  return () => observer.disconnect();
}
