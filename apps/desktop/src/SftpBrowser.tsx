import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Folder, FolderUp, FolderPlus, FilePlus, File, FileCode, Download, Upload, RefreshCw, Trash2, Pencil, Copy, Settings2, Eye, ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import type { RemoteEntry } from "./App";
import { RemotePathBar } from "./RemotePathBar";
import { remoteParentPath } from "./remote-path";

type Props = {
  entries: RemoteEntry[]; path: string; loading: boolean; ready: boolean; error: string | null;
  onNavigate: (path: string) => void; onDownload: (entry: RemoteEntry) => void;
  onUpload: () => void; onCreateDirectory: () => void; onCreateFile: () => void;
  onRename: (entry: RemoteEntry) => void; onDelete: (entry: RemoteEntry) => void;
  onSetPermissions: (entry: RemoteEntry) => void; onCopyPath: (entry: RemoteEntry) => void;
  onEdit: (entry: RemoteEntry) => void; children?: ReactNode;
  onExternalEdit?: (entry: RemoteEntry) => void;
};
export function SftpBrowser(props: Props) {
  const { entries, path, loading, ready, error, onNavigate } = props;
  const [selectedPath, select] = useState("");
  const [hidden, setHidden] = useState(true);
  const [descending, setDescending] = useState(false);
  const [menu, setMenu] = useState<{ entry: RemoteEntry; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = entries.find(entry => entry.path === selectedPath);
  const visible = entries.filter(entry => hidden || !entry.name.startsWith(".")).slice().sort((a, b) =>
    a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) * (descending ? -1 : 1));
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setMenu(null); } };
    const locked = () => setMenu(null);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", close);
    window.addEventListener("conxol:workspace-locked", locked);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); window.removeEventListener("resize", close); window.removeEventListener("conxol:workspace-locked", locked); };
  }, [menu]);
  const open = (entry: RemoteEntry) => { if (entry.isDirectory) onNavigate(entry.path); else if (entry.isRegular) props.onEdit(entry); };
  const actions = (entry: RemoteEntry) => [
    { label: entry.isDirectory ? "Open directory" : "Open in text editor", icon: Folder, run: () => open(entry), disabled: !entry.isDirectory && !entry.isRegular },
    { label: "Download", icon: Download, run: () => props.onDownload(entry) },
    ...(props.onExternalEdit ? [{ label: "Edit in external editor", icon: ExternalLink, run: () => props.onExternalEdit?.(entry), disabled: !entry.isRegular }] : []),
    { label: "Rename", icon: Pencil, run: () => props.onRename(entry) },
    { label: "Copy file path", icon: Copy, run: () => props.onCopyPath(entry) },
    { label: "Permissions", icon: Settings2, run: () => props.onSetPermissions(entry) },
    { label: "Delete", icon: Trash2, run: () => props.onDelete(entry) },
  ];
  return <section className="sftp-browser" aria-label="SSH browser (SFTP)">
    <div className="sftp-toolbar" role="toolbar" aria-label="SFTP actions">
      <button title="Download selected item" aria-label="Download selected item" disabled={!ready || !selected} onClick={() => selected && props.onDownload(selected)}><Download /></button>
      <button title="Upload files" aria-label="Upload files" disabled={!ready} onClick={props.onUpload}><Upload /></button>
      <button title="Refresh" aria-label="Refresh" disabled={loading} onClick={() => onNavigate(path)}><RefreshCw className={loading ? "spin" : undefined} /></button>
      <button title="New folder" aria-label="New folder" disabled={!ready} onClick={props.onCreateDirectory}><FolderPlus /></button>
      <button title="Create new file" aria-label="Create new file" disabled={!ready} onClick={props.onCreateFile}><FilePlus /></button>
      <button title="Show hidden files" aria-label="Show hidden files" aria-pressed={hidden} onClick={() => setHidden(value => !value)}><Eye /></button>
    </div>
    <RemotePathBar path={path} loading={loading} onNavigate={onNavigate} compact />
    <button className="sftp-column-heading" onClick={() => setDescending(value => !value)} title="Reverse name sort">{descending ? <ArrowUp size={11} /> : <ArrowDown size={11} />} Name</button>
    {error && <p className="sftp-error" role="alert">{error}</p>}
    <div className="sftp-list" aria-label="Remote directory contents" aria-busy={loading} onScroll={() => setMenu(null)}>
      <button className="sftp-row sftp-parent" title="Double-click to open parent directory" aria-label="Parent directory" disabled={!ready || path === "/"}
        onClick={event => { if (event.detail === 0) onNavigate(remoteParentPath(path)); }}
        onDoubleClick={() => onNavigate(remoteParentPath(path))}><FolderUp size={18} /><span>..</span></button>
      {visible.map(entry => <button key={entry.path} className={`sftp-row${selectedPath === entry.path ? " is-selected" : ""}${entry.isDirectory ? " is-directory" : ""}`} title={entry.name} aria-pressed={selectedPath === entry.path}
        onClick={() => select(entry.path)} onDoubleClick={() => open(entry)}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); open(entry); }
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); select(entry.path); setMenu({ entry, x: rect.left + 24, y: rect.bottom }); }
        }}
        onContextMenu={event => { event.preventDefault(); select(entry.path); setMenu({ entry, x: event.clientX, y: event.clientY }); }}>
        {entry.isDirectory ? <Folder size={18} /> : /\.(sh|bash|py|js|ts)$|^\.bash|^\.profile$/.test(entry.name) ? <FileCode size={18} /> : <File size={18} />}<span>{entry.name}</span>
      </button>)}
      {ready && !visible.length && <p className="sftp-empty">No files</p>}
    </div>
    {props.children}
    {menu && createPortal(<div ref={menuRef} className="sftp-context-menu" role="menu" aria-label={`Actions for ${menu.entry.name}`} style={{ left: Math.max(4, Math.min(menu.x, window.innerWidth - 224)), top: Math.max(4, Math.min(menu.y, window.innerHeight - 210)) }} onKeyDown={event => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }}>{actions(menu.entry).map(action => <button key={action.label} role="menuitem" disabled={action.disabled} onClick={() => { setMenu(null); action.run(); }}><action.icon size={15} />{action.label}</button>)}</div>, document.body)}
  </section>;
}
