import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Network, Pencil, Star, Trash2 } from "lucide-react";

export function SessionRowActions({ name, favorite, onCustomize, onEdit, onDelete, onToggleFavorite }: {
  name: string; favorite: boolean; onCustomize?: () => void; onEdit?: () => void; onDelete?: () => void; onToggleFavorite: () => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = () => setPosition(null);
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("conxol:workspace-locked", close);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("conxol:workspace-locked", close);
    };
  }, [position]);
  const run = (action: () => void) => { setPosition(null); trigger.current?.focus(); action(); };
  return <div className="session-row-actions">
    <button ref={trigger} type="button" className="session-action" title={`Actions for ${name}`} aria-label={`Actions for ${name}`} aria-haspopup="menu" aria-expanded={!!position} aria-controls={position ? id : undefined} onClick={() => {
      if (position) { setPosition(null); return; }
      const rect = trigger.current!.getBoundingClientRect();
      setPosition({ left: Math.max(4, Math.min(rect.right - 220, window.innerWidth - 224)), top: Math.max(4, Math.min(rect.bottom, window.innerHeight - 160)) });
    }}><MoreHorizontal size={14} /></button>
    {position && createPortal(<div ref={menu} id={id} className="terminal-context-menu session-actions-menu" role="menu" aria-label={`Actions for ${name}`} style={position} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setPosition(null); trigger.current?.focus(); }
      if (event.key === "Tab") { setPosition(null); trigger.current?.focus(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
      {onCustomize && <button type="button" role="menuitem" onClick={() => run(onCustomize)}><Network size={14} />Customize host</button>}
      {onEdit && <button type="button" role="menuitem" onClick={() => run(onEdit)}><Pencil size={14} />Edit session</button>}
      {onDelete && <button type="button" role="menuitem" onClick={() => run(onDelete)}><Trash2 size={14} />Delete session</button>}
      <button type="button" role="menuitem" onClick={() => run(onToggleFavorite)}><Star size={14} fill={favorite ? "currentColor" : "none"} />{favorite ? "Remove from favorites" : "Add to favorites"}</button>
    </div>, document.body)}
  </div>;
}
