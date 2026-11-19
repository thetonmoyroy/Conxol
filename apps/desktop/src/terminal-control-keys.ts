type ControlKey = Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "preventDefault" | "stopPropagation">;
type TerminalControls = { getSelection: () => string; clearSelection: () => void; scrollToBottom: () => void };

/** Handle clipboard shortcuts before xterm converts them to terminal input. */
export function handleTerminalControlKey(event: ControlKey, terminal: TerminalControls, allowed: () => boolean, send: (data: string) => void, copy: (text: string) => void): boolean {
  if (event.type !== "keydown" || !event.ctrlKey || event.altKey || event.metaKey) return false;
  const key = event.key.toLowerCase();
  if (key === "v") {
    // Skip xterm's Ctrl+V control byte while allowing the WebView's paste event.
    if (!allowed()) event.preventDefault();
    return true;
  }
  if (key !== "c") return false;
  event.preventDefault();
  event.stopPropagation();
  if (!allowed()) return true;
  if (event.shiftKey) {
    const selection = terminal.getSelection();
    if (selection) copy(selection);
  } else {
    terminal.clearSelection();
    terminal.scrollToBottom();
    send("\x03");
  }
  return true;
}
