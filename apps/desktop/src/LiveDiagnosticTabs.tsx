import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Play, Plus, Square, X } from "lucide-react";
import { PptpAttachment } from "./PptpAttachment";
import { writeClipboardText } from "./clipboard-access";
import { useDiagnosticAutosave, type DiagnosticLogRun } from "./diagnostic-autosave";
import { diagnosticTabsReducer, LiveDiagnosticRun, MAX_DIAGNOSTIC_TABS, type DiagnosticTabsState, type LiveDiagnosticKind } from "./live-diagnostic-run";

type PingResult = { host: string; sent: number; received: number; elapsedMs: number; intervalMs: number; packetSize: number; lines: string[] };
type MtrResult = { host: string; reached: boolean; hops: string[]; elapsedMs: number };
type DiagnosticEvent = { operationId: string; kind: LiveDiagnosticKind; state: "running" | "completed" | "cancelled" | "failed"; ping?: PingResult | null; traceroute?: MtrResult | null; error?: string | null };

function initialTabs(): DiagnosticTabsState {
  const mtr = crypto.randomUUID(), ping = crypto.randomUUID();
  return { tabs: [{ id: mtr, kind: "mtr", number: 1, target: "", state: "idle" }, { id: ping, kind: "ping", number: 1, target: "", state: "idle" }], active: { mtr, ping } };
}

export function LiveDiagnosticTabs({ kind, visible, defaultTimeout, stopGeneration }: {
  kind: LiveDiagnosticKind; visible: boolean; defaultTimeout: string; stopGeneration: number;
}) {
  const [tabs, dispatch] = useReducer(diagnosticTabsReducer, undefined, initialTabs);
  const update = useCallback((id: string, target: string, state: string) => dispatch({ type: "update", id, target, state }), []);
  return <div className="live-diagnostic-workspace" hidden={!visible}>
    <div className="diagnostics-instance-tabs" aria-label={`${kind.toUpperCase()} instances`}>
      {tabs.tabs.filter(tab => tab.kind === kind).map(tab => <div key={tab.id} className={`diagnostics-instance-tab ${tabs.active[kind] === tab.id ? "selected" : ""}`}>
        <button type="button" aria-pressed={tabs.active[kind] === tab.id} onClick={() => dispatch({ type: "select", id: tab.id })} title={`${tab.kind.toUpperCase()} ${tab.number} · ${tab.target || "New target"} · ${tab.state}`}>
          <span className={`diagnostics-instance-state ${tab.state}`} aria-hidden="true" />{tab.target || `${tab.kind.toUpperCase()} ${tab.number}`}<small>{tab.state}</small>
        </button>
        <button type="button" aria-label={`Close ${tab.kind.toUpperCase()} ${tab.number}${tab.target ? ` for ${tab.target}` : ""}`} title="Close tab and stop its test" onClick={() => dispatch({ type: "close", id: tab.id })}><X size={13} /></button>
      </div>)}
      <button type="button" className="diagnostics-add-instance" disabled={tabs.tabs.length >= MAX_DIAGNOSTIC_TABS} onClick={() => dispatch({ type: "add", kind, id: crypto.randomUUID() })} title={`Up to ${MAX_DIAGNOSTIC_TABS} MTR and Ping tabs`}><Plus size={14} />New {kind.toUpperCase()}</button>
    </div>
    {!tabs.tabs.some(tab => tab.kind === kind) && <p className="diagnostics-instance-empty">Open a new {kind.toUpperCase()} tab to start a test.</p>}
    {tabs.tabs.map(tab => <div key={tab.id} className="diagnostics-instance-panel" hidden={!visible || tab.kind !== kind || tabs.active[tab.kind] !== tab.id}>
      <LiveDiagnosticInstance id={tab.id} kind={tab.kind} defaultTimeout={defaultTimeout} stopGeneration={stopGeneration} onUpdate={update} />
    </div>)}
  </div>;
}

function LiveDiagnosticInstance({ id, kind, defaultTimeout, stopGeneration, onUpdate }: {
  id: string; kind: LiveDiagnosticKind; defaultTimeout: string; stopGeneration: number;
  onUpdate: (id: string, target: string, state: string) => void;
}) {
  const [host, setHost] = useState("");
  const [route, setRoute] = useState("");
  const [timeout, setTimeoutValue] = useState(defaultTimeout);
  const [interval, setIntervalValue] = useState("1000");
  const [packetSize, setPacketSize] = useState("32");
  const [maxHops, setMaxHops] = useState("8");
  const [state, setState] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [ping, setPing] = useState<PingResult | null>(null);
  const [mtr, setMtr] = useState<MtrResult | null>(null);
  const [run, setRun] = useState<DiagnosticLogRun | null>(null);
  const [ready, setReady] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [follow, setFollow] = useState(true);
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const controller = useRef(new LiveDiagnosticRun());
  const outputRef = useRef<HTMLPreElement>(null);
  const stopToken = useRef(stopGeneration);
  const busy = state === "running";

  const cancel = useCallback(async (operationId: string) => {
    try {
      if (await invoke<boolean>("network_diagnostic_cancel", { operationId })) controller.current.acknowledgeCancel(operationId);
    } catch (error) {
      if (!controller.current.disposed) { setError(`Could not stop this test: ${String(error)}`); setStopping(false); }
    }
  }, []);
  const stop = useCallback(() => {
    const operationId = controller.current.requestStop();
    if (operationId) { setStopping(true); void cancel(operationId); }
  }, [cancel]);

  useEffect(() => {
    controller.current.disposed = false;
    const owner = controller.current;
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void listen<DiagnosticEvent>("network://diagnostic", ({ payload }) => {
      if (payload.kind !== kind || !owner.accepts(payload.operationId)) return;
      setState(payload.state);
      if (payload.ping) setPing(payload.ping);
      if (payload.traceroute) setMtr(payload.traceroute);
      if (payload.state !== "running") {
        owner.finish(payload.operationId); setStopping(false);
        setError(payload.state === "failed" ? payload.error ?? "Diagnostic failed." : null);
      } else if (owner.shouldCancel(payload.operationId)) void cancel(payload.operationId);
    }).then(stop => {
      if (disposed) stop();
      else { unlisten = stop; setReady(true); }
    }).catch(error => { if (!disposed) setError(`Diagnostic updates are unavailable: ${String(error)}`); });
    return () => {
      disposed = true; unlisten?.();
      const operationId = owner.dispose();
      if (operationId) void cancel(operationId);
    };
  }, [cancel, kind]);
  useEffect(() => {
    if (stopToken.current !== stopGeneration) { stopToken.current = stopGeneration; stop(); }
  }, [stopGeneration, stop]);
  useEffect(() => { onUpdate(id, host.trim(), state); }, [id, host, state, onUpdate]);

  const lines = [route ? `Route: private PPTP profile ${route}` : "Route: direct network", "", kind === "mtr" ? "MTR / PACKET LOSS & LATENCY" : "PING", ""];
  if (kind === "mtr" && mtr) lines.push(`Target: ${mtr.host}    Elapsed: ${(mtr.elapsedMs / 1000).toFixed(1)} s`, "", ...mtr.hops);
  else if (kind === "ping" && ping) lines.push(`Target: ${ping.host}    Payload: ${ping.packetSize} bytes    Interval: ${ping.intervalMs} ms`, "", ...ping.lines, "",
    `Sent: ${ping.sent}    Successful probes: ${ping.received}    Loss: ${ping.sent ? ((ping.sent - ping.received) / ping.sent * 100).toFixed(1) : "0.0"}%    Elapsed: ${(ping.elapsedMs / 1000).toFixed(1)} s`);
  else lines.push(busy ? "Connecting and waiting for probe results…" : "Enter a target, choose a route, then press Run.");
  if (state === "cancelled") lines.push("", "Stopped.");
  if (error) lines.push("", `ERROR: ${error}`);
  const output = lines.join("\n");
  const saveNotice = useDiagnosticAutosave({ run, output, state, busy, error }, true);
  useEffect(() => { if (follow && outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight; }, [follow, output]);

  const start = async () => {
    if (!ready || !controller.current.finished) return;
    const timeoutMs = Number(timeout), intervalMs = Number(interval), size = Number(packetSize), hops = Number(maxHops);
    if (!host.trim() || !Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 60000) {
      setError("Enter a target and timeout between 50 and 60000 ms."); return;
    }
    if (kind === "ping" && (!Number.isInteger(intervalMs) || intervalMs < 200 || intervalMs > 60000 || !Number.isInteger(size) || size < 0 || size > (route ? 1422 : 65500) || !packetSize.trim())) {
      setError("Enter a valid Ping interval and packet size within the displayed limits."); return;
    }
    if (kind === "mtr" && (!Number.isInteger(hops) || hops < 1 || hops > 32)) { setError("Max hops must be between 1 and 32."); return; }
    const operationId = crypto.randomUUID();
    const owner = controller.current;
    if (!owner.begin(operationId)) return;
    setRun({ id: operationId, tool: kind, target: host.trim(), route: route ? `PPTP profile ${route}` : "Direct network" });
    setState("running"); setStopping(false); setError(null); setPing(null); setMtr(null); setNotice(""); setFollow(true);
    try {
      const request = { operationId, host: host.trim(), pptpProfileId: route || undefined, timeoutMs,
        ...(kind === "ping" ? { intervalMs, packetSize: size } : { maxHops: hops }) };
      const response = await invoke<{ operationId: string }>(`network_${kind}_start`, { request });
      if (response.operationId !== operationId) throw new Error("Diagnostic operation ID did not match this tab.");
      // A tab may have been stopped/closed while its tunnel was connecting.
      if (owner.shouldCancel(operationId)) await cancel(operationId);
    } catch (error) {
      if (owner.accepts(operationId)) { owner.finish(operationId); setState("failed"); setStopping(false); setError(String(error)); }
    }
  };

  return <div className="diagnostics-instance-content">
    {!/Android/i.test(navigator.userAgent) && <div className="diagnostics-cli-controls diagnostics-pptp-route"><PptpAttachment diagnostics value={route} onChange={value => {
      setRoute(value); setPing(null); setMtr(null); setError(null); setState("idle"); setRun(null);
    }} disabled={busy} /></div>}
    <form className="diagnostics-cli-controls" onSubmit={event => { event.preventDefault(); void start(); }}>
      <label className="diagnostics-cli-host">Target<input required value={host} disabled={busy} onChange={event => setHost(event.target.value)} placeholder="Hostname or IP address" /></label>
      {kind === "mtr" ? <label>Max hops<input type="number" min="1" max="32" required value={maxHops} disabled={busy} onChange={event => setMaxHops(event.target.value)} /></label> : <>
        <label>Interval (ms)<input type="number" min="200" max="60000" required value={interval} disabled={busy} onChange={event => setIntervalValue(event.target.value)} /></label>
        <label>Packet (bytes)<input type="number" min="0" max={route ? 1422 : 65500} required value={packetSize} disabled={busy} onChange={event => setPacketSize(event.target.value)} /></label>
      </>}
      <label>Timeout (ms)<input type="number" min="50" max="60000" required value={timeout} disabled={busy} onChange={event => setTimeoutValue(event.target.value)} /></label>
      {busy ? <button type="button" className="outline-button" disabled={stopping} onClick={stop}><Square size={14} />{stopping ? "Stopping…" : "Stop"}</button> : <button type="submit" className="primary-button" disabled={!ready}><Play size={14} />Run</button>}
    </form>
    <div className="diagnostics-cli-console">
      <div className="diagnostics-cli-console-bar"><span>{kind.toUpperCase()} / {state}</span><div>
        <button type="button" aria-pressed={follow} onClick={() => setFollow(value => !value)}>Follow {follow ? "on" : "off"}</button>
        <button type="button" onClick={() => { void writeClipboardText(output).then(() => setNotice("Copied"), () => setNotice("Copy failed")); }}>Copy output</button>
        <button type="button" disabled={exporting} onClick={() => {
          setExporting(true);
          void invoke<boolean>("network_diagnostic_output_export", { tool: kind, content: output })
            .then(saved => { if (saved) setNotice("Text output saved."); })
            .catch(() => setNotice("Could not export output.")).finally(() => setExporting(false));
        }}>{exporting ? "Saving…" : "Export text"}</button>
      </div></div>
      {(notice || saveNotice.startsWith("Could not")) && <p className="diagnostics-export-notice" role="status">{notice || saveNotice}</p>}
      {!isTauri() && <p className="diagnostics-export-notice">Run diagnostics in the desktop app.</p>}
      <pre ref={outputRef} className="diagnostics-cli-output" tabIndex={0} aria-label={`${kind.toUpperCase()} output`} onScroll={event => {
        const element = event.currentTarget;
        if (element.scrollHeight - element.scrollTop - element.clientHeight > 40) setFollow(false);
      }}>{output}</pre>
    </div>
  </div>;
}
