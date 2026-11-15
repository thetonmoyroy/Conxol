type InterfaceCounters = { name: string; receivedBytes: number; transmittedBytes: number };
export type NetworkSample = { time: number; interfaces: InterfaceCounters[] };
export function networkMbps(previous: NetworkSample | null, current: NetworkSample): { received: number | null; sent: number | null } {
  const elapsed = previous ? (current.time - previous.time) / 1000 : 0;
  if (!previous || elapsed <= 0 || !Number.isFinite(elapsed)) return { received: null, sent: null };
  const before = new Map(previous.interfaces.map(item => [item.name, item]));
  let received = 0, sent = 0, matched = false;
  for (const item of current.interfaces) {
    if (item.name === "lo") continue;
    const old = before.get(item.name);
    if (!old) continue;
    const rx = item.receivedBytes - old.receivedBytes, tx = item.transmittedBytes - old.transmittedBytes;
    if (![rx, tx].every(value => Number.isFinite(value) && value >= 0)) continue;
    received += rx; sent += tx; matched = true;
  }
  return matched ? { received: received * 8 / elapsed / 1_000_000, sent: sent * 8 / elapsed / 1_000_000 } : { received: null, sent: null };
}
