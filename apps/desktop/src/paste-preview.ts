import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, crosshairCursor, drawSelection, dropCursor, highlightActiveLine, keymap, lineNumbers, rectangularSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { readClipboardText } from "./clipboard-access";
import { isMultilineTerminalPaste } from "./terminal-paste";
import { replacePreviewSelection } from "./paste-preview-model";
let pending = false;
const MAX_PREVIEW_BYTES = 1024 * 1024 - 32;
type PreviewOptions = { target: string; count: number; warnMultiline: boolean; stillAllowed: () => boolean };

/** The only commit action is the Paste button. Editing never writes to a terminal. */
export function previewTerminalPaste(initialText: string, options: PreviewOptions): Promise<string | null> {
  if (pending || document.documentElement.dataset.workspaceLocked === "true" || !options.stillAllowed()) return Promise.resolve(null);
  if (new TextEncoder().encode(initialText).byteLength > MAX_PREVIEW_BYTES) return Promise.reject(new Error("Paste exceeds the 1 MiB terminal input limit."));
  pending = true;
  return new Promise(resolve => {
    const previousFocus = document.activeElement;
    const dialog = document.createElement("dialog");
    dialog.className = "paste-preview-dialog";
    dialog.setAttribute("aria-label", "Paste preview");
    // This markup is fixed. Clipboard text goes only into the editor document.
    dialog.innerHTML = '<header class="paste-preview-heading"><div><h2>Paste preview</h2><p class="paste-preview-target"></p></div><button type="button" data-action="cancel" class="icon-button" aria-label="Close paste preview">×</button></header><div class="paste-preview-toolbar" role="toolbar" aria-label="Preview editing tools"><button type="button" data-action="undo" title="Undo (Ctrl+Z)">Undo</button><button type="button" data-action="redo" title="Redo (Ctrl+Y)">Redo</button><span></span><button type="button" data-action="columns" aria-pressed="false" title="Select a vertical block with a mouse drag">Column selection</button><button type="button" data-action="find" title="Find and replace (Ctrl+F)">Find / replace</button><button type="button" data-action="clipboard">Paste clipboard</button><button type="button" data-action="reset">Restore original</button><label><input type="checkbox" data-action="wrap" /> Wrap</label></div><div class="paste-preview-editor" role="region" aria-label="Editable paste text"></div><div class="paste-preview-status" aria-live="polite"></div><div class="paste-preview-feedback" role="status"></div><footer class="paste-preview-footer"><span>Alt+drag: column selection · Ctrl+Alt+↑/↓: add cursors</span><div><button type="button" data-action="cancel" class="outline-button">Cancel</button><button type="button" data-action="send" class="primary-button">Paste to terminal</button></div></footer>';
    const target = dialog.querySelector<HTMLElement>(".paste-preview-target")!;
    target.textContent = options.count > 1 ? `${options.target} · Broadcast to ${options.count} terminals` : options.target;
    const editorHost = dialog.querySelector<HTMLElement>(".paste-preview-editor")!;
    const status = dialog.querySelector<HTMLElement>(".paste-preview-status")!;
    const feedback = dialog.querySelector<HTMLElement>(".paste-preview-feedback")!;
    const send = dialog.querySelector<HTMLButtonElement>('[data-action="send"]')!;
    const undoButton = dialog.querySelector<HTMLButtonElement>('[data-action="undo"]')!;
    const redoButton = dialog.querySelector<HTMLButtonElement>('[data-action="redo"]')!;
    let editor: EditorView | undefined;
    let settled = false, columns = false, clipboardBusy = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const wrap = new Compartment();
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true; pending = false;
      if (timer !== undefined) clearInterval(timer);
      window.removeEventListener("conxol:workspace-locked", cancel);
      window.removeEventListener("pagehide", cancel);
      editor?.destroy(); editor = undefined;
      if (dialog.open) dialog.close();
      dialog.remove();
      if (document.documentElement.dataset.workspaceLocked !== "true" && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      resolve(value);
    };
    const cancel = () => finish(null);
    const update = (view: EditorView) => {
      const text = view.state.doc.toString();
      const bytes = new TextEncoder().encode(text).byteLength;
      const main = view.state.selection.main;
      const line = view.state.doc.lineAt(main.head);
      status.textContent = `${view.state.doc.lines.toLocaleString()} lines · ${text.length.toLocaleString()} characters · Ln ${line.number}, Col ${main.head - line.from + 1} · ${view.state.selection.ranges.length} selection${view.state.selection.ranges.length === 1 ? "" : "s"}`;
      undoButton.disabled = undoDepth(view.state) === 0;
      redoButton.disabled = redoDepth(view.state) === 0;
      send.disabled = !text || bytes > MAX_PREVIEW_BYTES;
      feedback.textContent = bytes > MAX_PREVIEW_BYTES ? "Text exceeds the 1 MiB terminal input limit." : options.warnMultiline && isMultilineTerminalPaste(text) ? "This text contains line breaks. Pasting it may execute commands." : "";
    };
    dialog.querySelectorAll<HTMLButtonElement>('[data-action="cancel"]').forEach(button => button.addEventListener("click", cancel));
    dialog.addEventListener("cancel", event => { event.preventDefault(); cancel(); });
    dialog.addEventListener("close", cancel);
    dialog.addEventListener("keydown", event => { if (event.key !== "Escape") event.stopPropagation(); });
    dialog.querySelector('[data-action="undo"]')!.addEventListener("click", () => { if (editor) { undo(editor); editor.focus(); } });
    dialog.querySelector('[data-action="redo"]')!.addEventListener("click", () => { if (editor) { redo(editor); editor.focus(); } });
    dialog.querySelector<HTMLButtonElement>('[data-action="columns"]')!.addEventListener("click", event => {
      columns = !columns;
      (event.currentTarget as HTMLElement).setAttribute("aria-pressed", String(columns));
      dialog.classList.toggle("paste-column-mode", columns); editor?.focus();
    });
    dialog.querySelector('[data-action="find"]')!.addEventListener("click", () => { if (editor) openSearchPanel(editor); });
    dialog.querySelector('[data-action="reset"]')!.addEventListener("click", () => { if (editor) { editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: initialText } }); editor.focus(); } });
    dialog.querySelector<HTMLInputElement>('[data-action="wrap"]')!.addEventListener("change", event => editor?.dispatch({ effects: wrap.reconfigure((event.target as HTMLInputElement).checked ? EditorView.lineWrapping : []) }));
    dialog.querySelector<HTMLButtonElement>('[data-action="clipboard"]')!.addEventListener("click", async () => {
      if (clipboardBusy || !editor) return;
      clipboardBusy = true;
      try {
        const text = await readClipboardText();
        if (!settled && editor && options.stillAllowed() && document.documentElement.dataset.workspaceLocked !== "true") {
          if (new TextEncoder().encode(text).byteLength > MAX_PREVIEW_BYTES) throw new Error("Clipboard text exceeds the 1 MiB limit.");
          editor.dispatch(replacePreviewSelection(editor.state, text)); editor.focus();
        }
      } catch { if (!settled) feedback.textContent = "Clipboard text could not be inserted. Try Ctrl+V inside the editor."; }
      finally { clipboardBusy = false; }
    });
    send.addEventListener("click", () => {
      if (!editor || !options.stillAllowed() || document.documentElement.dataset.workspaceLocked === "true") { cancel(); return; }
      const text = editor.state.doc.toString();
      if (!text || new TextEncoder().encode(text).byteLength > MAX_PREVIEW_BYTES) return;
      finish(text);
    });
    window.addEventListener("conxol:workspace-locked", cancel);
    window.addEventListener("pagehide", cancel);
    try {
      document.body.append(dialog); dialog.showModal();
      editor = new EditorView({ parent: editorHost, state: EditorState.create({ doc: initialText, extensions: [
        EditorState.allowMultipleSelections.of(true), EditorState.tabSize.of(4),
        lineNumbers(), drawSelection(), dropCursor(), highlightActiveLine(), history(),
        rectangularSelection({ eventFilter: event => event.button === 0 && (columns || event.altKey) }), crosshairCursor(),
        search({ top: true }), highlightSelectionMatches(), wrap.of([]),
        keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.contentAttributes.of({ "aria-label": "Paste preview editor", spellcheck: "false" }),
        EditorView.updateListener.of(change => { if (change.docChanged || change.selectionSet) update(change.view); }),
        EditorView.theme({ "&": { height: "100%", fontSize: "12px", color: "var(--text)" }, ".cm-scroller": { overflow: "auto", fontFamily: '"JetBrains Mono", Consolas, monospace', lineHeight: "1.6" }, ".cm-content": { padding: "10px 0", caretColor: "var(--text)" }, ".cm-gutters": { backgroundColor: "var(--panel)", color: "var(--muted)", borderRight: "1px solid var(--line)" }, "&.cm-focused": { outline: "none" }, ".cm-activeLine": { backgroundColor: "var(--mint-soft)" }, ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" }, "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, & > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "var(--paste-selection)" }, ".cm-panel": { backgroundColor: "var(--panel)", color: "var(--text)" }, ".cm-searchMatch": { backgroundColor: "var(--amber-soft)", outline: "1px solid var(--amber)" } }, { dark: document.documentElement.dataset.theme !== "light" }),
      ] }) });
      update(editor); editor.focus(); editor.requestMeasure();
      timer = setInterval(() => { if (!options.stillAllowed() || document.documentElement.dataset.workspaceLocked === "true") cancel(); }, 250);
    } catch { cancel(); }
  });
}
