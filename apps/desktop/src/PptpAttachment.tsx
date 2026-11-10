import { PptpProfileSelect } from "./PptpProfileSelect";
import { useEffect, useId, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Info } from "lucide-react";

type Snapshot = { supported: boolean; profiles: Array<{ id: string; name: string; folder: string; connection: { state: string } }> };

export function PptpAttachment({ value, onChange, disabled = false, diagnostics = false, required = false }: { value: string; onChange: (id: string) => void; disabled?: boolean; diagnostics?: boolean; required?: boolean }) {
  const labelId = useId();
  const [snapshot, setSnapshot] = useState<Snapshot>({ supported: false, profiles: [] });
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const help = required ? "Choose the PPTP profile to use every time this saved website opens. It connects automatically using its saved password. Websites and DNS stay inside the selected tunnel; there is no direct fallback." : snapshot.supported ? (diagnostics ? "PPTP connects automatically using its saved password. IPv4 targets only. DNS requires an explicit IPv4 resolver and uses TCP. Ping payload: up to 1332 bytes." : "The selected PPTP profile connects automatically using its saved password. Use an IPv4 destination. Choose Direct connection to connect without PPTP.") : "Native PPTP connections are available on Windows, Linux and macOS. Saved assignments are preserved.";
  useEffect(() => {
    let active = true;
    if (isTauri()) void invoke<Snapshot>("pptp_list").then(result => { if (active) { setSnapshot(result); setError(""); } }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [revision]);
  return <div className="quick-connect-wide pptp-attachment">
    <div className="pptp-attachment-row">
      <div className="pptp-attachment-field"><span className="pptp-attachment-label"><span id={labelId}>{diagnostics ? "Network route" : "PPTP profile"}</span><span className="pptp-attachment-info" title={help}><Info size={12} aria-label={help} /></span></span>
        <PptpProfileSelect value={value} profiles={snapshot.profiles} labelId={labelId} disabled={disabled || (!snapshot.supported && !value)} onChange={onChange} required={required} />
      </div>
      <button type="button" className="outline-button" disabled={disabled} onClick={() => setRevision(n => n + 1)}>Refresh PPTP</button>
    </div>
    {error && <small role="alert">{error}</small>}
  </div>;
}
