import { useRef } from "react";
import { ArrowUp, Folder, RefreshCw, ArrowRight } from "lucide-react";
import { literalInputProps } from "./literal-input";
import { remoteParentPath } from "./remote-path";

export function RemotePathBar({ path, loading, onNavigate, compact = false }: { path: string; loading: boolean; onNavigate: (path: string) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return <form className="sidebar-path" aria-label="Remote directory navigation" onSubmit={event => {
    event.preventDefault();
    const next = input.current?.value;
    if (next && !loading) onNavigate(next);
  }}>
    {!compact && <><button type="button" title="Parent directory" aria-label="Parent directory" disabled={loading || path === "/"} onClick={() => onNavigate(remoteParentPath(path))}><ArrowUp size={13} /></button><Folder size={12} aria-hidden="true" /></>}
    <input {...literalInputProps} key={path} ref={input} defaultValue={path} aria-label="Remote directory path" title={path} disabled={loading} placeholder="Enter directory path" onFocus={event => event.currentTarget.select()} onKeyDown={event => {
      if (event.key === "Escape") { event.currentTarget.value = path; event.currentTarget.blur(); }
    }} />
    <button type="submit" title="Go to directory (Enter)" aria-label="Go to directory" disabled={loading}><ArrowRight size={13} /></button>
    {!compact && <button type="button" title="Refresh directory" aria-label="Refresh remote files" disabled={loading} onClick={() => onNavigate(path)}><RefreshCw size={12} className={loading ? "spin" : undefined} /></button>}
  </form>;
}
