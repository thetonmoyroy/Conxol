type ControlKey = Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "preventDefault" | "stopPropagation">;
type TerminalControls = { getSelection: () => string; clearSelection: () => void; scrollToBottom: () => void };

/** Reserve Ctrl+C for ETX, including while selecting scrollback. Copy uses Ctrl+Shift+C. */
export function handleTerminalControlKey(event: ControlKey, terminal: TerminalControls, allowed: () => boolean, send: (data: string) => void, copy: (text: string) => void): boolean {
  if (event.type !== "keydown" || event.key.toLowerCase() !== "c" || !event.ctrlKey || event.altKey || event.metaKey) return false;
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
