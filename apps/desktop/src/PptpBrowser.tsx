import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronRight, CodeXml, Globe2, Home, LoaderCircle, Network, PanelRightClose, Plus, Radio, RotateCw, Search, ShieldCheck, Trash2, TriangleAlert, X } from "lucide-react";
import { browserDestination } from "./pptp-browser-url";
import "./PptpBrowser.css";

type Trace = { sequence: number; host: string; ip: string; port: number; stage: string; detail: string; elapsedMs: number };
type BrowserTab = { id: string; url: string; title: string; loading: boolean };
type Snapshot = { navigationError: string; httpStatus: number | null; devtoolsAvailable: boolean; activeTab: string; tabs: BrowserTab[]; url: string; title: string; profileId: string; profileName: string; tunnelServer: string; loading: boolean; diagnostics: boolean; error: string; events: Trace[] };
const initial: Snapshot = { navigationError: "", httpStatus: null, devtoolsAvailable: false, activeTab: "preview", tabs: [{ id: "preview", url: "https://www.google.com", title: "New tab", loading: false }], url: "https://www.google.com", title: "New page", profileId: "", profileName: "PPTP connection", tunnelServer: "", loading: true, diagnostics: true, error: "", events: [] };
const key = (event: Trace) => `${event.host}:${event.port}`;

export function PptpBrowser() {
  const native = isTauri();
  const [snapshot, setSnapshot] = useState(initial);
  const [input, setInput] = useState(initial.url);
  const [error, setError] = useState("");
  const [filterErrors, setFilterErrors] = useState(false);
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const operation = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.getElementById("startup-screen")?.remove();
    document.documentElement.classList.add("pptp-browser-window");
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await invoke<Snapshot>("pptp_browser_snapshot");
        if (active) { setSnapshot(next); if (!editingRef.current) setInput(next.url); }
      } catch (e) { if (active) setError(String(e)); }
      finally { if (active) timer = setTimeout(() => void poll(), 500); }
    };
    if (native) void poll();
    else setSnapshot({ ...initial, loading: false, title: "Browser preview" });
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") { event.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); }
    };
    window.addEventListener("keydown", shortcut);
    return () => { active = false; clearTimeout(timer); window.removeEventListener("keydown", shortcut); document.documentElement.classList.remove("pptp-browser-window"); };
  }, [native]);
  const control = async (action: string, tabId?: string) => {
    if (operation.current) return;
    operation.current = true; setBusy(true);
    try {
      if (native) {
        await invoke("pptp_browser_control", { action, tabId: tabId ?? null });
        const next = await invoke<Snapshot>("pptp_browser_snapshot");
        setSnapshot(next);
        if (action === "new_tab" || action === "select_tab" || action === "close_tab") { inputRef.current?.blur(); setInput(next.url); }
      }
      else if (action === "diagnostics") setSnapshot(previous => ({ ...previous, diagnostics: !previous.diagnostics }));
      setError("");
    } catch (e) { setError(String(e)); }
    finally { operation.current = false; setBusy(false); }
  };
  const open = async (value: string) => {
    const url = browserDestination(value);
    try {
      if (native) await invoke("pptp_browser_navigate", { url });
      setInput(url); setSnapshot(previous => ({ ...previous, url, loading: native, error: "" })); setError(""); inputRef.current?.blur();
    } catch (e) { setError(String(e)); }
  };
  const navigate = (event: FormEvent) => { event.preventDefault(); void open(input); };
  const latest = [...new Map(snapshot.events.map(event => [key(event), event])).values()].reverse();
  const failures = snapshot.events.filter(event => event.stage === "Failed");
  const connections = filterErrors ? latest.filter(event => event.stage === "Failed") : latest;
  const selectedEvents = snapshot.events.filter(event => key(event) === selected);
  const target = latest.find(event => { try { return event.host === new URL(snapshot.url).hostname; } catch { return false; } });
  const mainFailed = !!snapshot.navigationError || target?.stage === "Failed";
  const pageError = error || snapshot.navigationError || (target?.stage === "Failed" ? target.detail : "");
  const status = mainFailed ? "Connection failed" : snapshot.loading ? "Loading page" : "Page idle";
  return <div className="pptp-browser-shell">
    <header className="pb-chrome">
      <div className="pb-tabstrip"><div className="pb-tabs" role="tablist" aria-label="Browser tabs">{snapshot.tabs.map(tab => <div className={`pb-tab ${tab.id === snapshot.activeTab ? "active" : ""}`} key={tab.id}><button type="button" role="tab" aria-selected={tab.id === snapshot.activeTab} disabled={busy} title={tab.url} onClick={() => void control("select_tab", tab.id)}>{tab.loading ? <LoaderCircle className="pb-spin" size={14} /> : <Globe2 size={14} />}<span>{tab.title || "New tab"}</span></button><button className="pb-tab-close" disabled={busy} aria-label={`Close ${tab.title || "tab"}`} title="Close tab" onClick={() => void control("close_tab", tab.id)}><X size={12} /></button></div>)}</div><button className="pb-icon pb-new-tab" title="New tab" aria-label="New tab" disabled={busy || snapshot.tabs.length >= 12} onClick={() => void control("new_tab")}><Plus size={16} /></button><span className="pb-private"><ShieldCheck size={12} /> Private tunnel</span><span className="pb-profile" title={snapshot.profileName}>{snapshot.profileName}</span></div>
      <form className="pb-navigation" onSubmit={navigate}>
        <button type="button" className="pb-icon" title="Back" aria-label="Back" onClick={() => void control("back")}><ArrowLeft size={17} /></button>
        <button type="button" className="pb-icon" title="Forward" aria-label="Forward" onClick={() => void control("forward")}><ArrowRight size={17} /></button>
        <button type="button" className="pb-icon" title={snapshot.loading ? "Stop loading" : "Reload"} aria-label={snapshot.loading ? "Stop loading" : "Reload"} onClick={() => void control(snapshot.loading ? "stop" : "reload")}>{snapshot.loading ? <X size={16} /> : <RotateCw size={16} />}</button>
        <button type="button" className="pb-icon" title="Google home" aria-label="Google home" onClick={() => void open("https://www.google.com")}><Home size={16} /></button>
        <label className={`pb-address ${editing ? "focused" : ""}`}><Search size={15} /><input ref={inputRef} aria-label="URL or Google search" spellCheck={false} autoComplete="off" maxLength={8192} value={input} onFocus={() => { editingRef.current = true; setEditing(true); }} onBlur={() => { editingRef.current = false; setEditing(false); }} onChange={event => setInput(event.target.value)} placeholder="Search Google or enter an address" /><button type="submit" className="pb-icon" title="Navigate" aria-label="Navigate"><ArrowUpRight size={16} /></button></label>
        <button type="button" className={`pb-inspect-toggle ${snapshot.diagnostics ? "active" : ""}`} aria-pressed={snapshot.diagnostics} title="Show network inspector" onClick={() => void control("diagnostics")}><Network size={15} /><span>Inspect</span>{failures.length > 0 && <b>{failures.length}</b>}</button>
      </form>
      {snapshot.loading && <div className="pb-progress" />}
    </header>
    {!native && <div className="pb-preview"><Globe2 size={40} /><h2>Your private browsing workspace</h2><p>Open this browser from a connected PPTP profile in Conxol desktop.</p></div>}
    {snapshot.diagnostics && <aside className="pb-inspector" aria-label="Network inspector">
      <div className="pb-inspector-heading"><div><span className="pb-eyebrow">CONNECTION DETAILS</span><h2>Network inspector</h2></div><button className="pb-icon" aria-label="Close network inspector" title="Close inspector" onClick={() => void control("diagnostics")}><PanelRightClose size={17} /></button></div>
      <section className="pb-route"><div className="pb-route-heading"><ShieldCheck size={16} /><strong>{snapshot.profileName}</strong><span>IPv4</span></div><div className="pb-route-path"><span>Browser</span><ChevronRight size={12} /><span>PPTP tunnel</span><ChevronRight size={12} /><span>Destination</span></div><dl><dt>VPN server</dt><dd>{snapshot.tunnelServer || "Waiting for connection"}</dd><dt>DNS resolver</dt><dd>8.8.8.8 · through PPTP</dd><dt>Direct fallback</dt><dd>Disabled</dd></dl></section>
      <section className={`pb-page-status ${mainFailed ? "failed" : ""}`}><div>{mainFailed ? <TriangleAlert size={15} /> : snapshot.loading ? <LoaderCircle className="pb-spin" size={15} /> : <Globe2 size={15} />}<strong>{status}</strong><button className="pb-icon" title="Retry current URL" aria-label="Retry current URL" onClick={() => void open(snapshot.url)}><RotateCw size={14} /></button></div><p title={snapshot.url}>{snapshot.url}</p><dl><dt>HTTP status</dt><dd>{snapshot.httpStatus ?? "Waiting for response"}</dd><dt>Destination IP</dt><dd>{target?.ip || "Not resolved yet"}{target?.ip && `:${target.port}`}</dd></dl>{mainFailed && <p className="pb-error-detail">{snapshot.navigationError || target?.detail}</p>}</section>
      {pageError && <div className="pb-error" role="alert"><TriangleAlert size={15} /><span>{pageError}</span></div>}
      <div className="pb-requests-heading"><h3>All tabs <span>{latest.length}</span></h3><button className={`pb-filter ${filterErrors ? "active" : ""}`} aria-pressed={filterErrors} onClick={() => setFilterErrors(value => !value)}>Errors {failures.length}</button><button className="pb-icon" aria-label="Clear connection log" title="Clear connection log" onClick={() => void control("clear")}><Trash2 size={14} /></button></div>
      <div className="pb-request-list">{connections.length === 0 ? <div className="pb-empty"><Radio size={24} /><strong>{filterErrors ? "No failed connections" : "Waiting for traffic"}</strong><p>{filterErrors ? "Connection errors will appear here." : "DNS results, destination IPs and failures appear as the page connects."}</p></div> : connections.map(event => <button key={key(event)} className={`pb-request ${event.stage === "Failed" ? "failed" : ""} ${selected === key(event) ? "selected" : ""}`} onClick={() => setSelected(selected === key(event) ? "" : key(event))}><span className="pb-request-icon">{event.stage === "Failed" ? <TriangleAlert size={14} /> : event.stage === "Connected" || event.stage === "Closed" ? <Check size={14} /> : <LoaderCircle className="pb-spin" size={14} />}</span><span className="pb-request-text"><strong>{event.host}<em>:{event.port}</em></strong><small>{event.ip || "Resolving IPv4…"}</small></span><span className="pb-request-result">{event.stage}<small>{event.elapsedMs} ms</small></span></button>)}</div>
      {selectedEvents.length > 0 && <section className="pb-timeline"><h3>{selected} <button className="pb-icon" aria-label="Close connection details" onClick={() => setSelected("")}><X size={13} /></button></h3>{selectedEvents.map(event => <div key={event.sequence} className={event.stage === "Failed" ? "failed" : ""}><span>{event.stage}<small>{event.elapsedMs} ms</small></span><p>{event.detail}</p></div>)}</section>}
      {snapshot.devtoolsAvailable && <button className="pb-devtools" onClick={() => void control("devtools")}><CodeXml size={15} /><span>Developer tools</span><small>Console · Network · Elements</small></button>}
      <p className="pb-inspector-footnote">Transport diagnostics · HTTPS content stays encrypted. Use Developer tools for page scripts and individual resource URLs. The connection log covers all tabs.</p>
    </aside>}
    <footer className="pb-statusbar"><span className={mainFailed ? "pb-status-error" : ""}>{mainFailed ? <TriangleAlert size={12} /> : <ShieldCheck size={12} />}{native ? status : "Desktop preview"}</span><span>{target?.ip ? `${target.ip}:${target.port}` : "IPv4 through PPTP"}</span><span className="pb-status-route">{snapshot.profileName} · No direct fallback</span>{error && !snapshot.diagnostics && <button onClick={() => void control("diagnostics")}>Show error details</button>}</footer>
  </div>;
}
