import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
/** Distribute matching clipboard lines across a rectangular/multi-cursor selection. */
export function replacePreviewSelection(state: EditorState, text: string): TransactionSpec {
  const lines = text.split(/\r\n?|\n/);
  if (state.selection.ranges.length < 2 || lines.length !== state.selection.ranges.length) return state.replaceSelection(text);
  let index = 0;
  return state.changeByRange(range => {
    const insert = lines[index++];
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length) };
  });
}
