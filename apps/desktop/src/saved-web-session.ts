export function savedWebDestination(input: string): URL {
  if (!input.trim() || /\s/.test(input)) throw new Error("Enter a website URL or IP address without spaces.");
  const explicitScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input.trim());
  const host = input.trim().split(/[/:?#]/, 1)[0];
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
  const url = new URL(explicitScheme ? input.trim() : `${ipv4 ? "http" : "https"}://${input.trim()}`);
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.href.length > 8192) {
    throw new Error("Use an HTTP or HTTPS URL without embedded credentials.");
  }
  return url;
}

export function createSavedWebSession(input: { id: string; name: string; folder: string; url: string; pptpProfileId: string }) {
  if (!input.name.trim()) throw new Error("Enter a session name.");
  if (!input.pptpProfileId) throw new Error("Choose a PPTP profile for this Web session.");
  const url = savedWebDestination(input.url);
  return {
    id: input.id, name: input.name.trim(), folder: input.folder.trim() || null,
    protocol: "WEB", hostname: url.href, port: Number(url.port || (url.protocol === "http:" ? 80 : 443)),
    pptp_profile_id: input.pptpProfileId, username: null, auth: { kind: "none" as const },
    favorite: false, tags: [], notes: null, startup_directory: null, startup_command: null,
    environment: [], jump_hosts: [], jump_host_profiles: [], serial_profile: null,
    telnet_profile: null, remote_desktop_profile: null,
  };
}
