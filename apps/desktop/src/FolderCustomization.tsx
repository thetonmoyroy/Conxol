import { defaultFolderStyle, type FolderStyle } from "./folder-appearance";
import { useState } from "react";
import { Folder, Server, Star, Network, Pencil, RadioTower, EthernetPort, Monitor, Terminal, Database, Cloud, Globe, Shield, Lock, KeyRound, Wifi, Cable, Cpu, HardDrive, Building, House, Wrench, Code, Layers, Box } from "lucide-react";

import { NetworkRouter, NetworkSwitch, AccessPoint, Firewall, LoadBalancer } from "./NetworkDeviceIcons";

const icons = { folder: Folder, server: Server, star: Star, network: Network, router: NetworkRouter, switch: NetworkSwitch, firewall: Firewall, "access-point": AccessPoint, antenna: RadioTower, ethernet: EthernetPort, "load-balancer": LoadBalancer, monitor: Monitor, terminal: Terminal, database: Database, cloud: Cloud, globe: Globe, shield: Shield, lock: Lock, key: KeyRound, wifi: Wifi, cable: Cable, cpu: Cpu, drive: HardDrive, building: Building, home: House, wrench: Wrench, code: Code, layers: Layers, box: Box };
export function SessionFolderIcon({ appearance = defaultFolderStyle }: { appearance?: FolderStyle }) {
  const Icon = icons[appearance.icon] ?? Folder;
  return <Icon size={16} style={appearance.color ? { color: appearance.color } : undefined} />;
}
export type HostBookmark = { folder: string; tags: string[]; notes: string; favorite: boolean };
export function FolderCustomization({ folder, appearance, onClose, onSave, host = false, bookmark, folders = [] }: { bookmark?: HostBookmark; folders?: string[]; host?: boolean; folder: string; appearance: FolderStyle; onClose: () => void; onSave: (name: string, style: FolderStyle, bookmark?: HostBookmark) => Promise<void> }) {
  const [name, setName] = useState(folder), [icon, setIcon] = useState(appearance.icon), [color, setColor] = useState(appearance.color);
  const [sessionFolder, setSessionFolder] = useState(bookmark?.folder ?? "");
  const [tags, setTags] = useState(bookmark?.tags.join(", ") ?? "");
  const [notes, setNotes] = useState(bookmark?.notes ?? "");
  const [favorite, setFavorite] = useState(bookmark?.favorite ?? false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  return <div className="palette-backdrop" onMouseDown={() => { if (!busy) onClose(); }} onKeyDown={event => { if (event.key === "Escape" && !busy) onClose(); }}>
    <form className="folder-customization" role="dialog" aria-modal="true" aria-labelledby="folder-customization-heading" onMouseDown={event => event.stopPropagation()} onSubmit={event => {
      event.preventDefault(); if (busy) return;
      if (!name.trim() || name.trim().length > 128) { setError("Enter a name of 1–128 characters."); return; }
      setBusy(true); setError(null);
      void onSave(name.trim(), { icon, color }, host ? { folder: sessionFolder.trim(), tags: tags.split(",").map(tag => tag.trim()).filter(Boolean), notes, favorite } : undefined).catch(error => { setError(String(error)); setBusy(false); });
    }}>
      <h2 id="folder-customization-heading"><Pencil size={16} /> {host ? "Customize host" : "Customize folder"}</h2>
      <fieldset disabled={busy}>
        <label>{host ? "Bookmark name" : "Folder name"}<input autoFocus required maxLength={128} value={name} onChange={event => setName(event.target.value)} /></label>
        {host && <>
          <label>Folder<input list="host-customization-folders" maxLength={128} value={sessionFolder} onChange={event => setSessionFolder(event.target.value)} placeholder="Choose or type a folder" /></label>
          <datalist id="host-customization-folders">{folders.map(folder => <option key={folder} value={folder} />)}</datalist>
          <label>Tags<input value={tags} onChange={event => setTags(event.target.value)} placeholder="Separate with commas" /></label>
          <label>Notes<textarea value={notes} onChange={event => setNotes(event.target.value)} /></label>
          <label className="host-favorite"><input type="checkbox" checked={favorite} onChange={event => setFavorite(event.target.checked)} />Favorite</label>
        </>}
        <div className="folder-icon-options" role="group" aria-label={host ? "Host icon" : "Folder icon"}>{Object.entries(icons).map(([key, Icon]) => <button type="button" key={key} title={key} aria-label={key} aria-pressed={icon === key} onClick={() => setIcon(key as FolderStyle["icon"])}><Icon size={20} style={{ color: color || "var(--mint)" }} /></button>)}</div>
        <label>Icon color<input type="color" value={color || "#9bc48a"} onChange={event => setColor(event.target.value)} /></label>
        <button type="button" className="outline-button" onClick={() => setColor("")}>Use theme color</button>
      </fieldset>
      {error && <p role="alert" className="connect-error">{error}</p>}
      <div className="workspace-pin-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "Saving…" : host ? "Save host" : "Save folder"}</button><button type="button" className="outline-button" disabled={busy} onClick={onClose}>Cancel</button></div>
    </form>
  </div>;
}
