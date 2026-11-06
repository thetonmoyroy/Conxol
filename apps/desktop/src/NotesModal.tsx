import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ArrowLeft, Copy, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { writeClipboardText } from "./clipboard-access";

type Note = { id: string; name: string; vendor: string; content: string };
const emptyNote = (): Note => ({ id: crypto.randomUUID(), name: "", vendor: "", content: "" });
const browserKey = "conxol.notes";

export function NotesModal({ onClose }: { onClose: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Note>(emptyNote);
  const [mode, setMode] = useState<"list" | "view" | "edit">("list");
  const [query, setQuery] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const records: Note[] = isTauri() ? await invoke("note_list") : JSON.parse(localStorage.getItem(browserKey) ?? "[]");
        if (!Array.isArray(records) || records.some(n => !n || typeof n.id !== "string" || typeof n.name !== "string" || typeof n.vendor !== "string" || typeof n.content !== "string")) throw new Error("Invalid notes data.");
        if (active) { setNotes(records); setLoaded(true); }
      } catch (e) { if (active) setError(`Notes could not be loaded: ${String(e)}`); }
    };
    void load();
    return () => { active = false; };
  }, []);
  const [discardPrompt, setDiscardPrompt] = useState<(() => void) | null>(null);
  const change = (action: () => void) => {
    if (busy) return;
    if (dirty) setDiscardPrompt(() => action);
    else action();
  };
  const select = (note: Note, edit = false) => change(() => { setMode(edit ? "edit" : "view"); setDraft(note); setDirty(false); setError(null); setNotice(""); setDeletePrompt(false); });
  const update = (patch: Partial<Note>) => { setDraft(current => ({ ...current, ...patch })); setDirty(true); setNotice(""); };
  const save = async () => {
    setBusy(true); setError(null); setNotice("");
    try {
      const note = { ...draft, name: draft.name.trim(), vendor: draft.vendor.trim() };
      if (!note.name || !note.content.trim()) throw new Error("Enter a name and command text.");
      const saved = isTauri() ? await invoke<Note>("note_save", { note }) : note;
      const next = [...notes.filter(n => n.id !== saved.id), saved];
      if (!isTauri()) localStorage.setItem(browserKey, JSON.stringify(next));
      setNotes(next); setDraft(saved); setDirty(false); setNotice("Note saved."); setMode("view");
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const [deletePrompt, setDeletePrompt] = useState(false);
  const remove = async () => {
    setBusy(true); setError(null);
    try {
      if (isTauri()) await invoke("note_delete", { id: draft.id });
      const next = notes.filter(n => n.id !== draft.id);
      if (!isTauri()) localStorage.setItem(browserKey, JSON.stringify(next));
      setNotes(next); setDraft(emptyNote()); setDirty(false); setDeletePrompt(false); setNotice("Note deleted."); setMode("list");
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try { await writeClipboardText(draft.content); setNotice("Command text copied."); setError(null); }
    catch (e) { setError(`Could not copy: ${String(e)}`); }
  };
  const back = () => change(() => {
    const saved = notes.find(note => note.id === draft.id);
    setDraft(saved ?? emptyNote()); setDirty(false); setDeletePrompt(false); setNotice(""); setError(null);
    setMode(mode === "edit" && saved ? "view" : "list");
  });
  const filtered = notes.filter(n => `${n.name} ${n.vendor} ${n.content}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  return <section className={`notes-modal notes-panel ${mode === "list" ? "notes-browsing" : ""}`} aria-label="Vendor command notes" onKeyDown={e => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (discardPrompt) setDiscardPrompt(null);
      else if (deletePrompt) setDeletePrompt(false);
      else if (mode !== "list") back();
      else change(onClose);
    }
  }}>
      <header className="session-editor-heading"><div><h2>Notes</h2><p>Keep vendor CLI commands and reference notes searchable by name.</p></div><button type="button" className="icon-button" title="Add note" aria-label="Add note" disabled={busy || !loaded || mode === "edit"} onClick={() => select(emptyNote(), true)}><Plus size={17} /></button></header>
      <div className="notes-layout">
        {mode === "list" && <aside className="notes-sidebar">
          <input aria-label="Search notes" placeholder="Search name, vendor or command…" value={query} onChange={e => setQuery(e.target.value)} />
          <div className="notes-list" aria-label="Saved notes">{filtered.map(note => <button type="button" key={note.id} className={mode !== "list" && note.id === draft.id ? "active" : ""} disabled={busy} onClick={() => select(note)}><strong>{note.name}</strong><small>{note.vendor || "General"}</small></button>)}{loaded && !filtered.length && <p>{query ? "No matching notes." : "No notes yet. Use the + button to add one."}</p>}</div>
        </aside>}
        {mode === "view" && <article className="notes-preview">
          <div className="notes-preview-toolbar">
            <button type="button" className="notes-back" onClick={back}><ArrowLeft size={14} /> All notes</button>
            <div>
              <button type="button" className="icon-button" title="Edit note" aria-label="Edit note" onClick={() => setMode("edit")}><Pencil size={14} /></button>
              <button type="button" className="icon-button notes-delete" title="Delete note" aria-label="Delete note" disabled={busy} onClick={() => setDeletePrompt(true)}><Trash2 size={14} /></button>
            </div>
          </div>
          <div className="notes-preview-heading"><h3>{draft.name}</h3><span className="notes-vendor">{draft.vendor || "General"}</span></div>
          <div className="notes-preview-card">
            <div className="notes-preview-caption"><span>Commands & notes</span><button type="button" title="Copy note text" aria-label="Copy note text" onClick={() => void copy()}><Copy size={13} /><span>Copy</span></button></div>
            <pre>{draft.content}</pre>
          </div>
        </article>}
        {mode === "edit" && <form className="notes-editor" onSubmit={e => { e.preventDefault(); void save(); }}>
          <button type="button" className="outline-button" disabled={busy} onClick={back}><ArrowLeft size={14} /> Cancel editing</button>
          <fieldset disabled={busy || !loaded}>
            <div className="notes-fields"><label>Name<input required maxLength={200} value={draft.name} placeholder="Show interface status" onChange={e => update({ name: e.target.value })} /></label><label>Vendor<input maxLength={100} value={draft.vendor} placeholder="Cisco, MikroTik, Huawei…" onChange={e => update({ vendor: e.target.value })} /></label></div>
            <label className="notes-content">Commands & notes<textarea required maxLength={65536} value={draft.content} spellCheck={false} placeholder="Add CLI commands and any notes here…" onChange={e => update({ content: e.target.value })} /></label>
            <div className="notes-actions"><button type="button" className="outline-button" disabled={!draft.content} onClick={() => void copy()}><Copy size={14} /> Copy text</button><button type="button" className="outline-button" disabled={!notes.some(n => n.id === draft.id)} onClick={() => setDeletePrompt(true)}><Trash2 size={14} /> Delete</button><button className="primary-button" type="submit"><Save size={14} /> {busy ? "Saving…" : "Save note"}</button></div>
          </fieldset>
        </form>}
          {dirty && <small className="notes-unsaved">Unsaved changes</small>}
          {notice && <p className="notes-notice" role="status">{notice}</p>}{error && <p role="alert" className="notes-error">{error}</p>}
          {discardPrompt && <div className="notes-confirm" role="alert"><p>Discard unsaved changes?</p><button type="button" className="outline-button" onClick={() => setDiscardPrompt(null)}>Keep editing</button><button type="button" className="primary-button" onClick={() => { discardPrompt(); setDiscardPrompt(null); }}>Discard</button></div>}
          {deletePrompt && <div className="notes-confirm" role="alert"><p>Delete “{draft.name}”?</p><button type="button" className="outline-button" disabled={busy} onClick={() => setDeletePrompt(false)}>Cancel</button><button type="button" className="primary-button" disabled={busy} onClick={() => void remove()}>Delete note</button></div>}
      </div>
    </section>;
}
