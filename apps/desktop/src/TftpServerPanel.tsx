import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

type Status = { running: boolean; bindAddress: string; fileName: string; fileSize: number; activeTransfers: number; completedTransfers: number; bytesSent: number; message: string };
export function TftpServerPanel({ onRunning, onBusy }: { onRunning: (running: boolean) => void; onBusy: (busy: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [file, setFile] = useState("");
  const [bind, setBind] = useState("0.0.0.0");
  const [port, setPort] = useState("69");
  const [allowed, setAllowed] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [compatibility, setCompatibility] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const value = await invoke<Status>("tftp_server_status"); if (alive) { setStatus(value); onRunning(value.running); } }
      catch (e) { if (alive) setError(String(e)); }
      if (alive) timer = setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [onRunning]);
  const select = async () => {
    try { const paths = await invoke<string[]>("local_pick_upload_paths", { kind: "file" }); if (paths[0]) { setFile(paths[0]); setAcknowledged(false); } }
    catch (e) { setError(String(e)); }
  };
  const start = async () => {
    if (!file || !acknowledged || !Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) { setError("Choose a file, confirm sharing, and enter a port from 1 to 65535."); return; }
    setPending(true); onBusy("Preparing TFTP server…"); setError("");
    try {
      const result = await invoke<Status>("tftp_server_start", { request: { localPath: file, bindAddress: bind.trim(), port: Number(port), allowedClient: allowed.trim() || null, allowUnencrypted: acknowledged, compatibility } });
      setStatus(result); onRunning(result.running);
    } catch (e) { setError(String(e)); }
    finally { setPending(false); onBusy(""); }
  };
  const stop = async () => {
    setPending(true); onBusy("Stopping TFTP server…"); setError("");
    try { await invoke("tftp_server_stop"); setStatus(null); onRunning(false); }
    catch (e) { setError(String(e)); }
    finally { setPending(false); onBusy(""); }
  };
  const running = status?.running ?? false;
  return <div className="tftp-server-panel">
    <p>Let a switch or router download a file from this PC. Choose a file, start the server, then request the filename shown below from your device.</p>
    <fieldset disabled={pending || running}>
      <label>File to share<div className="tftp-shared-file"><input readOnly value={file} placeholder="Choose firmware or another file (up to 1 GiB)" /><button type="button" className="outline-button" onClick={() => void select()}>Choose file…</button></div></label>
      <div className="file-transfer-fields tftp-listen-fields"><label className="file-transfer-host">Listen address<input value={bind} onChange={event => setBind(event.target.value)} placeholder="0.0.0.0 for all IPv4 interfaces" /></label><label>Port<input type="number" min={1} max={65535} value={port} onChange={event => setPort(event.target.value)} /></label><label>Allowed device IP (optional)<input value={allowed} onChange={event => setAllowed(event.target.value)} placeholder="Any reachable device" /></label></div>
      <label className="file-transfer-check"><input type="checkbox" checked={compatibility} onChange={event => setCompatibility(event.target.checked)} />Compatibility mode: use 512-byte blocks for older devices.</label>
      <label className="file-transfer-check"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />Share this selected file over unencrypted TFTP. Devices that can reach this server can download it{allowed.trim() ? " only from the allowed IP" : ""}.</label>
    </fieldset>
    {running && status && <div className="tftp-server-details" role="status"><strong>Server running · {status.bindAddress}</strong><div>Request filename: <code>{status.fileName}</code></div><div>File size: {status.fileSize.toLocaleString()} bytes · Active: {status.activeTransfers} · Completed: {status.completedTransfers}</div><div>Sent: {status.bytesSent.toLocaleString()} bytes · {status.message}</div></div>}
    <p>Use this PC’s IP address that your router can reach{port !== "69" ? ` and UDP port ${port}` : ""}. Read-only: uploads and other files are refused. Allow inbound TFTP and its UDP transfer ports if your firewall asks.</p>
    <p>The server keeps running when you close this window. Stop it here when finished; exiting Conxol stops it automatically.</p>
    {error && <p className="connect-error-inline" role="alert">{error}</p>}
    <div className="file-transfer-actions"><button type="button" className="primary-button" disabled={pending || running || !isTauri() || !file || !acknowledged} onClick={() => void start()}>Start server</button><button type="button" className="outline-button" disabled={pending || (!running && !status)} onClick={() => void stop()}>Stop server</button><span aria-live="polite">{pending ? "Working…" : running ? "Listening" : "Stopped"}</span></div>
  </div>;
}
