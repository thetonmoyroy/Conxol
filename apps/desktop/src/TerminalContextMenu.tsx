import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clipboard, Copy, ScanText } from "lucide-react";
export function TerminalContextMenu({ x, y, selection, onCopy, onPaste, onSelectAll, onClose }: { x: number; y: number; selection: string; onCopy: () => Promise<void>; onPaste: () => Promise<void>; onSelectAll: () => void; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gate = useRef(false);
  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) onClose(); };
    const close = () => onClose();
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("conxol:workspace-locked", close);
    return () => { window.removeEventListener("pointerdown", outside, true); window.removeEventListener("resize", close); window.removeEventListener("blur", close); window.removeEventListener("conxol:workspace-locked", close); };
  }, [onClose]);
  const run = async (action: () => Promise<void>) => {
    if (gate.current) return; gate.current = true; setBusy(true); setError(null);
    try { await action(); onClose(); }
    catch { setError("Clipboard access was blocked. Use the keyboard shortcut or terminal toolbar."); }
    finally { gate.current = false; setBusy(false); }
  };
  return createPortal(<div ref={menuRef} className="terminal-context-menu" role="menu" aria-label="Terminal actions" style={{ left: Math.max(4, Math.min(x, window.innerWidth - 234)), top: Math.max(4, Math.min(y, window.innerHeight - 180)) }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }}>
    <button type="button" role="menuitem" disabled={busy || !selection} onClick={() => void run(onCopy)}><Copy size={14} />Copy</button>
    <button type="button" role="menuitem" disabled={busy} onClick={() => void run(onPaste)}><Clipboard size={14} />Paste<small>Ctrl+V</small></button>
    <div className="terminal-context-divider" />
    <button type="button" role="menuitem" disabled={busy} onClick={() => { onSelectAll(); onClose(); }}><ScanText size={14} />Select all</button>
    {error && <p role="alert">{error}</p>}
  </div>, document.body);
}
