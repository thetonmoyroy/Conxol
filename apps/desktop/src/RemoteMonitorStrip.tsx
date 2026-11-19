import { Cpu, MemoryStick, HardDrive, Clock, Server, RefreshCw, X, Activity, ArrowUp, ArrowDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { RemoteMonitorSnapshot } from "./App";
import { REMOTE_MONITOR_REFRESH_INTERVALS } from "./remote-monitor";

function bytes(value: number) {
  return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GiB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MiB` : `${Math.round(value / 1024)} KiB`;
}

function MetricDetails({ label, rows = [], details, children }: { label: string; rows?: [string, string][]; details?: ReactNode; children: ReactNode }) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [position, setPosition] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null);
  const cancel = () => clearTimeout(timer.current);
  const hide = () => { cancel(); timer.current = setTimeout(() => setPosition(null), 100); };
  const show = () => {
    cancel();
    const rect = anchor.current?.getBoundingClientRect();
    if (rect) setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - (details ? 528 : 348))), bottom: window.innerHeight - rect.top + 6, maxHeight: Math.max(40, rect.top - 14) });
  };
  useEffect(() => {
    const close = (event: Event) => { if (event.type === "scroll" && event.target instanceof Element && event.target.closest(".remote-metric-tooltip")) return; setPosition(null); };
    window.addEventListener("resize", close);
    window.addEventListener("conxol:workspace-locked", close);
    document.addEventListener("scroll", close, true);
    return () => { clearTimeout(timer.current); window.removeEventListener("resize", close); window.removeEventListener("conxol:workspace-locked", close); document.removeEventListener("scroll", close, true); };
  }, []);
  return <span ref={anchor} tabIndex={0} aria-label={label} aria-describedby={position ? id : undefined} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onKeyDown={event => { if (event.key === "Escape") { cancel(); setPosition(null); } }}>
    {children}
    {position && createPortal(<div id={id} role="tooltip" className={`remote-metric-tooltip${details ? " remote-disk-tooltip" : ""}`} style={position} onMouseEnter={cancel} onMouseLeave={hide}>
      {details ?? <dl>{rows.map(([name, value], index) => <div key={`${name}:${index}`}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>}
    </div>, document.body)}
  </span>;
}

export function RemoteMonitorStrip({ snapshot, loading, error, interval, onInterval, onRefresh, onClose }: {
  snapshot: RemoteMonitorSnapshot | null; loading: boolean; error: string | null;
  interval: number; onInterval: (seconds: number) => void; onRefresh: () => void; onClose: () => void;
}) {
  const memory = snapshot?.memoryTotalBytes != null && snapshot.memoryAvailableBytes != null
    ? `${bytes(Math.max(0, snapshot.memoryTotalBytes - snapshot.memoryAvailableBytes))} / ${bytes(snapshot.memoryTotalBytes)}` : "—";
  const ram = (value?: number | null) => value == null ? "Unavailable" : `${Math.round(value / 1024 ** 2).toLocaleString()} MiB`;
  const used = snapshot?.memoryTotalBytes != null && snapshot.memoryAvailableBytes != null ? Math.max(0, snapshot.memoryTotalBytes - snapshot.memoryAvailableBytes) : null;
  const interfaces = snapshot?.networkInterfaces ?? [];
  const rate = (value?: number | null) => value == null ? "— Mbps" : `${value.toFixed(2)} Mbps`;
  const disks = snapshot?.disks ?? [];
  const diskSummary = disks.filter(disk => disk.mountPoint === "/" || disk.filesystem.startsWith("/dev/")).slice(0, 3).map(disk => `${disk.mountPoint} ${disk.usedPercent}%`).join(" · ");
  const networkRows = (out: boolean): [string, string][] => interfaces.length ? interfaces.flatMap(item => [
    [`${item.name} total ${out ? "out" : "in"}`, bytes(out ? item.transmittedBytes : item.receivedBytes)],
    [`${item.name} errors`, String(out ? item.transmitErrors : item.receiveErrors)],
    [`${item.name} dropped`, String(out ? item.transmitDropped : item.receiveDropped)],
  ] as [string, string][]) : [["Interfaces", "Unavailable"]];
  return <div className="remote-monitor-strip" aria-label="Remote monitoring">
    <div className="remote-monitor-strip-metrics">
      <MetricDetails label="Remote host details" rows={[["Hostname", snapshot?.hostname ?? "Unavailable"], ["Kernel", snapshot?.kernel ?? "Unavailable"]]}><Server size={12} />{snapshot?.hostname ?? "Remote host"}</MetricDetails>
      <MetricDetails label="Load average details" rows={[1, 5, 15].map((minutes, index) => [`${minutes} minute load`, snapshot?.loadAverage?.[index].toFixed(2) ?? "Unavailable"])}><Cpu size={12} />Load {snapshot?.loadAverage?.map(value => value.toFixed(2)).join(" / ") ?? "—"}</MetricDetails>
      <MetricDetails label="Memory details" rows={[["Total RAM", ram(snapshot?.memoryTotalBytes)], ["Used RAM", ram(used)], ["Available RAM", ram(snapshot?.memoryAvailableBytes)], ["Cached RAM", ram(snapshot?.memoryCachedBytes)], ["Buffers", ram(snapshot?.memoryBuffersBytes)]]}><MemoryStick size={12} />{memory}</MetricDetails>
      <MetricDetails label="Network upload speed details" rows={[["Upload speed", rate(snapshot?.networkSentMbps)], ...networkRows(true)]}><ArrowUp size={12} />{rate(snapshot?.networkSentMbps)}</MetricDetails>
      <MetricDetails label="Network download speed details" rows={[["Download speed", rate(snapshot?.networkReceivedMbps)], ...networkRows(false)]}><ArrowDown size={12} />{rate(snapshot?.networkReceivedMbps)}</MetricDetails>
      <MetricDetails label="Uptime details" rows={[["Uptime", snapshot?.uptimeSeconds != null ? `${Math.floor(snapshot.uptimeSeconds / 86400)}d ${Math.floor(snapshot.uptimeSeconds % 86400 / 3600)}h ${Math.floor(snapshot.uptimeSeconds % 3600 / 60)}m` : "Unavailable"]]}><Clock size={12} />{snapshot?.uptimeSeconds != null ? `${Math.floor(snapshot.uptimeSeconds / 60)} min` : "—"}</MetricDetails>
      <MetricDetails label="Disk usage details" details={<>
        <header className="remote-disk-heading"><HardDrive size={16} /><strong>Storage</strong><span>{disks.length} mounts</span></header>
        {disks.length > 0 && <div className="remote-disk-columns" aria-hidden="true"><span>Mount</span><span>Used</span><span>Free</span><span>Total</span><span>Usage</span></div>}
        {disks.length ? <div className="remote-disk-mounts">{disks.map((disk, index) => <article className={`remote-disk-mount${disk.usedPercent >= 90 ? " is-full" : ""}`} key={`${disk.filesystem}:${disk.mountPoint}:${index}`}>
          <strong className="remote-disk-name" title={`${disk.mountPoint} · ${disk.filesystem}`}>{disk.mountPoint}</strong>
          <span aria-label={`Used ${bytes(disk.usedBytes)}`}>{bytes(disk.usedBytes)}</span>
          <span aria-label={`Free ${bytes(disk.availableBytes)}`}>{bytes(disk.availableBytes)}</span>
          <span aria-label={`Total ${bytes(disk.totalBytes)}`}>{bytes(disk.totalBytes)}</span>
          <div className="remote-disk-usage"><div className="remote-disk-bar" role="meter" aria-label={`${disk.mountPoint} space used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={disk.usedPercent}><i style={{ width: `${disk.usedPercent}%` }} /></div><span>{disk.usedPercent}%</span></div>
        </article>)}</div> : <p className="remote-disk-unavailable">{snapshot?.rootDiskUsedPercent != null ? `/ filesystem: ${snapshot.rootDiskUsedPercent}% used. Mount details require an updated desktop build.` : "Mount details unavailable on this host."}</p>}
      </>}><HardDrive size={12} />{diskSummary || `/ ${snapshot?.rootDiskUsedPercent != null ? `${snapshot.rootDiskUsedPercent}%` : "—"}`}</MetricDetails>
      <MetricDetails label="Process details" rows={[["Visible processes", snapshot?.processCount?.toLocaleString() ?? "Unavailable"]]}><Activity size={12} />{snapshot?.processCount ?? "—"} processes</MetricDetails>
      {error && <span className="remote-monitor-strip-error" title={error} role="status">Monitoring unavailable</span>}
    </div>
    <select aria-label="Remote monitoring refresh interval" value={interval} onChange={event => onInterval(Number(event.target.value))}>
      {REMOTE_MONITOR_REFRESH_INTERVALS.map(seconds => <option key={seconds} value={seconds}>{seconds}s</option>)}
    </select>
    <button type="button" aria-label="Refresh remote monitoring" title="Refresh monitoring" disabled={loading} onClick={onRefresh}><RefreshCw size={12} className={loading ? "spin" : undefined} /></button>
    <button type="button" aria-label="Stop remote monitoring" title="Stop monitoring" onClick={onClose}><X size={12} /></button>
  </div>;
}
