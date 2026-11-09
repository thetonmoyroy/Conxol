import { literalInputProps } from "./literal-input";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LockKeyhole, ShieldCheck, LoaderCircle } from "lucide-react";
import { WorkspaceLockContext, setWorkspaceLocked, useWorkspaceLock, validWorkspacePin, type WorkspaceLockStatus } from "./workspace-lock-state";
const native = "__TAURI_INTERNALS__" in window;

export function WorkspaceSecurity({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WorkspaceLockStatus | null>(null);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // Reveal the committed workspace or PIN/retry screen after it can paint.
    if (!status && !error) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => document.getElementById("startup-screen")?.remove());
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [status, error]);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++sequence.current;
    try {
      const next = native ? await invoke<WorkspaceLockStatus>("workspace_lock_status") : { enabled: false, locked: false, idleMinutes: 5, retryAfterSeconds: 0 };
      if (ticket !== sequence.current) return;
      setWorkspaceLocked(next.locked);
      document.documentElement.dataset.workspaceLocked = String(next.locked);
      setStatus(previous => previous && previous.enabled === next.enabled && previous.locked === next.locked && previous.idleMinutes === next.idleMinutes && previous.retryAfterSeconds === next.retryAfterSeconds ? previous : next); setError(null);
      if (!next.locked) setOpened(true);
    } catch { if (ticket === sequence.current) { setWorkspaceLocked(true); document.documentElement.dataset.workspaceLocked = "true"; setStatus(null); setError("Workspace security could not be loaded. Retry to continue."); } }
  }, []);
  const lock = useCallback(async () => {
    if (!native) return;
    await invoke("workspace_lock_now"); await refresh();
  }, [refresh]);
  useEffect(() => {
    let active = true;
    void refresh();
    let stop: (() => void) | undefined;
    if (native) void listen("workspace://locked", () => { if (active) void refresh(); }).then(unlisten => { if (active) { stop = unlisten; void refresh(); } else unlisten(); }).catch(() => {});
    const timer = window.setInterval(() => { if (native) void refresh(); }, 2000);
    return () => { active = false; stop?.(); window.clearInterval(timer); };
  }, [refresh]);
  const isLocked = status?.locked ?? true;
  useEffect(() => {
    if (!isLocked) return;
    window.dispatchEvent(new Event("conxol:workspace-locked"));
    document.title = "Conxol — Workspace locked";
    if (native) void getCurrentWindow().setTitle("Conxol — Workspace locked").catch(() => {});
  }, [isLocked]);
  useEffect(() => {
    if (!native || !status?.enabled || isLocked) return;
    let last = -Infinity;
    const activity = (event: Event) => {
      if (!event.isTrusted || performance.now() - last < 1000) return;
      last = performance.now(); void invoke("workspace_activity").catch(() => {});
    };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"];
    events.forEach(name => window.addEventListener(name, activity, { capture: true, passive: true }));
    return () => events.forEach(name => window.removeEventListener(name, activity, true));
  }, [status?.enabled, isLocked]);
  return <WorkspaceLockContext.Provider value={{ status, refresh, lock }}>
    <div className={`workspace-security-content${isLocked ? " is-locked" : ""}`} inert={isLocked} aria-hidden={isLocked}>
      {opened ? children : <div className="lock-cold-workspace"><div className="lock-cold-menu">Terminal Sessions View Tools Settings Help</div><div className="lock-cold-layout"><aside><span>User sessions</span><div>⌕ Find a session</div></aside><main><div className="lock-cold-tabs">⌂ ＋</div><div className="lock-cold-home"><strong>Conxol</strong><span>Your network, in command</span></div></main></div></div>}
    </div>
    {isLocked && <div className="workspace-lock-surface"><div className="workspace-lock-card" role="dialog" aria-modal="true" aria-labelledby="workspace-lock-heading">
      <div className="workspace-lock-mark"><LockKeyhole size={25} strokeWidth={1.5} /></div>
      <span className="workspace-lock-brand">CONXOL</span><h1 id="workspace-lock-heading">Workspace locked</h1>
      {status ? <><p>Enter your PIN to continue.</p><UnlockWorkspace retry={status.retryAfterSeconds} onUnlocked={refresh} /></> : <><p>{error ?? "Checking workspace security…"}</p>{error ? <button type="button" className="primary-button" onClick={() => void refresh()}>Retry</button> : <LoaderCircle size={18} className="spin" />}</>}
    </div></div>}
  </WorkspaceLockContext.Provider>;
}

function UnlockWorkspace({ retry, onUnlocked }: { retry: number; onUnlocked: () => Promise<void> }) {
  const pinRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inProgress = useRef(false);
  return <form className="workspace-unlock-form" onSubmit={event => {
    event.preventDefault(); if (inProgress.current || retry > 0) return;
    const field = pinRef.current; if (!field) return;
    let pin = field.value; field.value = "";
    if (!validWorkspacePin(pin)) { pin = ""; setError("Enter your 4–12 digit PIN."); field.focus(); return; }
    inProgress.current = true; setBusy(true); setError(null);
    void invoke("workspace_unlock", { pin }).then(onUnlocked).catch(error => { setError(String(error)); void onUnlocked(); }).finally(() => { inProgress.current = false; setBusy(false); pinRef.current?.focus(); });
    pin = "";
  }}>
    <label htmlFor="workspace-unlock-pin" className="workspace-pin-label">PIN</label>
    <input {...literalInputProps} ref={pinRef} id="workspace-unlock-pin" type="password" inputMode="numeric" pattern="[0-9]{4,12}" minLength={4} maxLength={12} autoComplete="off" autoFocus required disabled={busy} aria-describedby="workspace-pin-feedback" placeholder="••••" />
    <div id="workspace-pin-feedback" aria-live="polite">{retry > 0 ? <span>Try again in {retry} seconds.</span> : error ? <span role="alert">{error}</span> : null}</div>
    <button type="submit" className="primary-button" disabled={busy || retry > 0}>{busy ? <LoaderCircle size={14} className="spin" /> : <LockKeyhole size={14} />}{busy ? "Unlocking…" : "Unlock workspace"}</button>
    <small>Your sessions stay open while the workspace is locked.</small>
  </form>;
}

export function WorkspaceLockSettings() {
  const { status, refresh, lock } = useWorkspaceLock();
  const currentRef = useRef<HTMLInputElement>(null), newRef = useRef<HTMLInputElement>(null), confirmRef = useRef<HTMLInputElement>(null);
  const [idle, setIdle] = useState(String(status?.idleMinutes ?? 5));
  const [operation, setOperation] = useState<"change" | "disable" | "idle" | "enable" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const gate = useRef(false);
  const clearPins = useCallback(() => { [currentRef, newRef, confirmRef].forEach(ref => { if (ref.current) ref.current.value = ""; }); }, []);
  useEffect(() => { if (status?.locked) { clearPins(); setMessage(null); } }, [status?.locked, clearPins]);
  const apply = async (enabled: boolean) => {
    if (gate.current || !native) return;
    let currentPin = currentRef.current?.value ?? "", newPin = newRef.current?.value ?? "", confirmation = confirmRef.current?.value ?? "";
    if (enabled && (((!status?.enabled || operation === "change") && !validWorkspacePin(newPin)) || (newPin && !validWorkspacePin(newPin)))) { setMessage("Choose a PIN containing 4–12 digits."); return; }
    if (enabled && newPin !== confirmation) { setMessage("The new PIN and confirmation do not match."); return; }
    if (status?.enabled && !validWorkspacePin(currentPin)) { setMessage("Enter your existing workspace PIN in Current PIN above."); currentRef.current?.focus(); return; }
    clearPins();
    gate.current = true; setBusy(true); setMessage(null);
    try {
      await invoke("workspace_lock_configure", { request: { enabled, currentPin, newPin: enabled ? newPin : "", idleMinutes: Number(idle) } });
      await refresh(); setOperation(null); setMessage(enabled ? "PIN lock saved. Cold starts will require your PIN." : "Workspace PIN lock is off. Set it up before saving passwords.");
    } catch (error) { setMessage(String(error)); await refresh(); }
    finally { currentPin = ""; newPin = ""; confirmation = ""; gate.current = false; setBusy(false); }
  };
  if (!native) return <p className="settings-section-note">Workspace PIN locking is available in the desktop app.</p>;
  return <div className="workspace-pin-settings">
    <div className="workspace-pin-status"><ShieldCheck size={15} /><strong>{status?.enabled ? "PIN lock enabled" : "PIN lock is off"}</strong></div>
    <p className="settings-section-note">Protect your workspace and saved passwords with a 4–12 digit PIN. Longer PINs provide stronger protection. Changing the PIN re-encrypts saved passwords; locking clears the vault key from memory.</p>
    <div className="workspace-pin-actions">
      {(status?.enabled ? [ ["change", "Change PIN"], ["idle", "Change idle timeout"], ["disable", "Turn off lock"] ] : [["enable", "Set up PIN lock"]]).map(([value, label]) => <button key={value} type="button" className="outline-button" disabled={busy} aria-pressed={operation === value} onClick={() => { clearPins(); setMessage(null); setIdle(String(status?.idleMinutes ?? 5)); setOperation(value as typeof operation); }}>{label}</button>)}
      {status?.enabled && <button type="button" className="outline-button" disabled={busy} onClick={() => void lock()}>Lock now</button>}
    </div>
    {operation && <section className="workspace-pin-operation" aria-label={operation === "disable" ? "Turn off PIN lock" : operation === "change" ? "Change PIN" : operation === "idle" ? "Change idle timeout" : "Set up PIN lock"}>
      <h3>{operation === "disable" ? "Turn off PIN lock" : operation === "change" ? "Change PIN" : operation === "idle" ? "Change idle timeout" : "Set up PIN lock"}</h3>
      {status?.enabled && <div className="workspace-pin-current">
        <label htmlFor="settings-current-pin">Current PIN <span>{operation === "disable" ? "Enter your PIN to turn off workspace protection." : "Enter your PIN to authorize this change."}</span></label>
        <input {...literalInputProps} key={operation} id="settings-current-pin" ref={currentRef} type="password" inputMode="numeric" maxLength={12} autoComplete="off" disabled={busy} placeholder="Enter your existing workspace PIN" autoFocus />
      </div>}
      {(operation === "change" || operation === "enable") && <div className="settings-grid">
        <label>New PIN<input {...literalInputProps} ref={newRef} type="password" inputMode="numeric" maxLength={12} autoComplete="new-password" disabled={busy} placeholder="4–12 digits" /></label>
        <label>Confirm new PIN<input {...literalInputProps} ref={confirmRef} type="password" inputMode="numeric" maxLength={12} autoComplete="new-password" disabled={busy} placeholder="Re-enter the new PIN" /></label>
      </div>}
      {(operation === "idle" || operation === "enable") && <>
    <div className="settings-grid workspace-pin-idle">
      <label>Lock when idle<select value={idle} onChange={event => setIdle(event.target.value)} disabled={busy}>
        {[[0, "Never"], [1, "1 minute"], [2, "2 minutes"], [5, "5 minutes"], [10, "10 minutes"], [15, "15 minutes"], [30, "30 minutes"], [60, "1 hour"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        {![0, 1, 2, 5, 10, 15, 30, 60].includes(Number(idle)) && <option value={idle}>{idle} minutes</option>}
      </select></label>
    </div>
      </>}
      <div className="workspace-pin-actions">
        <button type="button" className="primary-button" disabled={busy} onClick={() => void apply(operation !== "disable")}>{busy ? "Saving…" : operation === "disable" ? "Confirm turn off" : operation === "change" ? "Save new PIN" : operation === "idle" ? "Save idle timeout" : "Enable PIN lock"}</button>
        <button type="button" className="outline-button" disabled={busy} onClick={() => { clearPins(); setMessage(null); setOperation(null); setIdle(String(status?.idleMinutes ?? 5)); }}>Cancel</button>
      </div>
    </section>}
    {message && <p className="workspace-pin-feedback" role="status">{message}</p>}
    <p className="settings-section-note">These buttons apply lock changes immediately; Save settings below is for other workspace preferences.</p>
  </div>;
}
