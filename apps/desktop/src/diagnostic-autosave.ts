import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

export type DiagnosticLogRun = { id: string; tool: string; target: string; route: string };
export type DiagnosticLog = DiagnosticLogRun & { state: string; savedAt: number; content: string };
export const DIAGNOSTIC_HISTORY_CHANGED = "conxol:diagnostic-history-changed";
let historyQueue: Promise<unknown> = Promise.resolve();

export function queueDiagnosticHistory<T>(action: () => Promise<T>): Promise<T> {
  const result = historyQueue.then(action);
  historyQueue = result.catch(() => undefined);
  return result;
}

type Snapshot = { run: DiagnosticLogRun | null; output: string; state: string; busy: boolean; error: string | null };

function save(snapshot: Snapshot): Promise<unknown> {
  if (!snapshot.run) return Promise.resolve();
  const request = { ...snapshot.run, content: `Target: ${snapshot.run.target}\nRoute: ${snapshot.run.route}\n\n${snapshot.output}`,
    state: snapshot.busy ? "running" : snapshot.error ? "failed" : snapshot.state };
  return queueDiagnosticHistory(async () => {
    await invoke("network_diagnostic_history_save", { request });
    window.dispatchEvent(new Event(DIAGNOSTIC_HISTORY_CHANGED));
  });
}

export function useDiagnosticAutosave(snapshot: Snapshot, saveOnClose = false): string {
  const [notice, setNotice] = useState("");
  const finalized = useRef<string | null>(null);
  const latest = useRef(snapshot);
  const { run, output, state, busy, error } = snapshot;
  useEffect(() => { latest.current = { run, output, state, busy, error }; }, [run, output, state, busy, error]);
  useEffect(() => {
    if (!isTauri() || !run) return;
    const checkpoint = () => {
      if (latest.current.run?.id !== run.id) return;
      void save(latest.current).then(() => setNotice("Saved automatically."))
        .catch(() => setNotice("Could not auto-save this result. Export text to keep a copy."));
    };
    if (!busy) {
      if ((state !== "idle" || error) && finalized.current !== run.id) {
        finalized.current = run.id;
        checkpoint();
      }
      return;
    }
    const interval = window.setInterval(checkpoint, 5000);
    return () => window.clearInterval(interval);
  }, [run, busy, state, error]);
  useEffect(() => () => {
    const snapshot = latest.current;
    if (saveOnClose && isTauri() && snapshot.run && snapshot.busy) {
      void save({ ...snapshot, busy: false, state: "cancelled", error: null,
        output: `${snapshot.output}\n\nTab closed; last available snapshot.` }).catch(() => undefined);
    }
  }, [saveOnClose]);
  return notice;
}
