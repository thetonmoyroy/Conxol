export type TemplateField = string;
export type CombinedSections = { header: string; peer: string; localAs: string; remoteAs?: string; checkboxFields: string[]; policyName: string; prefixes: string; policy: string; platform?: "iosxe" | "junos"; logicalSystems?: boolean };
export type ConfigTemplate = { id: string; name: string; text: string; fields: TemplateField[]; combined?: CombinedSections };
export type ConfigRow = Record<string, string>;
export function remoteAsOverridden(row: ConfigRow, sections: CombinedSections): boolean {
  // Preserve per-row ASNs only for legacy templates without a shared setting.
  return row.peer_as_override === "true" || (sections.remoteAs === undefined && row.peer_as_override !== "false" && !!row.peer_as?.trim());
}
export function effectiveRemoteAs(row: ConfigRow, sections: CombinedSections): string {
  return remoteAsOverridden(row, sections) ? row.peer_as ?? "" : sections.remoteAs ?? "";
}
export function prefixToMask(value: string): string {
  if (!/^\/?\d{1,2}$/.test(value)) throw Error("Enter an IPv4 prefix length from 0 to 32.");
  const prefix = Number(value.replace("/", ""));
  if (prefix > 32) throw Error("Enter an IPv4 prefix length from 0 to 32.");
  return Array.from({ length: 4 }, (_, index) => {
    const bits = Math.max(0, Math.min(8, prefix - index * 8));
    return String(256 - 2 ** (8 - bits));
  }).join(".");
}
export function normalizeInterfaceAddress(row: ConfigRow): ConfigRow {
  let result = row;
  if (Object.hasOwn(row, "ip") && row.ip.includes("/")) {
    const [ip, prefix, extra] = row.ip.trim().split("/");
    const octets = ip.split(".");
    if (extra !== undefined || octets.length !== 4 || octets.some(part => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255) || !/^\d{1,2}$/.test(prefix ?? "")) throw Error("Enter a valid IPv4 CIDR address, for example 192.0.2.1/30.");
    result = { ...row, ip, mask: prefixToMask(prefix) };
  } else if (Object.hasOwn(row, "mask") && row.mask && !row.mask.includes(".")) {
    result = { ...row, mask: prefixToMask(row.mask.trim()) };
  }
  return result;
}

// Keep typing unrestricted; normalize complete values without losing an unfinished edit.
export function automaticPeerIp(row: ConfigRow): string {
  try {
    const address = normalizeInterfaceAddress(row);
    const parts = address.ip?.split(".") ?? [];
    const masks = address.mask?.split(".") ?? [];
    if (parts.length !== 4 || masks.length !== 4 || [...parts, ...masks].some(part => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return "";
    const maskBits = masks.map(part => Number(part).toString(2).padStart(8, "0")).join("");
    if (!/^1*0*$/.test(maskBits)) return "";
    const prefix = maskBits.indexOf("0") < 0 ? 32 : maskBits.indexOf("0");
    if (prefix === 32) return "";
    const ip = parts.reduce((value, part) => value * 256 + Number(part), 0);
    const size = 2 ** (32 - prefix), network = Math.floor(ip / size) * size;
    let peer: number;
    if (prefix === 31) peer = ip === network ? ip + 1 : ip - 1;
    else {
      const first = network + 1, last = network + size - 2;
      if (ip < first || ip > last) return "";
      peer = ip < last ? ip + 1 : ip - 1;
      if (peer < first) return "";
    }
    return [24, 16, 8, 0].map(shift => String(Math.floor(peer / 2 ** shift) % 256)).join(".");
  } catch { return ""; }
}
export function editServiceValue(row: ConfigRow, field: string, value: string): ConfigRow {
  let next = { ...row, [field]: value };
  if (field === "peer_as") return { ...next, peer_as_override: "true" };
  if (field === "peer_ip") return { ...next, peer_ip_mode: "manual" };
  if (field === "peer_ip_mode") return value === "auto" ? { ...next, peer_ip: automaticPeerIp(next) } : next;
  if (field === "ip" && value.includes("/")) {
    try { next = { ...next, mask: normalizeInterfaceAddress(next).mask }; } catch { /* Keep unfinished input editable. */ }
  }
  // An explicit mask edit takes over from an address's CIDR suffix.
  if (field === "mask" && row.ip?.includes("/")) next = { ...next, ip: row.ip.split("/")[0] };
  if ((field === "ip" || field === "mask") && row.peer_ip_mode !== "manual") return { ...next, peer_ip: automaticPeerIp(next) };
  return next;
}
export const templateStorageKey = "conxol.configTemplates.v1";
const placeholder = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
export function templateFields(text: string): TemplateField[] {
  return [...new Set(Array.from(text.matchAll(placeholder), match => match[1]))];
}
export const huaweiText = `interface {{interface}}.{{vlan}}
description MGMT_RTR-{{vpn}}
ip binding vpn-instance {{vpn}}
ip address {{ip}} {{mask}}
dot1q termination vid {{vlan}}
statistics enable
#`;
export const huaweiTemplate: ConfigTemplate = { id: "huawei-subinterface", name: "Huawei subinterfaces", text: huaweiText, fields: templateFields(huaweiText) };
export function huaweiRows(): ConfigRow[] {
  return ["IPBW", "GGC", "FNA", "CDN", "BDIX"].map((vpn, index) => ({ interface: "Eth-Trunk1", vlan: String(200 + index), vpn, ip: `192.0.2.${1 + index * 4}`, mask: "255.255.255.252" }));
}
export const combinedTemplate: ConfigTemplate = {
  id: "huawei-combined", name: "Huawei interfaces + policy + BGP", text: huaweiText, fields: templateFields(huaweiText),
  combined: {
    header: "bgp {{local_as}}\n undo check-first-as\n #\n ipv4-family unicast\n #",
    peer: " ipv4-family vpn-instance {{vpn}}\n  peer {{peer_ip}} as-number {{peer_as}}\n  peer {{peer_ip}} route-policy {{import_policy}} import\n  peer {{peer_ip}} route-policy {{export_policy}} export\n{{#advertise_default}}  peer {{peer_ip}} default-route-advertise\n{{/advertise_default}} #",
    localAs: "64496", remoteAs: "64497", checkboxFields: ["advertise_default"], policyName: "MGMT_RTR",
    prefixes: "ip ip-prefix {{policy_name}} index {{index}} {{action}} {{network}} {{length}}{{#ge}} greater-equal {{ge}}{{/ge}}{{#le}} less-equal {{le}}{{/le}}",
    policy: "route-policy {{policy_name}} permit node 10\n if-match ip-prefix {{policy_name}}\n#",
  },
};
export function combinedRows(): ConfigRow[] {
  return huaweiRows().map((row, index) => ({ ...row, peer_ip: `192.0.2.${2 + index * 4}`, peer_as: "", import_policy: "MGMT_RTR", export_policy: row.vpn === "IPBW" ? "deny-all" : `CLIENT-${row.vpn}-OUT`, advertise_default: row.vpn === "IPBW" ? "true" : "" }));
}
export function prefixRows(): ConfigRow[] {
  return [
    ["10", "permit", "192.0.2.0", "28", "28", "28"],
    ["11", "permit", "192.0.2.16", "28", "28", "29"],
    ["12", "permit", "198.51.100.0", "24", "", ""],
    ["13", "permit", "203.0.113.240", "28", "", ""],
    ["14", "permit", "203.0.113.32", "29", "", ""],
    ["255", "deny", "0.0.0.0", "0", "", "32"],
  ].map(([index, action, network, length, ge, le]) => ({ index, action, network, length, ge, le }));
}
function conditionalText(text: string, row: ConfigRow): string {
  const tokens = /\{\{([#/])([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
  if (/\{\{[#/]/.test(text.replace(tokens, ""))) throw Error("Invalid conditional field syntax.");
  let open: RegExpExecArray | null = null, result = "", cursor = 0;
  for (let token = tokens.exec(text); token; token = tokens.exec(text)) {
    if (token[1] === "#") {
      if (open) throw Error("Nested conditional blocks are not supported.");
      result += text.slice(cursor, token.index); open = token;
    } else {
      if (!open || open[2] !== token[2]) throw Error("Conditional blocks must have matching opening and closing fields.");
      if (Object.hasOwn(row, token[2]) && row[token[2]] && row[token[2]] !== "false") result += text.slice(open.index + open[0].length, token.index);
      cursor = token.index + token[0].length; open = null;
    }
  }
  if (open) throw Error("Close every conditional block.");
  return result + text.slice(cursor);
}
export function serviceFields(template: ConfigTemplate): string[] {
  const combined = template.combined;
  const derived = combined?.platform === "junos" ? ["prefix_length", "export_chain"] : [];
  return [...new Set([...templateFields(template.text + "\n" + (combined?.peer ?? "")), ...(combined?.platform === "junos" ? ["mask", "export_policy"] : []), ...(combined?.checkboxFields ?? [])])].filter(field => !combined || !["local_as", "policy_name", ...derived].includes(field));
}
export function renderCombined(template: ConfigTemplate, rows: ConfigRow[], prefixes: ConfigRow[]) {
  try {
    rows = rows.map((row, index) => {
      try { return normalizeInterfaceAddress(row); }
      catch (error) { throw Error(`Row ${index + 1}: ${(error as Error).message}`); }
    });
  } catch (error) { return { text: "", errors: [(error as Error).message], count: 0 }; }
  const sections = template.combined;
  if (!sections) return renderTemplate(template.text, rows);
  const active = rows.filter(row => serviceFields(template).some(field => Object.hasOwn(row, field) && row[field]?.trim()));
  const shared = { local_as: sections.localAs, policy_name: sections.policyName };
  let services: ConfigRow[], prefixData: ConfigRow[];
  try {
    services = rows.map((row, index) => {
      if (!active.includes(row)) return {};
      const peer_as = effectiveRemoteAs(row, sections);
      if (templateFields(sections.peer).includes("peer_as") && peer_as.trim() && (!/^\d+$/.test(peer_as) || Number(peer_as) < 1 || Number(peer_as) > 4294967295)) throw Error(`Row ${index + 1}: remote BGP AS must be a number from 1 to 4294967295.`);
      row = { ...row, peer_as };
      if (sections.platform !== "junos") return { ...row, ...shared };
      const mask = row.mask ?? "";
      const octets = mask.split(".");
      const bits = octets.map(part => Number(part).toString(2).padStart(8, "0")).join("");
      if (octets.length !== 4 || octets.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255) || !/^1*0*$/.test(bits)) throw Error(`Row ${index + 1}: enter a contiguous IPv4 subnet mask.`);
      if (!row.export_policy?.trim()) throw Error(`Row ${index + 1}: export_policy is required.`);
      return { ...row, ...shared, prefix_length: String(bits.indexOf("0") < 0 ? 32 : bits.indexOf("0")), export_chain: row.advertise_default === "true" ? `DEFAULT-${row.vpn} ${row.export_policy}` : row.export_policy };
    });
    prefixData = prefixes.map((row, index) => {
      if (!Object.values(row).some(value => value.trim())) return {};
      if (!sections.platform) return { ...row, ...shared };
      const base = Number(row.length), lower = row.ge ? Number(row.ge) : base, upper = row.le ? Number(row.le) : row.ge ? 32 : base;
      if (![row.length, row.ge || row.length, row.le || "32"].every(value => /^\d{1,2}$/.test(value ?? "")) || base < 0 || base > lower || lower > upper || upper > 32) throw Error(`Prefix ${index + 1}: invalid prefix-length range.`);
      if (!["permit", "deny"].includes(row.action)) throw Error(`Prefix ${index + 1}: action must be permit or deny.`);
      if (sections.platform === "iosxe") return { ...row, ...shared, ge: lower > base ? String(lower) : "", le: (row.ge || row.le) && upper > base ? String(upper) : "" };
      return { ...row, ...shared, route_match: row.ge || row.le ? `prefix-length-range /${lower}-/${upper}` : "exact", route_action: row.action === "permit" ? "accept" : "reject" };
    });
  } catch (error) { return { text: "", errors: [(error as Error).message], count: 0 }; }
  const check = renderTemplate(template.text + "\n" + sections.peer, services);
  if (check.errors.length) return check;
  const activeServices = services.filter(row => Object.keys(row).length);
  // Policies and routing options belong to each logical system, never the master.
  const scopes = sections.logicalSystems ? [...new Set(activeServices.map(row => row.logical_system))].map(logical_system => ({ ...shared, logical_system })) : [shared];
  const results = [renderTemplate(template.text, activeServices), ...scopes.map(scope => renderTemplate(sections.prefixes, prefixData.map(row => Object.keys(row).length ? { ...row, ...scope } : {}))), ...scopes.map(scope => renderTemplate(sections.policy, [scope])), ...scopes.map(scope => renderTemplate(sections.header, [scope])), renderTemplate(sections.peer, activeServices)];
  const errors = results.flatMap(result => result.errors);
  const text = results.map(result => result.text).join("\n");
  if (text.length > 2000000) errors.push("The result is too large. Use fewer rows.");
  return { text: errors.length ? "" : text, errors, count: active.length };
}
export function renderTemplate(text: string, rows: ConfigRow[]) {
  const errors: string[] = [], blocks: string[] = [];
  const fields = templateFields(text);
  if (!text.trim()) errors.push("Enter a template.");
  if (text.length > 10000 || fields.length > 64 || rows.length > 10000) errors.push("Use up to 10,000 template characters, 64 fields and 10,000 rows.");
  if (errors.length) return { text: "", errors, count: 0 };
  try { conditionalText(text, {}); } catch (error) { return { text: "", errors: [(error as Error).message], count: 0 }; }
  let size = 0;
  for (const [index, row] of rows.entries()) {
    if (fields.length && !fields.some(field => Object.hasOwn(row, field) && row[field]?.trim())) continue;
    let expanded: string;
    try { expanded = conditionalText(text, row); } catch (error) { return { text: "", errors: [(error as Error).message], count: 0 }; }
    for (const field of templateFields(expanded)) {
      const value = Object.hasOwn(row, field) ? row[field] : "";
      if (!value?.trim()) errors.push(`Row ${index + 1}: ${field} is required.`);
      else if (/[\r\n]/.test(value)) errors.push(`Row ${index + 1}: ${field} must be a single line.`);
    }
    const block = expanded.replace(placeholder, (_, field: string) => Object.hasOwn(row, field) ? row[field] : "");
    size += block.length + (blocks.length ? 1 : 0);
    if (size > 2000000) return { text: "", errors: ["The result is too large. Use fewer rows."], count: 0 };
    blocks.push(block);
  }
  if (!blocks.length && !errors.length) errors.push("Enter at least one data row.");
  return { text: errors.length ? "" : blocks.join("\n"), errors, count: blocks.length };
}
export function encodeTemplates(templates: ConfigTemplate[]): string {
  // Explicit projection ensures row data never enters storage.
  return JSON.stringify({ version: 1, templates: templates.map(({ id, name, text, combined }) => ({ id, name, text, fields: templateFields(text), ...(combined ? { combined: { header: combined.header, peer: combined.peer, localAs: combined.localAs, checkboxFields: combined.checkboxFields, policyName: combined.policyName, prefixes: combined.prefixes, policy: combined.policy, ...(combined.remoteAs !== undefined ? { remoteAs: combined.remoteAs } : {}), ...(combined.platform ? { platform: combined.platform } : {}), ...(combined.logicalSystems !== undefined ? { logicalSystems: combined.logicalSystems } : {}) } } : {}) })) });
}
export function decodeTemplates(raw: string | null): ConfigTemplate[] {
  if (raw === null) return [];
  if (raw.length > 2000000) throw Error("Saved template storage is too large.");
  const data = JSON.parse(raw);
  if (data?.version !== 1 || !Array.isArray(data.templates) || data.templates.length > 100) throw Error("Invalid saved templates.");
  const ids = new Set<string>();
  return data.templates.map((item: ConfigTemplate) => {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 100 || ids.has(item.id) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 100 || typeof item.text !== "string" || item.text.length > 10000 || !Array.isArray(item.fields) || JSON.stringify(item.fields) !== JSON.stringify(templateFields(item.text)) || item.fields.length > 64) throw Error("Invalid saved template.");
    ids.add(item.id);
    const combined = item.combined;
    if (combined) {
      if (combined.remoteAs !== undefined && (typeof combined.remoteAs !== "string" || combined.remoteAs.length > 100)) throw Error("Invalid remote BGP AS.");
      if (combined.platform !== undefined && !["iosxe", "junos"].includes(combined.platform)) throw Error("Invalid template platform.");
      if (combined.logicalSystems !== undefined && (typeof combined.logicalSystems !== "boolean" || combined.platform !== "junos")) throw Error("Invalid logical systems setting.");
      for (const key of ["header", "peer", "localAs", "policyName", "prefixes", "policy"] as const) if (typeof combined[key] !== "string" || combined[key].length > 10000) throw Error("Invalid combined template section.");
      if (!Array.isArray(combined.checkboxFields) || combined.checkboxFields.length > 64 || combined.checkboxFields.some(field => typeof field !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field))) throw Error("Invalid checkbox fields.");
      for (const section of [item.text, combined.peer, combined.header, combined.prefixes, combined.policy]) conditionalText(section, {});
      if (serviceFields(item).length > 64) throw Error("Too many service fields.");
    }
    return { id: item.id, name: item.name, text: item.text, fields: templateFields(item.text), ...(combined ? { combined: { header: combined.header, peer: combined.peer, localAs: combined.localAs, checkboxFields: combined.checkboxFields, policyName: combined.policyName, prefixes: combined.prefixes, policy: combined.policy, ...(combined.remoteAs !== undefined ? { remoteAs: combined.remoteAs } : {}), ...(combined.platform ? { platform: combined.platform } : {}), ...(combined.logicalSystems !== undefined ? { logicalSystems: combined.logicalSystems } : {}) } } : {}) };
  });
}
