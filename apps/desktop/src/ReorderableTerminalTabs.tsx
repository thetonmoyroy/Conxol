import { useEffect, useRef, useState, type ReactNode } from "react";
import { isWorkspaceLocked } from "./workspace-lock-state";
import "./terminal-tabs.css";

type Drop = { id: string; after: boolean };

export function ReorderableTerminalTabs({ ids, onMove, onDetach, canDetach, detachedIds, onReturn, children }: {
  ids: string[];
  onMove: (source: string, target: string, after: boolean) => void;
  onDetach: (id: string, atCursor?: boolean) => void;
  canDetach: (id: string) => boolean;
  detachedIds: Set<string>;
  onReturn: (id: string) => void;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; pointer: number; startX: number; startY: number; x: number; y: number; active: boolean; drop: Drop | null } | null>(null);
  const scrollFrame = useRef(0);
  const suppressClick = useRef(false);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const cancel = () => {
    cancelAnimationFrame(scrollFrame.current); scrollFrame.current = 0;
    const current = drag.current;
    drag.current = null;
    if (current && host.current?.hasPointerCapture(current.pointer)) host.current.releasePointerCapture(current.pointer);
    setDrop(null);
  };
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);
  const updateDrop = () => {
    const current = drag.current, element = host.current;
    if (!current?.active || !element || isWorkspaceLocked()) return;
    const bounds = element.getBoundingClientRect();
    if (current.y < bounds.top - 12 || current.y > bounds.bottom + 12 || current.x < 0 || current.x >= window.innerWidth) {
      current.drop = null; setDrop(null); return;
    }
    if (current.x < bounds.left + 32) element.scrollLeft -= 12;
    if (current.x > bounds.right - 32) element.scrollLeft += 12;
    const tabs = Array.from(element.querySelectorAll<HTMLElement>("[data-terminal-tab-id]"));
    const target = tabs.find(tab => { const rect = tab.getBoundingClientRect(); return current.x >= rect.left && current.x <= rect.right; });
    const rect = target?.getBoundingClientRect();
    const next = target && rect ? { id: target.dataset.terminalTabId!, after: current.x > rect.left + rect.width / 2 } : null;
    current.drop = next;
    setDrop(previous => previous?.id === next?.id && previous?.after === next?.after ? previous : next);
  };
  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("blur", dismiss);
    return () => { window.removeEventListener("pointerdown", dismiss); window.removeEventListener("blur", dismiss); };
  }, [menu]);

  const moveBy = (id: string, direction: -1 | 1) => {
    if (isWorkspaceLocked()) return;
    const index = ids.indexOf(id);
    const target = ids[index + direction];
    if (index >= 0 && target) onMove(id, target, direction === 1);
    setMenu(null);
    requestAnimationFrame(() => {
      const tab = Array.from(host.current?.querySelectorAll<HTMLElement>("[data-terminal-tab-id]") ?? []).find(tab => tab.dataset.terminalTabId === id);
      tab?.querySelector<HTMLButtonElement>(".terminal-tab-select")?.focus();
    });
  };

  return <div ref={host} className="terminal-tab-strip" role="group" aria-label="Terminal sessions"
    onPointerDownCapture={event => {
      suppressClick.current = false;
      if (event.button !== 0 || !event.isPrimary || isWorkspaceLocked()) return;
      const target = event.target as HTMLElement;
      if (!target.closest(".terminal-tab-select")) return;
      const id = target.closest<HTMLElement>("[data-terminal-tab-id]")?.dataset.terminalTabId;
      if (id) drag.current = { id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, drop: null };
    }}
    onPointerMove={event => {
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId) return;
      if (isWorkspaceLocked() || !ids.includes(current.id)) { cancel(); return; }
      if (!current.active && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6) return;
      current.active = true;
      current.x = event.clientX; current.y = event.clientY;
      suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      updateDrop();
      if (!scrollFrame.current) {
        const scroll = () => { updateDrop(); scrollFrame.current = requestAnimationFrame(scroll); };
        scrollFrame.current = requestAnimationFrame(scroll);
      }
    }}
    onPointerUp={event => {
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId) return;
      if (current.active && !isWorkspaceLocked() && ids.includes(current.id)) {
        const outside = event.clientX < 0 || event.clientX >= window.innerWidth || event.clientY < 0 || event.clientY >= window.innerHeight;
        if (outside) {
          if (!detachedIds.has(current.id) && canDetach(current.id)) onDetach(current.id, true);
        } else if (current.drop) {
          onMove(current.id, current.drop.id, current.drop.after);
        }
      }
      cancel();
    }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}
    onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
    onDragStart={event => event.preventDefault()}
    onKeyDown={event => {
      if (event.key === "Escape") { cancel(); setMenu(null); return; }
      if (!event.altKey || !event.shiftKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      const id = (event.target as HTMLElement).closest<HTMLElement>("[data-terminal-tab-id]")?.dataset.terminalTabId;
      if (id) { event.preventDefault(); event.stopPropagation(); moveBy(id, event.key === "ArrowLeft" ? -1 : 1); }
    }}
    onContextMenu={event => {
      const id = (event.target as HTMLElement).closest<HTMLElement>("[data-terminal-tab-id]")?.dataset.terminalTabId;
      if (!id || isWorkspaceLocked()) return;
      event.preventDefault();
      setMenu({ id, x: Math.max(0, Math.min(event.clientX, window.innerWidth - 220)), y: Math.max(0, Math.min(event.clientY, window.innerHeight - 150)) });
    }}>
    {children}
    {drop && <style>{`[data-terminal-tab-id=${JSON.stringify(drop.id)}] { box-shadow: ${drop.after ? "inset -3px 0" : "inset 3px 0"} var(--accent, #60a5fa); }`}</style>}
    {menu && <div className="terminal-tab-actions" role="menu" aria-label="Tab actions" style={{ left: menu.x, top: menu.y }} onPointerDown={event => event.stopPropagation()}>
      <button autoFocus role="menuitem" disabled={ids.indexOf(menu.id) <= 0} onClick={() => moveBy(menu.id, -1)}>Move left <small>Alt+Shift+←</small></button>
      <button role="menuitem" disabled={ids.indexOf(menu.id) >= ids.length - 1} onClick={() => moveBy(menu.id, 1)}>Move right <small>Alt+Shift+→</small></button>
      {detachedIds.has(menu.id)
        ? <button role="menuitem" onClick={() => { onReturn(menu.id); setMenu(null); }}>Return to main window</button>
        : <button role="menuitem" disabled={!canDetach(menu.id)} onClick={() => { if (!isWorkspaceLocked()) onDetach(menu.id); setMenu(null); }}>Move to new window</button>}
    </div>}
  </div>;
}
