import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

type Profile = { id: string; name: string; folder: string };
export function PptpProfileSelect({ value, profiles, disabled, onChange, labelId }: { value: string; profiles: Profile[]; disabled: boolean; onChange: (id: string) => void; labelId: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 260 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const selected = profiles.find(p => p.id === value);
  const name = (p: Profile) => p.folder ? `${p.folder} / ${p.name}` : p.name;
  const label = selected ? name(selected) : value ? "Assigned profile unavailable" : "Direct connection";
  const matches = profiles.filter(p => `${p.folder} ${p.name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => name(a).localeCompare(name(b)));
  const options = [{ id: "", name: "Direct connection", folder: "" }, ...matches.slice(0, 100)];
  const index = Math.min(active, options.length - 1);
  const place = () => {
    if (!trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const above = below < 220 && rect.top > below;
    const height = Math.min(260, (above ? rect.top : below) - 12);
    setPosition({ left: rect.left, top: above ? rect.top - height - 4 : rect.bottom + 4, width: rect.width, maxHeight: Math.max(100, height) });
  };
  const show = () => { place(); setQuery(""); setActive(0); setOpen(true); };
  const close = (focus = false) => { setOpen(false); if (focus) trigger.current?.focus(); };
  const choose = (id: string) => { onChange(id); close(true); };
  useEffect(() => {
    if (!open || disabled) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !trigger.current?.contains(event.target) && !popup.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, disabled]);
  useEffect(() => { if (open) document.getElementById(`${id}-option-${index}`)?.scrollIntoView({ block: "nearest" }); }, [open, index, id]);
  return <>
    <button ref={trigger} type="button" className="pptp-select-trigger" disabled={disabled} aria-labelledby={labelId} aria-haspopup="listbox" aria-expanded={open && !disabled} aria-controls={open ? `${id}-list` : undefined} onClick={() => open ? close() : show()} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); } }}><span>{label}</span><ChevronDown size={14} /></button>
    {open && !disabled && createPortal(<div ref={popup} className="pptp-select-popup" style={position} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length); }
      else if (event.key === "Enter") { event.preventDefault(); choose(options[index].id); }
      else if (event.key === "Tab") close();
    }}>
      <input ref={search} role="combobox" aria-label="Search PPTP profiles" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={`${id}-option-${index}`} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} placeholder="Search PPTP profiles…" autoComplete="off" />
      <div id={`${id}-list`} role="listbox" aria-label="PPTP profiles">{options.map((p, i) => <button key={p.id} id={`${id}-option-${i}`} type="button" role="option" aria-selected={p.id === value} className={i === index ? "active" : ""} tabIndex={-1} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(p.id)}>{name(p)}</button>)}</div>
      {!matches.length && <small>No matching PPTP profiles</small>}
      {matches.length > 100 && <small>Showing 100 profiles. Type to narrow the list.</small>}
    </div>, document.body)}
  </>;
}
