import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { isWorkspaceLocked } from "./workspace-lock-state";
import { bulkCloseTerminalIds } from "./terminal-tab-order";
import "./terminal-tabs.css";

type Drop = { id: string; after: boolean };
type Tab = { id: string; pinned?: boolean; tabColor?: string; sharedSshParentId?: string };
const tabColors = [
  ["Red", "#f87171"], ["Orange", "#fb923c"], ["Yellow", "#facc15"],
  ["Green", "#4ade80"], ["Blue", "#60a5fa"], ["Purple", "#c084fc"],
] as const;

export function ReorderableTerminalTabs({ tabs, activeId, onRename, onColor, onTogglePin, onClose, onMove, onDetach, canDetach, detachedIds, onReturn, children }: {
  tabs: Tab[];
  activeId?: string;
  onRename: (id: string) => void;
  onColor: (id: string, color?: string) => void;
  onTogglePin: (id: string) => void;
  onClose: (ids: string[]) => void;
  onMove: (source: string, target: string, after: boolean) => void;
  onDetach: (id: string, atCursor?: boolean) => void;
  canDetach: (id: string) => boolean;
  detachedIds: Set<string>;
  onReturn: (id: string) => void;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; pointer: number; startX: number; startY: number; x: number; y: number; active: boolean; drop: Drop | null } | null>(null);
  const scrollFrame = useRef(0);
  const suppressClick = useRef(false);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; colors?: boolean } | null>(null);
  const menuIndex = tabs.findIndex(tab => tab.id === menu?.id);
  const menuTab = tabs[menuIndex];
  const closable = (items: Tab[]) => bulkCloseTerminalIds(tabs, items.map(tab => tab.id));
  const closeLeft = menuTab ? closable(tabs.slice(0, menuIndex)) : [];
  const closeRight = menuTab ? closable(tabs.slice(menuIndex + 1)) : [];
  const closeOthers = menuTab && activeId ? closable(tabs.filter(tab => tab.id !== activeId)) : [];
  const canMove = (source?: Tab, target?: Tab) => Boolean(source && target && !!source.pinned === !!target.pinned);

  useLayoutEffect(() => {
    const element = menuElement.current;
    if (!menu || !element) return;
    element.style.left = `${Math.max(0, Math.min(menu.x, window.innerWidth - element.offsetWidth - 4))}px`;
    element.style.top = `${Math.max(0, Math.min(menu.y, window.innerHeight - element.offsetHeight - 4))}px`;
  }, [menu]);

  const runAction = (action: () => void) => {
    if (menu) focusTab(menu.id);
    if (!isWorkspaceLocked()) action();
    setMenu(null);
  };

  const focusTab = (id: string) => {
    const tab = Array.from(host.current?.querySelectorAll<HTMLElement>("[data-terminal-tab-id]") ?? [])
      .find(element => element.dataset.terminalTabId === id);
    tab?.querySelector<HTMLButtonElement>(".terminal-tab-select")?.focus();
  };

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
    const targetTab = tabs.find(tab => tab.id === target?.dataset.terminalTabId);
    const sourceTab = tabs.find(tab => tab.id === current.id);
    const next = targetTab && rect && canMove(sourceTab, targetTab)
      ? { id: targetTab.id, after: current.x > rect.left + rect.width / 2 }
      : null;
    current.drop = next;
    setDrop(previous => previous?.id === next?.id && previous?.after === next?.after ? previous : next);
  };
  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    window.addEventListener("conxol:workspace-locked", dismiss);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("conxol:workspace-locked", dismiss);
    };
  }, [menu]);

  const moveBy = (id: string, direction: -1 | 1) => {
    if (isWorkspaceLocked()) return;
    const index = tabs.findIndex(tab => tab.id === id);
    const target = tabs[index + direction];
    if (target && canMove(tabs[index], target)) onMove(id, target.id, direction === 1);
    setMenu(null);
    requestAnimationFrame(() => focusTab(id));
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
      if (isWorkspaceLocked() || !tabs.some(tab => tab.id === current.id)) { cancel(); return; }
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
      if (current.active && !isWorkspaceLocked() && tabs.some(tab => tab.id === current.id)) {
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
      if (event.key === "Escape") {
        cancel();
        if (menu) focusTab(menu.id);
        setMenu(null);
        return;
      }
      if (!event.altKey || !event.shiftKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      const id = (event.target as HTMLElement).closest<HTMLElement>("[data-terminal-tab-id]")?.dataset.terminalTabId;
      if (id) { event.preventDefault(); event.stopPropagation(); moveBy(id, event.key === "ArrowLeft" ? -1 : 1); }
    }}
    onContextMenu={event => {
      const id = (event.target as HTMLElement).closest<HTMLElement>("[data-terminal-tab-id]")?.dataset.terminalTabId;
      if (!id || isWorkspaceLocked()) return;
      event.preventDefault();
      setMenu({ id, x: event.clientX, y: event.clientY });
    }}>
    {children}
    {drop && <style>{`[data-terminal-tab-id=${JSON.stringify(drop.id)}] { box-shadow: ${drop.after ? "inset -3px 0" : "inset 3px 0"} var(--accent, #60a5fa); }`}</style>}
    {menu && menuTab && <div ref={menuElement} className="terminal-tab-actions" role="menu" aria-label={menu.colors ? "Tab color" : "Tab actions"} onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        event.stopPropagation();
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const direction = event.key === "ArrowDown" ? 1 : -1;
        buttons[(current + direction + buttons.length) % buttons.length]?.focus();
      }}>
      {menu.colors ? <>
        <button key="back" autoFocus role="menuitem" onClick={() => setMenu({ ...menu, colors: false })}>Back to tab actions</button>
        <button role="menuitemradio" aria-checked={!menuTab.tabColor} onClick={() => runAction(() => onColor(menu.id))}>Default color</button>
        {tabColors.map(([name, color]) => <button key={color} role="menuitemradio" aria-checked={menuTab.tabColor === color} onClick={() => runAction(() => onColor(menu.id, color))}>
          <span>{name}{menuTab.tabColor === color && " ✓"}</span><span className="terminal-tab-swatch" style={{ backgroundColor: color }} />
        </button>)}
      </> : <>
        <button key="rename" autoFocus role="menuitem" onClick={() => runAction(() => onRename(menu.id))}>Rename tab</button>
        <button role="menuitem" onClick={() => setMenu({ ...menu, colors: true })}>Set tab color <small>›</small></button>
        <button role="menuitem" onClick={() => runAction(() => onTogglePin(menu.id))}>{menuTab.pinned ? "Unpin tab" : "Pin tab"}</button>
        <div role="separator" />
        <button role="menuitem" disabled={!closeLeft.length} onClick={() => runAction(() => onClose(closeLeft))}>Close tabs to the left</button>
        <button role="menuitem" disabled={!closeRight.length} onClick={() => runAction(() => onClose(closeRight))}>Close tabs to the right</button>
        <button role="menuitem" disabled={!closeOthers.length} onClick={() => runAction(() => onClose(closeOthers))}>Close all except active tab</button>
        <div role="separator" />
        <button role="menuitem" disabled={!canMove(menuTab, tabs[menuIndex - 1])} onClick={() => moveBy(menu.id, -1)}>Move left <small>Alt+Shift+←</small></button>
        <button role="menuitem" disabled={!canMove(menuTab, tabs[menuIndex + 1])} onClick={() => moveBy(menu.id, 1)}>Move right <small>Alt+Shift+→</small></button>
        {detachedIds.has(menu.id)
          ? <button role="menuitem" onClick={() => runAction(() => onReturn(menu.id))}>Return to main window</button>
          : <button role="menuitem" disabled={!canDetach(menu.id)} onClick={() => runAction(() => onDetach(menu.id))}>Move to new window</button>}
      </>}
    </div>}
  </div>;
}
