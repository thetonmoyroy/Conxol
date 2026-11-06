import { TftpServerPanel } from "./TftpServerPanel";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { X } from "lucide-react";

type Protocol = "ftp" | "ftps" | "tftp";
type Action = "list" | "download" | "upload";
type Result = { entries: string[]; bytes: number };
export function FileTransferClient({ onClose, onServerRunning, initialServer = false }: { onClose: () => void; onServerRunning: (running: boolean) => void; initialServer?: boolean }) {
  const [mode, setMode] = useState(initialServer ? "server" : "client");
  const [compatibility, setCompatibility] = useState(false);
  const [protocol, setProtocol] = useState<Protocol>("ftp");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("21");
  const [username, setUsername] = useState("anonymous");
  const password = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState("");
  const [plaintext, setPlaintext] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [entries, setEntries] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const active = useRef<string | null>(null);
  const alive = useRef(true);
  const cancelled = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement;
    form.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => {
      alive.current = false;
      if (active.current) void invoke("file_transfer_cancel", { id: active.current }).catch(() => {});
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const cancel = async () => { cancelled.current = true; if (active.current) { try { await invoke("file_transfer_cancel", { id: active.current }); } catch (e) { setError(String(e)); } } };
  const run = async (action: Action) => {
    if (active.current || !form.current?.reportValidity()) return;
    if (!isTauri()) { setError("FTP and TFTP are available in the desktop app."); return; }
    if (protocol !== "ftps" && !plaintext) { setError("Confirm the unencrypted connection before continuing."); return; }
    if (action !== "list" && (!path || path.endsWith("/"))) { setError("Enter the complete remote filename."); return; }
    if (action === "upload" && !overwrite) { setError("Confirm that uploading may replace the remote file."); return; }
    const id = crypto.randomUUID();
    cancelled.current = false;
    active.current = id;
    setBusy("Choosing local file…"); setError(""); setNotice("");
    try {
      let localPath: string | null = null;
      if (action === "download") localPath = await invoke<string | null>("local_pick_download_path", { kind: "file", suggestedName: path.split("/").pop() || "download.bin" });
      if (action === "upload") localPath = (await invoke<string[]>("local_pick_upload_paths", { kind: "file" }))[0] ?? null;
      if (!alive.current || cancelled.current || (action !== "list" && !localPath)) return;
      setBusy(action === "list" ? "Listing folder…" : action === "upload" ? "Uploading…" : "Downloading…");
      const result = await invoke<Result>("file_transfer_run", { request: {
        id, protocol, action, host: host.trim(), port: Number(port), username,
        password: password.current?.value ?? "", remotePath: path,
        localPath, allowPlaintext: plaintext, confirmUpload: overwrite, tftpCompatibility: compatibility,
      } });
      if (!alive.current) return;
      if (action === "list") { setEntries(result.entries); setNotice(`${result.entries.length} entries. Select a name, then open it as a folder or download it.`); }
      else setNotice(`${action === "upload" ? "Uploaded" : "Downloaded"} ${result.bytes.toLocaleString()} bytes successfully.`);
    } catch (e) { if (alive.current) setError(String(e)); }
    finally { active.current = null; if (alive.current) setBusy(""); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); if (mode === "server") return; void run(protocol === "tftp" ? "download" : "list"); };
  return <div className="palette-backdrop" onMouseDown={() => { if (!busy) onClose(); }}>
    <form ref={form} className="file-transfer-client" role="dialog" aria-modal="true" aria-labelledby="file-transfer-title" onSubmit={submit} onMouseDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape" && !busy) onClose(); }}>
      <div className="quick-connect-heading"><h2 id="file-transfer-title">FTP / TFTP</h2><button type="button" className="icon-button" aria-label="Close file transfer" disabled={!!busy} onClick={onClose}><X size={17} /></button></div>
      <div className="file-transfer-actions" role="tablist" aria-label="Transfer mode"><button type="button" role="tab" aria-selected={mode === "client"} disabled={!!busy} className={mode === "client" ? "primary-button" : "outline-button"} onClick={() => setMode("client")}>FTP / TFTP client</button><button type="button" role="tab" aria-selected={mode === "server"} disabled={!!busy} className={mode === "server" ? "primary-button" : "outline-button"} onClick={() => setMode("server")}>TFTP server</button></div>
      {mode === "server" ? <TftpServerPanel onRunning={onServerRunning} onBusy={setBusy} /> : <>
      <fieldset disabled={!!busy}>
        <div className="file-transfer-fields">
          <label>Protocol<select value={protocol} onChange={event => { const next = event.target.value as Protocol; setProtocol(next); setPort(next === "tftp" ? "69" : "21"); setEntries([]); setPlaintext(false); setOverwrite(false); if (password.current) password.current.value = ""; }}><option value="ftp">FTP</option><option value="ftps">FTP with TLS (FTPS)</option><option value="tftp">TFTP</option></select></label>
          <label className="file-transfer-host">Host<input required value={host} onChange={event => { setHost(event.target.value); setEntries([]); }} placeholder="Hostname or IP address" /></label>
          <label>Port<input type="number" required min={1} max={65535} value={port} onChange={event => setPort(event.target.value)} /></label>
        </div>
        {protocol !== "tftp" && <div className="file-transfer-login"><label>Username<input value={username} onChange={event => setUsername(event.target.value)} autoComplete="off" /></label><label>Password<input ref={password} type="password" autoComplete="new-password" /></label></div>}
        <label>Remote {protocol === "tftp" ? "filename" : "folder or filename"}<input value={path} onChange={event => { setPath(event.target.value); setEntries([]); }} placeholder={protocol === "tftp" ? "firmware.bin" : "Folder, or folder/file.bin"} /></label>
        <p>{protocol === "tftp" ? "TFTP transfers files by name; it cannot browse folders. Binary files up to 1 GiB; files beyond the device’s block-number limit require rollover support." : "FTP paths start in the login folder. FTPS uses explicit TLS with certificate verification. Files up to 1 GiB."} {protocol === "tftp" ? "TFTP transfers stop after 30 minutes." : "Transfers stop after 5 minutes."}</p>
        {protocol === "tftp" && <label className="file-transfer-check"><input type="checkbox" checked={compatibility} onChange={event => setCompatibility(event.target.checked)} />Compatibility mode: use 512-byte blocks for older devices.</label>}
        {protocol !== "ftps" && <label className="file-transfer-check"><input type="checkbox" checked={plaintext} onChange={event => setPlaintext(event.target.checked)} />I understand {protocol.toUpperCase()} is unencrypted{protocol === "ftp" ? " and sends my password in plain text" : " and has no login or server verification"}.</label>}
        <label className="file-transfer-check"><input type="checkbox" checked={overwrite} onChange={event => setOverwrite(event.target.checked)} />Allow upload to replace the remote file. Cancelling an upload may leave a partial file.</label>
        <div className="file-transfer-actions">{protocol !== "tftp" && <button type="submit" className="outline-button">List folder</button>}<button type="button" className="outline-button" onClick={() => void run("download")}>Download…</button><button type="button" className="outline-button" onClick={() => void run("upload")}>Upload…</button></div>
        {entries.length > 0 && <div className="file-transfer-list" aria-label="Remote folder entries">{entries.map((entry, index) => <button type="button" key={`${index}:${entry}`} onClick={() => { setPath(path.replace(/\/?$/, "/") + entry.split("/").pop()); setEntries([]); }} title="Select this name">{entry}</button>)}</div>}
      </fieldset>
      <div className="file-transfer-status" aria-live="polite">{busy || notice}</div>
      {error && <p className="connect-error-inline" role="alert">{error}</p>}
      </>}
      <div className="file-transfer-footer"><small>{mode === "server" ? "Only the selected file is shared." : "Downloads use a new local filename; existing local files are never replaced."}</small>{busy && mode === "client" ? <button type="button" className="outline-button" onClick={() => void cancel()}>Cancel transfer</button> : <button type="button" className="outline-button" disabled={!!busy} onClick={onClose}>Close</button>}</div>
    </form>
  </div>;
}
