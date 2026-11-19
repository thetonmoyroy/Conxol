import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SerializeAddon } from "@xterm/addon-serialize";
import type { Terminal } from "@xterm/xterm";
import { isWorkspaceLocked } from "./workspace-lock-state";
import { prepareTerminalPaste } from "./terminal-input";
import type { TerminalFont } from "./terminal-unicode-joining";

type Message = { type: string; data?: string; cols?: number; rows?: number };
type View = { terminal: Terminal; serializer: SerializeAddon; fit: () => unknown; input: (data: string) => void; resize: (cols: number, rows: number) => Promise<unknown> };
type Detached = { label: string; sequence: number; ready: boolean; pending: number; tail: Promise<unknown> };
const views = new Map<string, View>();
const detached = new Map<string, Detached>();
let changed = () => {};
let reportError: (error: string) => void = () => {};

export function isTerminalDetached(id: string) { return detached.has(id); }
export function detachedTerminalIds() { return new Set(detached.keys()); }

export function updateDetachedTerminalFont(id: string, font: TerminalFont) {
  void send(id, { type: "font", data: font });
}

function send(id: string, message: object) {
  const owner = detached.get(id);
  if (!owner?.label || isWorkspaceLocked()) return Promise.resolve();
  const bytes = JSON.stringify(message).length;
  if (bytes > 16 * 1024 * 1024 || owner.pending + bytes > 20 * 1024 * 1024) {
    void returnTerminal(id);
    reportError("Detached display could not keep up. The session has returned to the main window.");
    return Promise.resolve();
  }
  owner.pending += bytes;
  const task = owner.tail.then(() => {
    if (detached.get(id) !== owner || isWorkspaceLocked()) return;
    return invoke("terminal_window_message", { target: owner.label, message });
  }).catch(() => {
    owner.ready = false;
    if (!isWorkspaceLocked() && detached.get(id) === owner) {
      reportError("Detached display lost synchronization. Returning the session to the main window.");
      void returnTerminal(id);
    }
  }).finally(() => { owner.pending -= bytes; });
  owner.tail = task;
  return task;
}

function snapshot(id: string) {
  const view = views.get(id), owner = detached.get(id);
  if (!view || !owner || isWorkspaceLocked()) return;
  owner.ready = false;
  const sequence = owner.sequence;
  // This write barrier snapshots only output parsed up to this sequence. Output
  // arriving afterward carries a greater sequence and is buffered by the view.
  view.terminal.write("", () => {
    if (views.get(id) !== view || detached.get(id) !== owner || isWorkspaceLocked()) return;
    let data: string;
    try { data = view.serializer.serialize(); } catch {
      reportError("Could not copy the terminal display. The session has returned to the main window.");
      void returnTerminal(id);
      return;
    }
    void send(id, { type: "snapshot", sequence, data, cols: view.terminal.cols, rows: view.terminal.rows, options: {
      fontSize: view.terminal.options.fontSize, fontFamily: view.terminal.options.fontFamily,
      fontWeightBold: view.terminal.options.fontWeightBold,
      theme: view.terminal.options.theme, cursorBlink: view.terminal.options.cursorBlink,
      scrollback: view.terminal.options.scrollback, convertEol: view.terminal.options.convertEol,
    } });
    owner.ready = true;
  });
}

export function registerTerminalWindowSource(id: string, terminal: Terminal, fit: () => unknown,
  input: (data: string) => void, resize: View["resize"]) {
  const serializer = new SerializeAddon();
  terminal.loadAddon(serializer);
  const view = { terminal, serializer, fit, input, resize };
  views.set(id, view);
  const write = terminal.write.bind(terminal);
  terminal.write = (data, callback) => {
    write(data, callback);
    const owner = detached.get(id);
    if (!owner || typeof data !== "string" || !data) return;
    const sequence = ++owner.sequence;
    // Forward even before the snapshot is ready; its sequence removes overlap.
    void send(id, { type: "output", sequence, data });
  };
  return () => {
    if (views.get(id) === view) views.delete(id);
    terminal.write = write;
    serializer.dispose();
    void returnTerminal(id);
  };
}

export async function detachTerminal(id: string, title: string, atCursor = false) {
  if (isWorkspaceLocked() || detached.has(id) || !views.has(id)) return;
  const owner: Detached = { label: "", sequence: 0, ready: false, pending: 0, tail: Promise.resolve() };
  detached.set(id, owner);
  changed();
  try {
    owner.label = await invoke<string>("terminal_window_open", { workspaceId: id, title, atCursor });
    if (!views.has(id)) await returnTerminal(id);
  } catch (error) {
    detached.delete(id); changed(); views.get(id)?.fit();
    throw error;
  }
}

export async function returnTerminal(id: string) {
  if (!detached.has(id)) return;
  await invoke("terminal_window_return", { workspaceId: id }).catch(() => {});
  // The Destroyed event is the commit point: never enable two input surfaces.
}

export async function startTerminalWindows(onChanged: () => void, onError: (error: string) => void, onClose: (id: string) => void) {
  changed = onChanged; reportError = onError;
  const stopReturned = await listen<string>("terminal-window://returned", event => {
    detached.delete(event.payload); changed();
    requestAnimationFrame(() => views.get(event.payload)?.fit());
  });
  const stopMessage = await listen<{ workspaceId: string; message: Message }>("terminal-window://message", event => {
    const { workspaceId: id, message } = event.payload;
    const view = views.get(id), owner = detached.get(id);
    if (!view || !owner || !owner.label || isWorkspaceLocked()) return;
    switch (message.type) {
      case "ready": snapshot(id); break;
      case "return": void returnTerminal(id); break;
      case "close": onClose(id); break;
      case "input": if (owner.ready && typeof message.data === "string") view.input(message.data); break;
      case "paste": if (owner.ready && typeof message.data === "string") view.input(prepareTerminalPaste(message.data, view.terminal.modes.bracketedPasteMode)); break;
      case "resize": if (owner.ready && message.cols && message.rows) {
        view.terminal.resize(message.cols, message.rows);
        void view.resize(message.cols, message.rows).catch(() => onError("Terminal resize failed. Return the session to the main window and retry."));
      } break;
    }
  });
  return () => {
    stopReturned(); stopMessage();
    if (changed === onChanged) changed = () => {};
    if (reportError === onError) reportError = () => {};
  };
}
