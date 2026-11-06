/** A port alone is not unique when a scan includes multiple hosts. */
export function mergeScanResults<T extends { host: string; port: number }>(current: T[], incoming: T[]): T[] {
  const results = new Map(current.map(result => [`${result.host}:${result.port}`, result]));
  for (const result of incoming) results.set(`${result.host}:${result.port}`, result);
  return [...results.values()].sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }) || a.port - b.port);
}

export function openScanResults<T extends { status: string }>(results: T[]): T[] {
  return results.filter(result => result.status === "open");
}

export function scanProgress(scanned: number, total: number) {
  const maximum = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  const completed = Number.isFinite(scanned) ? Math.min(maximum, Math.max(0, Math.trunc(scanned))) : 0;
  return { completed, total: maximum, percent: maximum ? Math.floor(completed / maximum * 100) : 0 };
}
