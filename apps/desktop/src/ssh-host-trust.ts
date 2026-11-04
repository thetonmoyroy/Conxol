export type HostTrustTarget = { host: string; port: number; knownHostsPath?: string; pinnedFingerprint?: string };
export type HostInspection = { host: string; port: number; fingerprint: string };
type TrustServices = {
  lookup: (target: HostTrustTarget) => Promise<string | null>;
  inspect: (target: HostTrustTarget) => Promise<HostInspection>;
  confirm: (target: HostTrustTarget, fingerprint: string) => Promise<boolean>;
  save: (target: HostTrustTarget, fingerprint: string) => Promise<void>;
};

/** Explicit trust always wins. Observe without credentials, approve, then pin the real handshake. */
export async function approveUnknownHost(target: HostTrustTarget, services: TrustServices, stillAllowed: () => boolean = () => true, inspectDirectly = true): Promise<boolean> {
  if (target.knownHostsPath || target.pinnedFingerprint) return stillAllowed();
  const endpoint = { host: target.host, port: target.port };
  const saved = await services.lookup(endpoint);
  if (!stillAllowed()) return false;
  if (saved) { target.pinnedFingerprint = saved; return true; }
  if (!inspectDirectly) throw new Error(`SSH host ${target.host}:${target.port} needs an explicit fingerprint for its jump route. Pin this host in its saved profile before connecting.`);
  const observed = await services.inspect(endpoint);
  if (!stillAllowed()) return false;
  if (observed.host !== target.host || observed.port !== target.port || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(observed.fingerprint)) throw new Error("SSH host-key inspection returned an invalid endpoint or fingerprint.");
  if (!await services.confirm(endpoint, observed.fingerprint) || !stillAllowed()) return false;
  await services.save(endpoint, observed.fingerprint);
  if (!stillAllowed()) return false;
  target.pinnedFingerprint = observed.fingerprint;
  return true;
}
