import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { isWorkspaceLocked, useWorkspaceLock } from "./workspace-lock-state";
import { confirmAction } from "./text-prompt";
import { handleTerminalControlKey } from "./terminal-control-keys";
import { writeClipboardText } from "./clipboard-access";
import { isMultilineTerminalPaste } from "./terminal-paste";
import { TerminalInputQueue } from "./terminal-input";
import { TerminalWindowReplay } from "./terminal-window-replay";
import { attachNetworkHighlighting } from "./network-highlighting";
import { suppressMirroredTerminalReports } from "./terminal-window-reports";
import { attachTerminalBengaliLayout, attachTerminalUnicodeJoining, configureTerminalUnicodeWidths, loadTerminalFont, terminalBoldWeight, terminalFontFamily } from "./terminal-unicode-joining";
import { IS_WINDOWS_TERMINAL, WINDOWS_TERMINAL_LINE_HEIGHT } from "./terminal-zoom";
import "./terminal-tabs.css";

type DisplayMessage = { type: string; sequence: number; data: string; cols: number; rows: number; options?: Partial<Terminal["options"]> };

export function DetachedTerminal() {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { status } = useWorkspaceLock();
  const ready = useRef(false);
  const requestSnapshot = useRef<() => void>(() => {});
  useEffect(() => {
    ready.current = false;
    if (status?.locked === false) requestSnapshot.current();
  }, [status?.locked]);

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let failed = false;
    const replay = new TerminalWindowReplay();
    const outgoing = new TerminalInputQueue();
    let generation = 0;
    const terminal = new Terminal({
      allowProposedApi: true,
      fontFamily: terminalFontFamily("default"),
      fontWeightBold: terminalBoldWeight("default"),
      drawBoldTextInBrightColors: true,
      cursorBlink: true,
      fontSize: 14,
      lineHeight: IS_WINDOWS_TERMINAL ? WINDOWS_TERMINAL_LINE_HEIGHT : 1,
      scrollback: 10000,
    });
    configureTerminalUnicodeWidths(terminal);
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(host.current);
    const refreshFont = () => {
      const family = terminal.options.fontFamily;
      if (!family) return;
      void loadTerminalFont(family, terminal.options.fontSize ?? 14, terminal.options.fontWeightBold).then(() => {
        if (disposed || terminal.options.fontFamily !== family) return;
        terminal.options.fontFamily = "monospace";
        terminal.options.fontFamily = family;
        resize();
      }).catch(() => { /* Keep the platform font fallback. */ });
    };
    const disposeUnicodeJoining = attachTerminalUnicodeJoining(terminal);
    const disposeBengaliLayout = attachTerminalBengaliLayout(terminal);
    const highlighting = attachNetworkHighlighting(terminal, false);
    const disposeReports = suppressMirroredTerminalReports(terminal);
    terminal.textarea?.setAttribute("aria-label", "Detached terminal input");
    if (terminal.textarea) { terminal.textarea.spellcheck = false; terminal.textarea.setAttribute("autocomplete", "off"); }
    const send = (message: object) => outgoing.enqueue("terminal-window", JSON.stringify(message), () => invoke("terminal_window_message", { message })).catch(() => {
      if (!disposed && !isWorkspaceLocked()) {
        failed = true; ready.current = false;
        setError("The session window could not reach the workspace. Return to the main window to continue.");
      }
    });
    requestSnapshot.current = () => { void send({ type: "ready" }); };
    const resize = () => {
      if (!ready.current || isWorkspaceLocked()) return;
      const size = fit.proposeDimensions();
      if (!size || size.cols < 2 || size.rows < 2 || size.cols > 1000 || size.rows > 1000) return;
      if (size.cols !== terminal.cols || size.rows !== terminal.rows) {
        terminal.resize(size.cols, size.rows);
        void send({ type: "resize", cols: size.cols, rows: size.rows });
      }
    };
    const drain = () => replay.drain(data => terminal.write(data));
    let unlisten: (() => void) | undefined;
    void listen<{ message: DisplayMessage }>("terminal-window://message", event => {
      if (disposed || failed || isWorkspaceLocked()) return;
      const message = event.payload.message;
      if (message.type === "snapshot") {
        const ticket = ++generation;
        ready.current = false;
        replay.snapshot(message.sequence);
        // Drain any pre-lock/pre-snapshot writes before resetting the emulator.
        terminal.write("", () => {
          if (disposed || failed || isWorkspaceLocked() || ticket !== generation) return;
          if (message.options) terminal.options = message.options;
          refreshFont();
          terminal.reset();
          terminal.resize(message.cols, message.rows);
          terminal.write(message.data, () => {
            if (disposed || failed || isWorkspaceLocked() || ticket !== generation) return;
            ready.current = true; setError(null); drain(); resize(); terminal.focus();
          });
        });
      } else if (message.type === "font" && (message.data === "default" || message.data === "original" || message.data === "slim")) {
        const family = terminalFontFamily(message.data);
        const boldWeight = terminalBoldWeight(message.data);
        terminal.write("", () => {
          if (disposed || failed) return;
          terminal.options.fontFamily = family;
          terminal.options.fontWeightBold = boldWeight;
          refreshFont();
        });
      } else if (message.type === "output") {
        if (!replay.push(message.sequence, message.data)) {
          failed = true; ready.current = false;
          setError("Display buffer is full. Return to the main window to continue.");
          return;
        }
        if (ready.current) drain();
      }
    }).then(stop => {
      if (disposed) { stop(); return; }
      unlisten = stop; requestSnapshot.current();
    }).catch(() => setError("Could not initialize the detached display."));
    const retry = window.setInterval(() => { if (!failed && !ready.current && !isWorkspaceLocked()) requestSnapshot.current(); }, 1000);
    const observer = new ResizeObserver(resize); observer.observe(host.current);
    const input = terminal.onData(data => {
      if (ready.current && !isWorkspaceLocked()) void send({ type: "input", data });
    });
    terminal.attachCustomKeyEventHandler(event => !handleTerminalControlKey(event, terminal,
      () => ready.current && !isWorkspaceLocked(),
      data => { void send({ type: "input", data }); },
      text => { void writeClipboardText(text).catch(() => setError("Clipboard access failed.")); }));
    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData?.getData("text/plain");
      if (data === undefined) return;
      event.preventDefault(); event.stopPropagation();
      if (!ready.current || isWorkspaceLocked()) return;
      if (new TextEncoder().encode(data).byteLength > 65536) { setError("Paste is limited to 64 KiB in detached windows."); return; }
      const pinnedGeneration = generation;
      void (async () => {
        if (isMultilineTerminalPaste(data) && !await confirmAction("Paste multiple lines into this terminal?")) return;
        if (!disposed && ready.current && !isWorkspaceLocked() && generation === pinnedGeneration) void send({ type: "paste", data });
      })();
    };
    const element = host.current;
    element.addEventListener("paste", onPaste, true);
    return () => {
      disposed = true; ready.current = false; requestSnapshot.current = () => {};
      clearInterval(retry); unlisten?.(); observer.disconnect(); input.dispose();
      element.removeEventListener("paste", onPaste, true); disposeReports(); disposeUnicodeJoining(); disposeBengaliLayout(); highlighting.dispose(); terminal.dispose();
    };
  }, []);

  return <main className="detached-terminal">
    <header><span>Detached session</span><button type="button" onClick={() => void invoke("terminal_window_return").catch(() => setError("Could not return the session. Close this window to return it."))}>Return to main window</button>
      <button type="button" onClick={() => void confirmAction("Close this terminal session?").then(approved => { if (approved && !isWorkspaceLocked()) return invoke("terminal_window_message", { message: { type: "close" } }); }).catch(() => setError("Could not close the session."))}>Close session</button></header>
    {error && <p role="alert">{error}</p>}
    <div className="detached-terminal-host" ref={host} />
  </main>;
}
