import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Copy, Folder, Network, Plus, Search, ShieldCheck, Trash2, X } from "lucide-react";

type Connection = { state: "disconnected" | "connecting" | "connected" | "disconnecting" | "error"; message: string; sent: number; received: number };
type Profile = { id: string; name: string; server: string; username: string; folder: string; notes: string; hasPassword: boolean; connection: Connection };
type Snapshot = { profiles: Profile[]; supported: boolean; maxConnections: number };
type Draft = Pick<Profile, "name" | "server" | "username" | "folder" | "notes"> & { id: string | null };
const blank = (): Draft => ({ id: null, name: "", server: "", username: "", folder: "", notes: "" });
const live = (profile?: Profile) => !!profile && ["connecting", "connected", "disconnecting"].includes(profile.connection.state);
const labels: Record<Connection["state"], string> = { disconnected: "Disconnected", connecting: "Connecting", connected: "Connected", disconnecting: "Disconnecting", error: "Failed" };
const statusLetters: Record<Connection["state"], string> = { connected: "R", disconnected: "D", connecting: "C", disconnecting: "…", error: "!" };

export function PptpManager({ onClose }: { onClose: () => void }) {
  const native = isTauri();
  const [snapshot, setSnapshot] = useState<Snapshot>({ profiles: [], supported: false, maxConnections: 16 });
  const [loading, setLoading] = useState(native);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState<Draft>(blank);
  const [dirty, setDirty] = useState(false);
  const [clearPassword, setClearPassword] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const [loginId, setLoginId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  const loginRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const operation = useRef(false);
  const refresh = useCallback(async () => {
    const result = await invoke<Snapshot>("pptp_list");
    if (mounted.current) setSnapshot(result);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement;
    searchRef.current?.focus();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh(); } catch (e) { if (mounted.current) setError(String(e)); }
      finally { if (mounted.current) { setLoading(false); timer = setTimeout(() => void poll(), 1500); } }
    };
    if (native) void poll();
    return () => { mounted.current = false; clearTimeout(timer); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [native, refresh]);
  useEffect(() => { if (loginId) loginRef.current?.focus(); }, [loginId]);
  const selected = snapshot.profiles.find(p => p.id === draft.id);
  const folders = useMemo(() => [...new Set(snapshot.profiles.map(p => p.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [snapshot.profiles]);
  const results = useMemo(() => {
    const text = query.trim().toLowerCase();
    return snapshot.profiles.filter(p => (folder === null || p.folder === folder) && (stateFilter === "all" || (stateFilter === "active" ? live(p) : p.connection.state === stateFilter)) && [p.name, p.server, p.username, p.folder, p.notes].some(value => value.toLowerCase().includes(text)));
  }, [snapshot.profiles, query, folder, stateFilter]);
  const pages = Math.max(1, Math.ceil(results.length / 50));
  const currentPage = Math.min(page, pages - 1);
  const connected = snapshot.profiles.filter(p => p.connection.state === "connected").length;
  const change = (patch: Partial<Draft>) => { setDraft(p => ({ ...p, ...patch })); setDirty(true); setDeletePending(false); setNotice(""); };
  const navigate = (action: () => void) => { if (busy) return; if (dirty) setDiscardAction(() => action); else action(); };
  const reset = (profile?: Profile, duplicate = false) => {
    if (passwordRef.current) passwordRef.current.value = "";
    setDraft(profile ? { id: duplicate ? null : profile.id, name: duplicate ? `${profile.name} copy` : profile.name, server: profile.server, username: profile.username, folder: profile.folder, notes: profile.notes } : { ...blank(), folder: folder ?? "" });
    setDirty(duplicate); setClearPassword(false); setDeletePending(false); setError(""); setNotice(duplicate ? "Copy created. Enter a password if you want to save it with this profile." : "");
  };
  const execute = async (action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (e) { if (mounted.current) setError(String(e)); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    const secret = passwordRef.current?.value || null;
    if (passwordRef.current) passwordRef.current.value = "";
    void execute(async () => {
      const id = await invoke<string>("pptp_save", { request: { ...draft, password: secret, clearPassword } });
      await refresh();
      if (mounted.current) { setDraft(p => ({ ...p, id })); setDirty(false); setClearPassword(false); setNotice("Profile saved."); }
    });
  };
  const connect = (profile: Profile, secret: string | null = null) => {
    if (!profile.hasPassword && secret === null) { setLoginId(profile.id); return; }
    void execute(async () => { await invoke("pptp_connect", { request: { id: profile.id, password: secret } }); if (mounted.current) setLoginId(null); await refresh(); });
  };
  const close = () => navigate(onClose);
  return <div className="palette-backdrop pptp-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialogRef} className="pptp-manager" role="dialog" aria-modal="true" aria-labelledby="pptp-manager-title" onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); if (loginId) setLoginId(null); else close(); }
      if (event.key === "Tab") {
        const scope = loginId ? dialogRef.current?.querySelector(".pptp-login") : dialogRef.current;
        const controls = scope?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
        const visible = controls ? [...controls].filter(el => el.getClientRects().length) : [];
        if (event.shiftKey && document.activeElement === visible[0]) { event.preventDefault(); visible.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === visible.at(-1)) { event.preventDefault(); visible[0]?.focus(); }
      }
    }}>
      <header className="pptp-heading"><div className="pptp-heading-icon"><Network size={22} /></div><div><h2 id="pptp-manager-title">PPTP manager</h2><p>{snapshot.profiles.length} profiles <span>·</span> {connected} connected</p></div><button className="outline-button" disabled={busy} onClick={() => navigate(() => reset())}><Plus size={14} /> New profile</button><button className="icon-button" aria-label="Close PPTP manager" onClick={close}><X size={18} /></button></header>
      {!native && <div className="pptp-message" role="status">Open Conxol desktop to save profiles and manage native PPTP connections.</div>}
      {native && !snapshot.supported && !loading && <div className="pptp-message">Profiles can be managed here. Native connections are available on Windows, Linux and macOS.</div>}
      {error && <div className="pptp-message pptp-error" role="alert">{error}<button className="icon-button" aria-label="Dismiss error" onClick={() => setError("")}><X size={14} /></button></div>}
      {discardAction && <div className="pptp-message" role="alert">Discard unsaved profile changes?<button className="outline-button" onClick={() => setDiscardAction(null)}>Keep editing</button><button className="outline-button" onClick={() => { const action = discardAction; setDiscardAction(null); action(); }}>Discard changes</button></div>}
      <div className="pptp-content">
        <nav className="pptp-folders" aria-label="PPTP folders"><span className="pptp-section-label">LIBRARY</span><button className={folder === null ? "selected" : ""} onClick={() => { setFolder(null); setPage(0); }}><Network size={14} /><span>All profiles</span><small>{snapshot.profiles.length}</small></button><button className={folder === "" ? "selected" : ""} onClick={() => { setFolder(""); setPage(0); }}><Folder size={14} /><span>Unfiled</span><small>{snapshot.profiles.filter(p => !p.folder).length}</small></button><span className="pptp-section-label">FOLDERS</span>{folders.map(name => <button key={name} title={name} className={folder === name ? "selected" : ""} onClick={() => { setFolder(name); setPage(0); }}><Folder size={14} /><span>{name}</span><small>{snapshot.profiles.filter(p => p.folder === name).length}</small></button>)}{!folders.length && <p>Use the folder field to organize your VPNs.</p>}</nav>
        <section className="pptp-browser" aria-label="Saved PPTP profiles"><div className="pptp-search"><Search size={15} /><input ref={searchRef} aria-label="Search PPTP profiles" placeholder="Search name, server, username…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /><select aria-label="Filter by connection status" value={stateFilter} onChange={e => { setStateFilter(e.target.value); setPage(0); }}><option value="all">All statuses</option><option value="active">Active</option><option value="connected">Connected</option><option value="disconnected">Disconnected</option><option value="error">Failed</option></select></div>
          <div className="pptp-list" aria-busy={loading}>{results.slice(currentPage * 50, currentPage * 50 + 50).map(profile => <div key={profile.id} className={`pptp-profile ${profile.id === draft.id ? "selected" : ""}`}>
            <button type="button" className="pptp-profile-select" aria-pressed={profile.id === draft.id} onClick={() => { if (profile.id !== draft.id) navigate(() => reset(profile)); }}><span className={`pptp-status-box ${profile.connection.state}`} role="img" aria-label={profile.connection.state === "connected" ? "Running" : labels[profile.connection.state]} title={profile.connection.state === "connected" ? "Running" : labels[profile.connection.state]}>{statusLetters[profile.connection.state]}</span><span className="pptp-profile-name"><strong>{profile.name}</strong><small>{profile.server} · {profile.username}</small>{profile.connection.state === "error" && <span className="pptp-row-error" role="status">{profile.connection.message || "Connection failed."}</span>}</span></button>
            <button type="button" className="outline-button pptp-row-action" aria-label={`${live(profile) ? profile.connection.state === "connecting" ? "Cancel connection to" : "Disconnect" : "Connect"} ${profile.name}`} title={profile.id === draft.id && dirty && !live(profile) ? "Save your changes before connecting" : undefined} disabled={!snapshot.supported || busy || profile.connection.state === "disconnecting" || (profile.id === draft.id && dirty && !live(profile))} onClick={() => live(profile) ? void execute(async () => { await invoke("pptp_disconnect", { id: profile.id }); await refresh(); }) : connect(profile)}>{profile.connection.state === "disconnecting" ? "Disconnecting…" : profile.connection.state === "connecting" ? "Cancel" : profile.connection.state === "connected" ? "Disconnect" : "Connect"}</button>
          </div>)}{!results.length && <div className="pptp-empty"><Network size={32} /><h3>{loading ? "Loading profiles…" : snapshot.profiles.length ? "No matching profiles" : "Your VPN library"}</h3><p>{snapshot.profiles.length ? "Try another search or folder." : "Add PPTP profiles and organize them into folders."}</p>{!snapshot.profiles.length && <button className="outline-button" disabled={busy} onClick={() => navigate(() => reset())}><Plus size={14} /> Add your first profile</button>}</div>}</div>
          <div className="pptp-pagination"><small>{results.length} {results.length === 1 ? "profile" : "profiles"}</small><button className="outline-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage + 1} / {pages}</span><button className="outline-button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></div>
        </section>
        <form className="pptp-editor" onSubmit={save} autoComplete="off"><div className="pptp-editor-title"><h3>{draft.id ? "Profile details" : "New profile"}</h3>{dirty && <small>Unsaved</small>}{selected && <button type="button" className="icon-button" title="Duplicate profile" aria-label="Duplicate profile" disabled={busy} onClick={() => navigate(() => reset(selected, true))}><Copy size={15} /></button>}</div>
          <fieldset disabled={busy || live(selected)}><label>Name<input required maxLength={160} value={draft.name} onChange={e => change({ name: e.target.value })} placeholder="e.g. Dhaka office" /></label><label>Server IPv4<input required maxLength={15} inputMode="decimal" value={draft.server} onChange={e => change({ server: e.target.value })} placeholder="192.0.2.10" /></label><label>Username<input required maxLength={256} autoComplete="off" value={draft.username} onChange={e => change({ username: e.target.value })} /></label><label>{selected?.hasPassword ? "Replace saved password" : "Password (optional)"}<input ref={passwordRef} type="password" maxLength={256} autoComplete="new-password" disabled={clearPassword} placeholder={selected?.hasPassword ? "Leave blank to keep saved password" : "Leave blank to enter when connecting"} onChange={() => { setDirty(true); setNotice(""); }} /></label>{selected?.hasPassword && <label className="pptp-checkbox"><input type="checkbox" checked={clearPassword} onChange={e => { setClearPassword(e.target.checked); setDirty(true); if (passwordRef.current) passwordRef.current.value = ""; }} /> Remove saved password</label>}<small className="pptp-hint">Saved passwords use your workspace PIN vault.</small><label>Folder<input list="pptp-folder-options" maxLength={160} value={draft.folder} onChange={e => change({ folder: e.target.value })} placeholder="Choose or create a folder" /><datalist id="pptp-folder-options">{folders.map(name => <option key={name} value={name} />)}</datalist></label><label>Notes<textarea rows={3} maxLength={4096} value={draft.notes} onChange={e => change({ notes: e.target.value })} placeholder="Site, purpose, or connection notes" /></label></fieldset>
          <div className="pptp-editor-actions"><button className="primary-button" type="submit" disabled={!native || busy || live(selected) || (draft.id !== null && !dirty)}>{busy ? "Working…" : "Save profile"}</button>{selected && <button className="icon-button pptp-delete" type="button" aria-label="Delete profile" title="Delete profile" disabled={busy || live(selected)} onClick={() => setDeletePending(true)}><Trash2 size={16} /></button>}</div>
          {notice && <p className="pptp-hint" role="status">{notice}</p>}
          {deletePending && selected && <div className="pptp-confirm" role="alert"><p>Delete “{selected.name}” and its saved password?</p><button type="button" className="outline-button" disabled={busy} onClick={() => setDeletePending(false)}>Cancel</button><button type="button" className="outline-button" disabled={busy} onClick={() => void execute(async () => { await invoke("pptp_delete", { id: selected.id }); await refresh(); if (mounted.current) reset(); })}>Delete profile</button></div>}
          {selected && <section className="pptp-connection" aria-label="Selected VPN connection"><div><ShieldCheck size={16} /><strong>{labels[selected.connection.state]}</strong></div>{selected.connection.state !== "error" && <p role="status">{selected.connection.message || "Use Connect on the profile row to open a private encrypted VPN."}</p>}{selected.connection.state === "connected" && <small>{selected.connection.sent} packets sent · {selected.connection.received} received</small>}{dirty && <small>Save your changes before connecting.</small>}</section>}
        </form>
      </div>
      <footer className="pptp-footer"><ShieldCheck size={14} /><span>Private to Conxol · {snapshot.supported ? "System permission is requested when needed for private PPTP traffic" : "Profiles can be organized on this platform"}</span><small>SSH sessions are not assigned automatically.</small></footer>
      {loginId && <div className="pptp-login"><form onSubmit={event => { event.preventDefault(); const secret = loginRef.current?.value; if (loginRef.current) loginRef.current.value = ""; const profile = snapshot.profiles.find(p => p.id === loginId); if (secret && profile) connect(profile, secret); }}><h3>Connect {snapshot.profiles.find(p => p.id === loginId)?.name}</h3><label>Password<input ref={loginRef} type="password" autoComplete="off" required maxLength={256} disabled={busy} /></label><p>This password is used for this connection only.</p><div><button type="button" className="outline-button" disabled={busy} onClick={() => setLoginId(null)}>Cancel</button><button className="primary-button" disabled={busy}>Connect</button></div></form></div>}
    </div>
  </div>;
}
