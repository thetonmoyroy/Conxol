import { useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, Minus, X } from "lucide-react";

export function FloatingDiagnostics({ open, onMinimize, onClose, children }: { open: boolean; onMinimize: () => void; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [position, setPosition] = useState(() => ({ left: Math.max(8, window.innerWidth - 838), top: 80 }));
  function move(left: number, top: number) {
    const bounds = panel.current?.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(left, window.innerWidth - (bounds?.width ?? 320) - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - (bounds?.height ?? 300) - 8)),
    });
  }
  useEffect(() => {
    const fit = () => {
      if (panel.current?.hidden) return;
      const bounds = panel.current?.getBoundingClientRect();
      if (bounds) move(bounds.left, bounds.top);
    };
    if (open) fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open]);
  return <section ref={panel} className="floating-diagnostics" hidden={!open} aria-label="Floating network diagnostics" style={{ ...position, maxWidth: `calc(100vw - ${position.left + 8}px)`, maxHeight: `calc(100dvh - ${position.top + 8}px)` }}>
    <header className="floating-diagnostics-title" onPointerDown={event => {
      if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
      const bounds = panel.current!.getBoundingClientRect();
      drag.current = { x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    }} onPointerMove={event => {
      if (drag.current) move(drag.current.left + event.clientX - drag.current.x, drag.current.top + event.clientY - drag.current.y);
    }} onPointerUp={event => {
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }} onLostPointerCapture={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <span tabIndex={0} title="Drag to move, or use arrow keys" onKeyDown={event => {
        const steps: Record<string, [number, number]> = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
        const step = steps[event.key];
        if (step) { event.preventDefault(); move(position.left + step[0], position.top + step[1]); }
      }}><Activity size={14} /> Diagnostics</span>
      <div className="floating-diagnostics-actions">
        <button type="button" className="icon-button" title="Minimize diagnostics (tools keep running)" aria-label="Minimize diagnostics" onClick={onMinimize}><Minus size={15} /></button>
      <button type="button" className="icon-button" title="Close diagnostics and stop running tools" aria-label="Close diagnostics" onClick={onClose}><X size={15} /></button>
      </div>
    </header>
    {children}
  </section>;
}
