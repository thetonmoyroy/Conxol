import type { IBufferLine, IDisposable, Terminal } from "@xterm/xterm";

export type NetworkHighlightKind = "good" | "bad" | "warning" | "address" | "interface" | "keyword" | "command" | "comment";
export type NetworkHighlight = { start: number; end: number; kind: NetworkHighlightKind };
const RULES: Array<[NetworkHighlightKind, RegExp]> = [
  ["good", /\b(?:no shutdown|undo shutdown)\b/gi],
  ["bad", /\b(?:not[ _-]+connected|not[ _-]+established|not[ _-]*permitted|not[ _-]*allowed|disable|deactivate|unavailable|fault|disallowed|refused|problem|notconnect|reject|deny|administratively down|admin(?:istratively)?[ -]down|error-disabled|err-disabled|down|disconnected|unreachable|failed|failure|denied|invalid|inactive|disabled|shutdown|critical|error)\b/gi],
  ["good", /\b(?:up|yes|ok|enable|permit|forwarding|connected|established|enabled|reachable|success(?:ful)?|full|active)\b/gi],
  ["warning", /\b(?:warning|warn|flapping|timeout|timed out|dropped|discard(?:s|ed)?|idle|init|attempt|opensent|openconfirm|loading|blocking)\b/gi],
  ["interface", /\b(?:(?:GigabitEthernet|TenGigabitEthernet|Ten-GigabitEthernet|TwentyFiveGigE|FortyGigabitEthernet|HundredGigE|FastEthernet|Ethernet|Eth-Trunk|Bridge-Aggregation|XGigabitEthernet|100GE|40GE|25GE|10GE|GE|XGE|Gi|Te|Fa|Eth|Port-channel|Po|Vlanif|Vlan|Loopback|Lo|Tunnel|Serial|Null)\s*\d+(?:[/:.]\d+)*|(?:ge|xe|et|fe|se|ms|gr|ip|lt)-\d+\/\d+\/\d+(?::\d+)?(?:\.\d+)?|(?:irb\.\d+)|(?:ae|reth|irb|lo|fxp|em|vme)\d+(?:\.\d+)?)\b/gi],
  ["command", /\b(?:set|undo|delete|edit|show|display|commit|rollback|compare|load|save|exit|run|configure|unset|rename|copy|monitor|request|reset|clear|system-view)\b/gi],
  ["keyword", /\b(?:forwarding-options|routing-instances|class-of-service|policy-statement|logical-systems|security-policy|routing-options|traffic-policy|address-family|ospf(?:v[23])?|policy-options|event-options|security-zone|configuration|interface[s]?|vpn-instance|greater-equal|less-equal|ip-prefix|system-view|description|access-list|prefix-list|router-id|protocols|route-map|firewall|security|ip-route|protocol|rollback|hostname|neighbor|vlan[s]?|next-hop|chassis|session|sysname|system|policy|delete|commit|router|inet6?|static|permit|is-is|vxlan|route|vrrp|peer|ipv6|isis|mpls|rsvp|evpn|lacp|rstp|mstp|snmp|lldp|dhcp|deny|set|bgp|ldp|vrf|bfd|stp|ntp|cdp|arp|acl|ip)\b/gi],
];

function ipv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function ipv6(value: string): boolean {
  if (!value.includes(":")) return false;
  const halves = value.split("::");
  if (halves.length > 2) return false;
  const groups = halves.flatMap(half => half ? half.split(":") : []);
  return groups.every(group => /^[\da-f]{1,4}$/i.test(group)) && (halves.length === 2 ? groups.length < 8 : groups.length === 8);
}

/** Match displayed text only. Ordered rules keep phrases such as "no shutdown" intact. */
export function findNetworkHighlights(text: string): NetworkHighlight[] {
  text = text.slice(0, 16384);
  const spans: NetworkHighlight[] = [];
  const plainTerms = [...text.matchAll(/\broute-policy\b/gi)].map(match => ({ start: match.index, end: match.index + match[0].length }));
  const add = (start: number, end: number, kind: NetworkHighlightKind) => {
    if (spans.length < 128 && !plainTerms.some(span => start < span.end && end > span.start) && !spans.some(span => start < span.end && end > span.start)) spans.push({ start, end, kind });
  };
  // Whole-line comments and descriptive configuration retain their own color.
  for (const match of text.matchAll(/^\s*(?:!|#(?:\s|$))[^\r\n]*/g)) add(match.index, match.index + match[0].length, "comment");
  for (const match of text.matchAll(/\b(?:description|hostname|sysname|nameif|version)\s+[^\r\n;{}]+/gi)) add(match.index, match.index + match[0].length, "good");
  for (const match of text.matchAll(/\blocalhost\b/gi)) add(match.index, match.index + match[0].length, "address");
  // Huawei prefix lists use "address length" as well as CIDR notation.
  // Restrict spaced lengths to prefix-list entries so unrelated table columns stay plain.
  if (/\b(?:ip|ipv6)\s+ip-prefix\s+/i.test(text)) {
    for (const match of text.matchAll(/\b(?:permit|deny)\s+([\da-f:.]+)[ \t]+(\d{1,3})(?![\w.])/gi)) {
      const address = match[1], length = Number(match[2]);
      if ((ipv4(address) && length <= 32) || (ipv6(address) && length <= 128)) {
        const start = match.index + match[0].indexOf(address);
        add(start, match.index + match[0].length, "address");
      }
    }
    for (const match of text.matchAll(/\b(?:greater-equal|less-equal)\s+(\d{1,3})(?![\w.])/gi)) {
      const max = /\bipv6\s+ip-prefix\b/i.test(text) ? 128 : 32;
      if (Number(match[1]) <= max) add(match.index + match[0].lastIndexOf(match[1]), match.index + match[0].length, "address");
    }
  }
  // Addresses take precedence over interface names and keywords.
  for (const match of text.matchAll(/(?<![\w.:])(?:\d{1,3}(?:\.\d{1,3}){3}|[\da-f]*:[\da-f:]+)(?:\/\d{1,3})?(?![\w.:])/gi)) {
    const [address, prefix] = match[0].split("/");
    const v4 = ipv4(address);
    if ((v4 || ipv6(address)) && (prefix === undefined || Number(prefix) <= (v4 ? 32 : 128))) add(match.index, match.index + match[0].length, "address");
  }
  for (const match of text.matchAll(/\b(?:[\da-f]{2}(?::[\da-f]{2}){5}|[\da-f]{2}(?:-[\da-f]{2}){5}|[\da-f]{4}(?:\.[\da-f]{4}){2}|[\da-f]{4}(?:-[\da-f]{4}){2})\b/gi)) add(match.index, match.index + match[0].length, "address");
  for (const [kind, pattern] of RULES) {
    for (const match of text.matchAll(pattern)) add(match.index, match.index + match[0].length, kind);
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** Keep ordinary prose and separator lines plain; emphasize operational content. */
export function findUsefulNetworkHighlights(text: string): NetworkHighlight[] {
  const spans = findNetworkHighlights(text);
  const meaningful = spans.some(span => span.kind === "address" || span.kind === "interface" || span.kind === "bad" || span.kind === "warning")
    || /^\s*(?:(?:[\w.@:-]+(?:\([^\r\n)]*\))?[>#]|<[^>]+>|\[[^\]]+\])\s*)?(?:show|display|set|undo|delete|edit|commit|rollback|configure|system-view|interface|interfaces|description|hostname|sysname|nameif|version|ip|ipv6|peer|neighbor|router|bgp|ospf|isis|mpls|vlan|vrrp|vrf|vpn-instance|protocols|policy-options|routing-options|routing-instances|security|firewall|acl|snmp|ntp|lldp|traffic-policy|port|no shutdown|shutdown)\b/i.test(text)
    || /^\s*(?:up|down|enabled|disabled|connected|disconnected|established|active|inactive|forwarding|blocking)(?:\s+(?:up|down))?\s*$/i.test(text);
  return meaningful ? spans : [];
}

/** Map UTF-16 offsets to terminal cells, including wide and combining characters. */
export function networkCellRanges(line: IBufferLine): Array<NetworkHighlight & { x: number; width: number }> {
  const text = line.translateToString(true);
  const spans = findUsefulNetworkHighlights(text);
  if (!spans.length) return [];
  const columns: number[] = [];
  let end = 0;
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell || cell.getWidth() === 0) continue;
    for (let index = 0; index < (cell.getChars() || " ").length; index++) columns.push(x);
    end = x + cell.getWidth();
  }
  columns.push(end);
  return spans.flatMap(span => {
    const x = columns[span.start], right = columns[span.end];
    if (x === undefined || right === undefined || right <= x) return [];
    // Keep colors already supplied by the device/application.
    for (let column = x; column < right; column++) if (!line.getCell(column)?.isFgDefault()) return [];
    return [{ ...span, x, width: right - x }];
  });
}

/** Decorations never alter output bytes, copy/search text, input, or ANSI parser state. */
export function attachNetworkHighlighting(terminal: Terminal): IDisposable & { refresh: () => void } {
  let queued = false;
  let disposed = false;
  let generation = 0;
  let renderedViewport = -1;
  let renderedBuffer: Terminal["buffer"]["active"] | undefined;
  type Entry = { marker: ReturnType<Terminal["registerMarker"]>; signature: string; generation: number; paletteKey: string; items: IDisposable[] };
  let entries: Entry[] = [];
  const release = (entry: Entry) => { entry.items.forEach(item => item.dispose()); entry.marker.dispose(); };
  const clear = () => { entries.forEach(release); entries = []; };
  const render = () => {
    queued = false;
    const buffer = terminal.buffer.active;
    if (disposed || buffer.type !== "normal") { clear(); return; }
    renderedViewport = buffer.viewportY;
    renderedBuffer = buffer;
    const theme = terminal.options.theme ?? {};
    const palette: Record<NetworkHighlightKind, string> = {
      good: theme.green ?? "#9bc48a", bad: theme.red ?? "#ee8d78", warning: theme.yellow ?? "#e8b45c",
      address: theme.yellow ?? "#e8b45c", interface: theme.yellow ?? "#e8b45c", keyword: theme.magenta ?? "#c9a3c7",
      command: theme.cyan ?? "#77c4bb", comment: theme.blue ?? "#86a9cc",
    };
    const paletteKey = JSON.stringify(palette);
    // Markers track history as the buffer scrolls/trims. Keep previously visited
    // rows colored and reuse unchanged decorations instead of clearing each frame.
    entries = entries.filter(entry => { if (entry.marker.isDisposed) { release(entry); return false; } return true; });
    const byLine = new Map(entries.map(entry => [entry.marker.line, entry]));
    const touched = new Set<Entry>();
    const current: Entry[] = [];
    for (let y = buffer.viewportY; y < Math.min(buffer.length, buffer.viewportY + terminal.rows); y++) {
      const previous = byLine.get(y);
      if (previous) touched.add(previous);
      // Scrolling alone cannot change terminal cells. Markers track line movement;
      // parsed output invalidates the cache, including ANSI-only color changes.
      if (previous?.generation === generation && previous.paletteKey === paletteKey) {
        current.push(previous);
        continue;
      }
      const line = buffer.getLine(y);
      if (!line) continue;
      const ranges = networkCellRanges(line);
      const signature = JSON.stringify(ranges.map(range => [range.x, range.width, palette[range.kind]]));
      if (previous?.signature === signature) {
        previous.generation = generation;
        previous.paletteKey = paletteKey;
        current.push(previous);
        continue;
      }
      if (previous) release(previous);
      if (!ranges.length) continue;
      const marker = terminal.registerMarker(y - buffer.baseY - buffer.cursorY);
      if (!marker) continue;
      const entry: Entry = { marker, signature, generation, paletteKey, items: [] };
      for (const range of ranges) {
        const decoration = terminal.registerDecoration({ marker, x: range.x, width: range.width, foregroundColor: palette[range.kind], layer: "bottom" });
        if (decoration) entry.items.push(decoration);
      }
      current.push(entry);
    }
    entries = entries.filter(entry => !touched.has(entry));
    entries.push(...current);
    // Bound retained decorations; evicted history is recolored on the next visit.
    let count = entries.reduce((total, entry) => total + entry.items.length, 0);
    while (entries.length > terminal.rows * 2 || count > terminal.rows * 128) {
      const entry = entries.shift()!;
      count -= entry.items.length;
      release(entry);
    }
  };
  const refresh = () => {
    if (disposed || queued) return;
    queued = true;
    // Coalesce a whole parser/scroll burst, but finish before xterm's next
    // animation frame so history never paints once with plain foreground.
    queueMicrotask(() => { if (!disposed) render(); });
  };
  // onScroll also fires for each output line while xterm parses a write. Never
  // scan/decorate synchronously there: coalesce the burst and color its final viewport.
  const subscriptions = [terminal.onWriteParsed(() => { generation++; refresh(); }), terminal.onScroll(refresh), terminal.onRender(() => {
    // A scroll notification can precede the final rendered viewport. Recheck
    // after paint, including scrollbar jumps and cached history revisits.
    // Decoration updates also paint: only schedule when the viewport changed.
    if (terminal.buffer.active !== renderedBuffer || terminal.buffer.active.viewportY !== renderedViewport) refresh();
  }), terminal.onResize(() => { clear(); refresh(); }), terminal.buffer.onBufferChange(() => { clear(); refresh(); })];
  refresh();
  return { refresh, dispose: () => { disposed = true; subscriptions.forEach(item => item.dispose()); clear(); } };
}
