import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type UpdateResult = "unsupported" | "upToDate" | "available" | "completed" | "canceled";

export function useStoreUpdates(unlocked: boolean) {
  const [supported, setSupported] = useState(false);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const started = useRef(false);
  const running = useRef(false);
  useEffect(() => {
    if (!unlocked || started.current || !("__TAURI_INTERNALS__" in window)) return;
    started.current = true;
    void invoke<boolean>("store_update_supported").then(async enabled => {
      setSupported(enabled);
      if (!enabled) return;
      // Discovery only: startup must never download or close active sessions.
      running.current = true; setBusy(true);
      try {
        const result = await invoke<UpdateResult>("store_update", { install: false });
        setAvailable(result === "available");
      } finally { running.current = false; setBusy(false); }
    }).catch(() => { /* Offline startup remains quiet; Help provides a retry. */ });
  }, [unlocked]);

  const run = async (install: boolean) => {
    if (!unlocked || running.current) return;
    running.current = true;
    setBusy(true); setMessage(""); setError("");
    try {
      const result = await invoke<UpdateResult>("store_update", { install });
      setSupported(result !== "unsupported");
      if (result === "available") setAvailable(true);
      else if (result === "upToDate" || result === "completed") setAvailable(false);
      setMessage(result === "upToDate" ? "Conxol is up to date in Microsoft Store." :
        result === "canceled" ? "Update postponed. You can retry when ready." :
        result === "completed" ? "Microsoft Store finished installing the update." : "");
    } catch (cause) { setError(String(cause)); }
    finally { running.current = false; setBusy(false); }
  };

  const menuItem = supported ? <button type="button" disabled={busy || !unlocked} onClick={() => void run(false)}>
    {busy ? "Checking or updating…" : "Check for updates…"}
  </button> : null;
  const notice = supported && unlocked && (available || message || error) ? <div className="workspace-notice" role="status">
    <span>{error || message || "A Microsoft Store update is available. Installation may restart Conxol."}</span>
    {available && <button type="button" className="outline-button" disabled={busy} onClick={() => void run(true)}>Update now…</button>}
    <button type="button" className="outline-button" disabled={busy} onClick={() => { setAvailable(false); setMessage(""); setError(""); }}>{available ? "Later" : "Dismiss"}</button>
  </div> : null;
  return { menuItem, notice };
}
