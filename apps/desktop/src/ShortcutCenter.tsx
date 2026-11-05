import { useState } from "react";
import { Search, Plus, Pencil, Trash2, X } from "lucide-react";
import type { ShortcutRecord } from "./command-shortcuts";
import { shortcutDevice, shortcutText, visibleDeviceShortcuts, withShortcutDevice } from "./command-shortcuts";
import "./shortcut-center.css";

type Device = { id: string; name: string };
type Props = { initialDraft?: ShortcutRecord; shortcuts: ShortcutRecord[]; device: Device | null; devices: Device[]; target: string | null; disabledReason: string; onClose: () => void; onSave: (record: ShortcutRecord) => Promise<void>; onDelete: (record: ShortcutRecord) => Promise<void>; onPaste: (record: ShortcutRecord) => Promise<void> };
export function ShortcutCenter({ initialDraft, shortcuts, device, devices, target, disabledReason, onClose, onSave, onDelete, onPaste }: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<ShortcutRecord | null>(initialDraft ?? null);
  const [scope, setScope] = useState(initialDraft ? shortcutDevice(initialDraft) ?? "" : device?.id ?? "");
  const [title, setTitle] = useState(initialDraft?.title ?? ""), [text, setText] = useState(initialDraft?.command ?? "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const records = visibleDeviceShortcuts(shortcuts, device?.id ?? null, query);
  const selectedIndex = Math.min(index, Math.max(0, records.length - 1));
  const availableDevices = [...devices, ...(device && !devices.some(item => item.id === device.id) ? [device] : [])];
  if (draft && scope && !availableDevices.some(item => item.id === scope)) availableDevices.push({ id: scope, name: "Saved device (currently unavailable)" });
  function edit(record?: ShortcutRecord) {
    setDraft(record ?? { id: crypto.randomUUID(), title: "", description: "", tags: [], command: "", variables: [] });
    setTitle(record?.title ?? ""); setText(record ? shortcutText(record) ?? "" : "");
    setScope(record ? shortcutDevice(record) ?? "" : device?.id ?? ""); setError("");
  }
  async function paste(record: ShortcutRecord) {
    if (busy || disabledReason || shortcutText(record) === null) return;
    setBusy(true); setError("");
    try { await onPaste(record); } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  }
  async function save() {
    if (!draft || !title.trim() || !text.trim() || busy) return;
    setBusy(true); setError("");
    try {
      if (new TextEncoder().encode(text).length > 65536) throw Error("Use up to 64 KiB of command text.");
      if (shortcutText({ ...draft, command: text }) === null) throw Error("Enter one line of command text without line breaks or control keys.");
      await onSave({ ...draft, title: title.trim(), tags: withShortcutDevice(draft.tags, scope || null), command: text, variables: [] });
      if (initialDraft?.id === draft.id) onClose();
      else setDraft(null);
    } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  }
  return <div className="palette-backdrop" onMouseDown={() => { if (!busy) onClose(); }}>
    <section className="shortcut-center" role="dialog" aria-modal="true" aria-label="Shortcut command center" onMouseDown={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === "Tab") {
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'));
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      if (event.key === "Escape") { event.stopPropagation(); if (!busy) { if (draft) setDraft(null); else onClose(); } }
    }}>
      <header><div><h2>{draft ? "Save a shortcut" : "Shortcuts"}</h2><p>{draft ? "Give it a name, add a command, choose a device." : `Paste into ${target ?? "a connected terminal"} · Double Shift to open`}</p></div><button className="icon-button" aria-label="Close shortcuts" disabled={busy} onClick={onClose}><X size={17} /></button></header>
      {draft ? <form className="shortcut-center-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
        <label>Name<input autoFocus required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} placeholder="Show interfaces" /></label>
        <label>Command<input required maxLength={65536} value={text} onChange={event => setText(event.target.value)} placeholder="show interfaces" spellCheck={false} /></label>
        <label>Save for<select value={scope} onChange={event => setScope(event.target.value)}><option value="">All devices</option>{availableDevices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <p>One line per shortcut. Clicking pastes without pressing Enter. Keep passwords and tokens out of shortcuts.</p>
        <footer><button type="button" className="outline-button" disabled={busy} onClick={() => setDraft(null)}>Back</button><button className="primary-button" disabled={busy || !title.trim() || !text.trim()}>{busy ? "Saving…" : "Save shortcut"}</button></footer>
      </form> : <>
        <div className="shortcut-center-search"><Search size={17} /><input autoFocus aria-label="Search device shortcuts" placeholder="Find a shortcut…" value={query} onChange={event => { setQuery(event.target.value); setIndex(0); }} onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setIndex(records.length ? (selectedIndex + (event.key === "ArrowDown" ? 1 : records.length - 1)) % records.length : 0); }
          if (event.key === "Enter" && records[selectedIndex]) { event.preventDefault(); void paste(records[selectedIndex]); }
        }} /><button className="outline-button" disabled={busy} onClick={() => edit()}><Plus size={14} /> New shortcut</button></div>
        <div className="shortcut-center-scope">{device?.name ?? "Shared shortcuts"} {device && " + All devices"}</div>
        {disabledReason && <p className="shortcut-center-message">{disabledReason}</p>}
        <div className="shortcut-center-results">{records.map((record, position) => <div className={`shortcut-center-row ${position === selectedIndex ? "selected" : ""}`} key={record.id}>
          <button className="shortcut-center-paste" disabled={busy || !!disabledReason || shortcutText(record) === null} onMouseEnter={() => setIndex(position)} onClick={() => void paste(record)} title="Paste into the current terminal"><strong>{record.title}</strong><small>{shortcutText(record) ?? "Invalid command"}</small><span>{shortcutDevice(record) ? "This device" : "All devices"} · {shortcutText(record) === null ? "Invalid" : "Paste"}</span></button>
          <button className="icon-button" aria-label={`Edit ${record.title}`} disabled={busy} onClick={() => edit(record)}><Pencil size={14} /></button>
          <button className="icon-button" aria-label={`Delete ${record.title}`} disabled={busy} onClick={async () => { setBusy(true); try { await onDelete(record); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } }}><Trash2 size={14} /></button>
        </div>)}{!records.length && <div className="palette-empty">{query ? "No matching shortcuts." : "No shortcuts yet for this device. Click New shortcut to save one."}</div>}</div>
        <footer><span>↑ ↓ Choose · Enter Paste · Esc Close</span><span>One line · Paste only</span></footer>
      </>}
      {error && <p className="shortcut-center-message" role="alert">{error}</p>}
    </section>
  </div>;
}
