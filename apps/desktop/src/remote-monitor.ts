/**
 * Keep live SSH monitoring bounded. Keep the allowed values
 * in one small, renderer-testable module so the terminal status strip cannot
 * accidentally create an unbounded polling interval.
 */
export const REMOTE_MONITOR_REFRESH_INTERVALS = Array.from({ length: 30 }, (_, index) => index + 1);
export const DEFAULT_REMOTE_MONITOR_INTERVAL = 1;
const INTERVAL_KEY = "conxol.remoteMonitorInterval";

export type RemoteMonitorRefreshInterval = (typeof REMOTE_MONITOR_REFRESH_INTERVALS)[number];

export function isRemoteMonitorRefreshInterval(value: number): value is RemoteMonitorRefreshInterval {
  return Number.isInteger(value) && value >= 1 && value <= 30;
}

export function readRemoteMonitorInterval(storage?: Pick<Storage, "getItem">): number {
  try {
    const value = Number((storage ?? localStorage).getItem(INTERVAL_KEY));
    return isRemoteMonitorRefreshInterval(value) ? value : DEFAULT_REMOTE_MONITOR_INTERVAL;
  } catch { return DEFAULT_REMOTE_MONITOR_INTERVAL; }
}

export function saveRemoteMonitorInterval(value: number, storage?: Pick<Storage, "setItem">): void {
  if (!isRemoteMonitorRefreshInterval(value)) return;
  try { (storage ?? localStorage).setItem(INTERVAL_KEY, String(value)); } catch { /* Keep the choice for this run when storage is unavailable. */ }
}
