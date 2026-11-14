import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { confirmAction } from "./text-prompt";

import { DIAGNOSTIC_HISTORY_CHANGED, queueDiagnosticHistory, useDiagnosticAutosave, type DiagnosticLog, type DiagnosticLogRun } from "./diagnostic-autosave";

export function DiagnosticHistory({ run, output, state, busy, error, selected, onSelect, visible }: {
  run: DiagnosticLogRun | null; output: string; state: string; busy: boolean; error: string | null;
  selected: DiagnosticLog | null; onSelect: (entry: DiagnosticLog | null) => void;
  visible: boolean;
}) {
  const [entries, setEntries] = useState<DiagnosticLog[]>([]);
  const [notice, setNotice] = useState("");
  const saveNotice = useDiagnosticAutosave({ run, output, state, busy, error });

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    const refresh = () => {
      void queueDiagnosticHistory(() => invoke<DiagnosticLog[]>("network_diagnostic_history_list")).then(logs => {
        if (active) setEntries(logs);
      }).catch(() => { if (active) setNotice("Saved logs could not be loaded."); });
    };
    refresh();
    window.addEventListener(DIAGNOSTIC_HISTORY_CHANGED, refresh);
    return () => { active = false; window.removeEventListener(DIAGNOSTIC_HISTORY_CHANGED, refresh); };
  }, []);

  const clear = async () => {
    if (!await confirmAction("Clear all saved diagnostic logs?")) return;
    await queueDiagnosticHistory(async () => {
      await invoke("network_diagnostic_history_clear");
      setEntries([]); onSelect(null); setNotice("Saved logs cleared.");
    }).catch(() => { setNotice("Could not clear saved logs."); });
  };

  return <>
    {!visible && saveNotice.startsWith("Could not") && <p className="diagnostics-export-notice" role="alert">{saveNotice}</p>}
    <section className="diagnostics-history" hidden={!visible} aria-label="Saved diagnostic logs">
      <header><strong>Saved logs ({entries.length})</strong><button type="button" className="outline-button" disabled={busy || !isTauri()} onClick={() => void clear()}>Clear logs</button></header>
      <div className="diagnostics-history-list">
        {entries.map(entry => <button type="button" key={entry.id} aria-pressed={selected?.id === entry.id} onClick={() => onSelect(entry)}>
          <span>{entry.tool.toUpperCase()} · {entry.target}</span><span>{new Date(entry.savedAt).toLocaleString()} · {entry.state}</span>
        </button>)}
        {!entries.length && <p>No saved logs yet. Run a diagnostic to save its result automatically.</p>}
      </div>
      <span role="status">{notice || saveNotice || "Results save automatically · Latest 50 runs · Live snapshots every 5 seconds"}</span>
      {selected && <p>{selected.route} · {selected.state === "running" ? "Partial snapshot from a running test" : selected.state}</p>}
    </section>
  </>;
}
