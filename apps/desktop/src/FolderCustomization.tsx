import { defaultFolderStyle, type FolderStyle } from "./folder-appearance";
import { useState } from "react";
import { Folder, Server, Star, Network, Pencil } from "lucide-react";

const icons = { folder: Folder, server: Server, star: Star, network: Network };
export function SessionFolderIcon({ appearance = defaultFolderStyle }: { appearance?: FolderStyle }) {
  const Icon = icons[appearance.icon] ?? Folder;
  return <Icon size={16} style={appearance.color ? { color: appearance.color } : undefined} />;
}
export function FolderCustomization({ folder, appearance, onClose, onSave }: { folder: string; appearance: FolderStyle; onClose: () => void; onSave: (name: string, style: FolderStyle) => Promise<void> }) {
  const [name, setName] = useState(folder), [icon, setIcon] = useState(appearance.icon), [color, setColor] = useState(appearance.color);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  return <div className="palette-backdrop" onMouseDown={() => { if (!busy) onClose(); }} onKeyDown={event => { if (event.key === "Escape" && !busy) onClose(); }}>
    <form className="folder-customization" role="dialog" aria-modal="true" aria-labelledby="folder-customization-heading" onMouseDown={event => event.stopPropagation()} onSubmit={event => {
      event.preventDefault(); if (busy) return;
      if (!name.trim() || name.trim().length > 128) { setError("Enter a folder name of 1–128 characters."); return; }
      setBusy(true); setError(null);
      void onSave(name.trim(), { icon, color }).catch(error => { setError(String(error)); setBusy(false); });
    }}>
      <h2 id="folder-customization-heading"><Pencil size={16} /> Customize folder</h2>
      <fieldset disabled={busy}>
        <label>Folder name<input autoFocus required maxLength={128} value={name} onChange={event => setName(event.target.value)} /></label>
        <div className="folder-icon-options" role="group" aria-label="Folder icon">{Object.entries(icons).map(([key, Icon]) => <button type="button" key={key} aria-label={key} aria-pressed={icon === key} onClick={() => setIcon(key as FolderStyle["icon"])}><Icon size={20} style={{ color: color || "var(--mint)" }} /></button>)}</div>
        <label>Icon color<input type="color" value={color || "#9bc48a"} onChange={event => setColor(event.target.value)} /></label>
        <button type="button" className="outline-button" onClick={() => setColor("")}>Use theme color</button>
      </fieldset>
      {error && <p role="alert" className="connect-error">{error}</p>}
      <div className="workspace-pin-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save folder"}</button><button type="button" className="outline-button" disabled={busy} onClick={onClose}>Cancel</button></div>
    </form>
  </div>;
}
