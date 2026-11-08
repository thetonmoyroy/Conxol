import { literalInputProps } from "./literal-input";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download, Upload, ShieldCheck, ArrowLeft, ArrowRight, FileArchive, LockKeyhole, CheckCircle2, AlertCircle } from "lucide-react";
import "./workspace-backup.css";
import { captureWorkspacePreferences, applyWorkspacePreferences } from "./workspace-backup-model";
type Preferences = { workspaceId: string; preferences: Record<string, string> };
type Preview = { token: string; sessions: number; notes: number; shortcuts: number; macros: number; credentials: number; keyFiles: number };
export function WorkspaceBackup({ canRestore }: { canRestore: boolean }) {
  const [mode, setMode] = useState<"backup" | "restore" | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ token: string; name: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [committed, setCommitted] = useState(false);
  const password = useRef<HTMLInputElement>(null), confirmation = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  const gate = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (pending.current) void invoke("workspace_backup_cancel").catch(() => {}); }; }, []);
  function clear() { if (password.current) password.current.value = ""; if (confirmation.current) confirmation.current.value = ""; }
  async function open(event: FormEvent) {
    event.preventDefault(); if (gate.current) return;
    if (mode === "restore" && !selectedFile) { setError("Choose a backup file first."); return; }
    const secret = password.current?.value ?? "", repeat = confirmation.current?.value;
    setError(""); setMessage("");
    if ([...secret].length < 8 || new TextEncoder().encode(secret).length > 1024) { setError("Use a backup password of at least 8 characters (up to 1024 bytes)."); return; }
    if (mode === "backup" && secret !== repeat) { setError("The passwords do not match."); return; }
    gate.current = true; setBusy(true); clear();
    try {
      if (mode === "backup") {
        const saved = await invoke<boolean>("workspace_backup_export", { request: { password: secret, preferences: captureWorkspacePreferences() } });
        if (mounted.current) { setMessage(saved ? "Encrypted workspace backup saved. Keep its password safe; it cannot be recovered." : "Backup cancelled."); if (saved) setMode(null); }
      } else {
        const result = await invoke<Preview | null>("workspace_backup_inspect", { request: { password: secret, selectionToken: selectedFile!.token } });
        if (!mounted.current) { await invoke("workspace_backup_cancel"); return; }
        pending.current = !!result; setPreview(result); if (!result) setMessage("Restore cancelled.");
      }
    } catch (cause) { if (mounted.current) setError(String(cause)); }
    finally { gate.current = false; if (mounted.current) setBusy(false); }
  }
  async function chooseFile() {
    if (gate.current) return;
    gate.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const selected = await invoke<{ token: string; name: string } | null>("workspace_backup_choose");
      if (!mounted.current) { await invoke("workspace_backup_cancel"); return; }
      if (selected) { setSelectedFile(selected); pending.current = true; clear(); }
    } catch (cause) { if (mounted.current) setError(String(cause)); }
    finally { gate.current = false; if (mounted.current) setBusy(false); }
  }
  async function cancel() {
    if (gate.current) return; clear();
    try { await invoke("workspace_backup_cancel"); pending.current = false; setPreview(null); setSelectedFile(null); setMode(null); setError(""); } catch (cause) { setError(String(cause)); }
  }
  async function restart() { await invoke("workspace_backup_restart"); }
  async function restore() {
    if (!preview || !canRestore || gate.current) return;
    gate.current = true; setBusy(true); setError("");
    try {
      const restored = await invoke<Preferences>("workspace_backup_restore", { token: preview.token });
      pending.current = false; setCommitted(true);
      // Native startup can recover these preferences as well if browser storage fails.
      try { applyWorkspacePreferences(restored); } catch { /* Recover on next launch. */ }
      await restart();
    } catch (cause) { setError(String(cause)); }
    finally { gate.current = false; if (mounted.current) setBusy(false); }
  }
  return <div className="settings-section workspace-backup">
    <header className="workspace-backup-heading"><span className="workspace-backup-symbol"><ShieldCheck size={20} /></span><div><h3>Workspace backup</h3><p>Keep everything you’ve saved in one encrypted file.</p></div><span className="workspace-backup-badge"><LockKeyhole size={11} /> Encrypted</span></header>
    <p className="workspace-backup-includes">Sessions & passwords <span>·</span> Notes & shortcuts <span>·</span> Macros <span>·</span> Settings & SSH keys</p>
    {!mode && <div className="workspace-backup-choices">
      <button type="button" className="workspace-backup-choice" onClick={() => { setMode("backup"); setError(""); setMessage(""); }}><span className="workspace-backup-choice-icon"><Download size={20} /></span><span><strong>Create a backup</strong><small>Save a password-protected copy of this workspace.</small><b>Get started <ArrowRight size={12} /></b></span></button>
      <button type="button" className="workspace-backup-choice" onClick={() => { setMode("restore"); setError(""); setMessage(""); }}><span className="workspace-backup-choice-icon"><Upload size={20} /></span><span><strong>Restore a workspace</strong><small>Open a saved backup on this computer.</small><b>Choose a backup <ArrowRight size={12} /></b></span></button>
    </div>}
    {mode && !preview && <div className="workspace-backup-card">
      <div className="workspace-backup-card-heading"><h4>{mode === "backup" ? "Create encrypted backup" : "Restore from a backup"}</h4><span>{mode === "backup" ? "1. Protect  →  2. Save" : "1. Choose file  →  2. Unlock"}</span></div>
      <div className="workspace-backup-form">
        {mode === "restore" && <div className="workspace-backup-file"><label htmlFor="workspace-backup-filename">Backup file</label><div className={`workspace-backup-file-control ${selectedFile ? "has-file" : ""}`}><FileArchive size={18} /><input id="workspace-backup-filename" readOnly value={selectedFile?.name ?? ""} placeholder="No backup selected" aria-label="Selected backup file" /><button type="button" className="outline-button" disabled={busy} onClick={() => void chooseFile()}>{selectedFile ? "Change file" : "Choose file…"}</button></div><small>Conxol backup (.cxb) · Stays on this computer</small></div>}
        <label className={mode === "restore" ? "workspace-backup-password-wide" : undefined}>{mode === "backup" ? "Backup password" : "Unlock password"}<input {...literalInputProps} ref={password} type="password" placeholder={mode === "backup" ? "At least 8 characters" : "Password used to create this backup"} autoComplete={mode === "backup" ? "new-password" : "off"} disabled={busy} aria-label="Workspace backup password" onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void open(event); } }} /></label>
        {mode === "backup" && <label>Confirm password<input {...literalInputProps} ref={confirmation} type="password" placeholder="Enter password again" autoComplete="new-password" disabled={busy} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void open(event); } }} /></label>}
        <p className="workspace-backup-helper"><LockKeyhole size={13} /> {mode === "backup" ? "Keep this password safe. You’ll need it to restore your backup." : "We’ll verify your backup before making any changes."}</p>
      </div>
      <div className="workspace-backup-footer"><button type="button" className="workspace-backup-back" disabled={busy} onClick={() => void cancel()}><ArrowLeft size={13} /> Back</button><button type="button" className="primary-button" disabled={busy || (mode === "restore" && !selectedFile)} onClick={event => void open(event)}>{mode === "backup" ? <Download size={13} /> : <ShieldCheck size={13} />}{busy ? "Working…" : mode === "backup" ? "Save backup…" : "Unlock & preview"}</button></div>
    </div>}
    {preview && <div className="workspace-backup-card workspace-backup-preview">
      <div className="workspace-backup-verified"><CheckCircle2 size={18} /><div><h4>Ready to restore</h4><p>{selectedFile?.name ?? "Your backup has been verified."}</p></div></div>
      <div className="workspace-backup-counts">{[["Sessions", preview.sessions], ["Notes", preview.notes], ["Shortcuts & snippets", preview.shortcuts], ["Macros", preview.macros], ["Saved passwords", preview.credentials], ["Key & trust files", preview.keyFiles]].map(([label, count]) => <div key={label}><strong>{count}</strong><span>{label}</span></div>)}</div>
      <p className="workspace-backup-restore-note">This workspace becomes active after Conxol restarts. Your current workspace is kept as a safety copy. Use the backup workspace’s PIN after restart.</p>
      {!canRestore && <p className="workspace-backup-inline-warning"><AlertCircle size={14} /> Close all terminal tabs before restoring.</p>}
      <div className="workspace-backup-footer"><button type="button" className="workspace-backup-back" disabled={busy || committed} onClick={() => void cancel()}><ArrowLeft size={13} /> Cancel</button><button type="button" className="primary-button" disabled={busy || (!canRestore && !committed)} onClick={() => void (committed ? restart().catch(cause => setError(String(cause))) : restore())}>{busy ? "Restoring…" : committed ? "Restart Conxol" : "Restore & restart"}<ArrowRight size={13} /></button></div>
    </div>}
    {message && <div className="workspace-backup-feedback success" role="status"><CheckCircle2 size={16} /><span>{message}</span></div>}{error && <div className="workspace-backup-feedback failure" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}
  </div>;
}
