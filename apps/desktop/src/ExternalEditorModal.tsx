import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isWorkspaceLocked } from "./workspace-lock-state";
import { confirmAction } from "./text-prompt";
import type { RemoteTextDocument } from "./App";
import "./external-editor.css";

type Props = { sessionId: string; document: RemoteTextDocument; stillConnected: () => boolean; onClose: () => void };
type LocalEdit = { token: string; localPath: string };

export function ExternalEditorModal({ sessionId, document, stillConnected, onClose }: Props) {
  const [local, setLocal] = useState<LocalEdit | null>(null);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Choose an editor to start. Local copies use UTF-8.");
  const current = useRef(document);
  const pending = useRef<string | null>(null);
  const working = useRef(false);
  const modal = useRef<HTMLElement>(null);
  const closeHandler = useRef(onClose);
  useEffect(() => { closeHandler.current = onClose; }, [onClose]);
  const finish = useCallback(() => closeHandler.current(), []);

  useEffect(() => {
    const previous = window.document.activeElement;
    modal.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  const launch = useCallback(async (chooseEditor: boolean) => {
    if (working.current || !stillConnected() || isWorkspaceLocked()) return;
    working.current = true; setBusy(true); setError("");
    try {
      const opened = await invoke<LocalEdit | null>("external_editor_open", {
        content: current.current.content, filename: document.path.split("/").pop(), chooseEditor,
      });
      if (opened) { setLocal(opened); setStatus("Watching for saves. Changes upload automatically after they settle."); }
      else finish();
    } catch (cause) { setError(String(cause)); }
    finally { working.current = false; setBusy(false); }
  }, [document.path, stillConnected, finish]);

  useEffect(() => {
    if (local || error) return;
    const timer = window.setTimeout(() => void launch(false), 0);
    return () => window.clearTimeout(timer);
  }, [local, error, launch]);

  useEffect(() => {
    if (!local || paused) return;
    let disposed = false;
    const timer = window.setInterval(() => {
      if (disposed || working.current || isWorkspaceLocked()) return;
      // Background reads must not change visible state on every polling tick.
      working.current = true;
      let uploading = false;
      void (async () => {
        try {
          if (!stillConnected()) throw Error("The SSH connection changed or closed. Keep your local copy and reopen the remote file after reconnecting.");
          const { content, closed } = await invoke<{ content: string; closed: boolean }>("external_editor_read", { token: local.token });
          if (disposed || isWorkspaceLocked()) return;
          if (content === current.current.content) {
            pending.current = null;
            if (closed) { await invoke("external_editor_close", { token: local.token }); finish(); }
            return;
          }
          if (pending.current !== content) { pending.current = content; return; }
          if (!stillConnected()) throw Error("The SSH connection changed. Reopen the remote file before uploading.");
          uploading = true;
          setBusy(true);
          const saved = await invoke<RemoteTextDocument>("ssh_save_remote_text_file", {
            terminalId: sessionId, path: current.current.path, expectedRevision: current.current.revision,
            content, encoding: current.current.encoding,
          });
          current.current = saved;
          pending.current = null;
          if (saved.backupCleanupFailed) { setError("Uploaded, but the server could not confirm removal of its rollback copy."); setPaused(true); }
          if (closed && !saved.backupCleanupFailed) { await invoke("external_editor_close", { token: local.token }); finish(); }
          if (!disposed) setStatus(saved.backupCleanupFailed
            ? "Uploaded. The server could not confirm removal of its rollback copy."
            : `Uploaded at ${new Date().toLocaleTimeString()}. Watching for saves.`);
        } catch (cause) {
          if (!disposed) { setError(String(cause)); setPaused(true); setStatus("Uploads paused. Your local file is preserved. Remote conflicts must be resolved before reopening."); }
        } finally { working.current = false; if (uploading && !disposed) setBusy(false); }
      })();
    }, 1200);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [local, paused, sessionId, stillConnected, finish]);

  const close = async () => {
    if (working.current) return;
    // Hold the same gate as the watcher while the confirmation is visible.
    working.current = true; setBusy(true);
    try {
      if (local && !await confirmAction("Stop external editing and delete the temporary local copy? Close this file in your editor first. Any changes that have not uploaded will be discarded. Use Save As in your editor to keep a separate copy.")) return;
      if (local) await invoke("external_editor_close", { token: local.token });
      finish();
    } catch (cause) { setError(String(cause)); }
    finally { working.current = false; setBusy(false); }
  };

  // Normal editing is entirely in the background; only failures need attention.
  if (!error) return null;

  return <div className={local ? "external-editor-status" : "external-editor-backdrop"}><section ref={modal} className="external-editor-modal" role={local ? "region" : "dialog"} aria-modal={local ? undefined : true} aria-labelledby="external-editor-title" onKeyDown={event => {
    if (!local && event.key === "Escape") { event.preventDefault(); void close(); }
    if (!local && event.key === "Tab") {
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <h2 id="external-editor-title">{local ? "External editor needs attention" : "Could not open editor"}</h2>
    <p className="external-editor-path" title={document.path}>{document.path}</p>
    {!local && <p>Choose your editor. Saving there automatically uploads changes over SFTP.</p>}
    {local && <p>Local copy: <code style={{ overflowWrap: "anywhere" }}>{local.localPath}</code></p>}
    <p role="status">{status}</p>
    {error && <p role="alert" className="connect-error">{error}</p>}
    <div className="external-editor-actions">
      {!local && <><button className="primary-button" disabled={busy} onClick={() => void launch(false)}>Open in editor</button><button className="outline-button" disabled={busy} onClick={() => void launch(true)}>Choose another editor</button></>}
      {local && <button className="outline-button" disabled={busy} onClick={() => { if (working.current) return; pending.current = null; setPaused(!paused); setError(""); setStatus(paused ? "Watching for saves." : "Uploads paused. Your local file is preserved."); }}>{paused ? "Resume uploads" : "Pause uploads"}</button>}
      <button className="outline-button" disabled={busy} onClick={() => void close()}>{local ? "Stop editing" : "Cancel"}</button>
    </div>
  </section></div>;
}
