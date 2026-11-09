import { useEffect, useRef, useState } from "react";
import { writeClipboardText } from "./clipboard-access";
import { confirmAction, promptText } from "./text-prompt";
import { normalizeConfigTemplate, templateSectionVariables, effectiveRemoteAs, remoteAsOverridden, editServiceValue, normalizeInterfaceAddress, combinedTemplate, combinedRows, prefixRows, renderCombined, serviceFields, decodeTemplates, encodeTemplates, templateFields, templateStorageKey, type CombinedSections, type ConfigRow, type ConfigTemplate } from "./config-templates";
import { builtinRows, builtinTemplates, templateNotes } from "./vendor-config-templates";

export function TemplateGenerator() {
  const [initial] = useState(() => {
    try { return { templates: decodeTemplates(localStorage.getItem(templateStorageKey)), error: "" }; }
    catch { return { templates: [] as ConfigTemplate[], error: "Could not load saved templates. Existing storage will be preserved until you save." }; }
  });
  const [templates, setTemplates] = useState(initial.templates);
  const [rawText, setText] = useState(combinedTemplate.text);
  const [rawCombined, setCombined] = useState<CombinedSections | undefined>(combinedTemplate.combined);
  const [rows, setRows] = useState<ConfigRow[]>(combinedRows);
  const [prefixes, setPrefixes] = useState<ConfigRow[]>(prefixRows);
  const [selected, setSelected] = useState(combinedTemplate.id);
  const [baseline, setBaseline] = useState(JSON.stringify([combinedTemplate.text, combinedTemplate.combined]));
  const [notice, setNotice] = useState(initial.error);
  const editor = useRef<HTMLTextAreaElement>(null);
  const current = normalizeConfigTemplate({ id: selected, name: "", text: rawText, fields: templateFields(rawText), ...(rawCombined ? { combined: rawCombined } : {}) });
  const { text, combined } = current;
  const sectionInputs = useRef(new Map<string, HTMLTextAreaElement>());
  const fieldOrder = ["interface", "logical_system", "vlan", "vpn", "ip", "mask", "peer_ip", "peer_as", "import_policy", "export_policy", "advertise_default"];
  const fields = serviceFields(current).sort((a, b) => (fieldOrder.includes(a) ? fieldOrder.indexOf(a) : 99) - (fieldOrder.includes(b) ? fieldOrder.indexOf(b) : 99));
  const result = renderCombined(current, rows, prefixes);
  const signature = JSON.stringify([text, combined]);
  const preview = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (preview.current) { preview.current.scrollLeft = 0; preview.current.scrollTop = 0; }
  }, [result.text]);
  function updateSection(key: keyof CombinedSections, value: string) {
    setCombined(previous => previous ? { ...previous, [key]: value } : previous);
  }
  function persist(next: ConfigTemplate[]) {
    try {
      const encoded = encodeTemplates(next);
      decodeTemplates(encoded);
      localStorage.setItem(templateStorageKey, encoded);
      setTemplates(next); setNotice("Template saved."); return true;
    } catch { setNotice("Could not save templates. Your current commands and rows are still available."); return false; }
  }
  async function load(id: string) {
    const builtin = builtinTemplates.find(item => item.id === id);
    const target = builtin ?? templates.find(item => item.id === id);
    if (!target) return;
    if ((signature !== baseline || [...rows, ...prefixes].some(row => Object.values(row).some(value => value.trim()))) && !await confirmAction("Replace the current commands and rows? Unsaved edits and row data will be discarded.")) return;
    setText(target.text); setCombined(target.combined); setBaseline(JSON.stringify([target.text, target.combined])); setSelected(id);
    setRows(builtinRows(id));
    setPrefixes(builtin?.combined ? prefixRows() : [{}]); setNotice("");
  }
  async function save(asNew: boolean) {
    const existing = templates.find(item => item.id === selected);
    const name = asNew ? (await promptText("Template name", existing?.name ?? ""))?.trim() : existing?.name;
    if (!name) return;
    if (name.length > 100) { setNotice("Use a template name of up to 100 characters."); return; }
    const item = { ...current, id: asNew ? crypto.randomUUID() : selected, name, fields: templateFields(text) };
    if (persist(asNew ? [...templates, item] : templates.map(value => value.id === selected ? item : value))) {
      setSelected(item.id); setBaseline(signature);
    }
  }
  async function remove() {
    if (!await confirmAction("Delete this saved template? Current commands and rows will remain in the editor.")) return;
    if (persist(templates.filter(item => item.id !== selected))) { setSelected(""); setNotice("Template deleted."); }
  }
  function insert(field: string, section: "interface" | "prefixes" | "policy" | "header" | "peer" = "interface") {
    const input = section === "interface" ? editor.current : sectionInputs.current.get(section);
    if (!input) return;
    const token = `{{${field}}}`, at = input.selectionStart;
    const next = input.value.slice(0, at) + token + input.value.slice(input.selectionEnd);
    if (section === "interface") setText(next); else updateSection(section, next);
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(at + token.length, at + token.length); });
  }
  async function copy() {
    try { await writeClipboardText(result.text); setNotice("Copied configuration."); }
    catch { setNotice("Could not copy. Select the preview text and copy manually."); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([result.text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "generated-config.txt"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const bgpFields = combined ? fields.filter(field => ["peer_ip", "peer_as", "import_policy", "export_policy", ...(combined.checkboxFields ?? [])].includes(field)) : [];
  const interfaceFields = fields.filter(field => !bgpFields.includes(field));
  const labels: Record<string, string> = { interface: "Interface", vlan: "VLAN", vpn: "VPN", ip: "IP / CIDR", mask: "Subnet mask", logical_system: "Logical system", peer_ip: "Peer IP", peer_as: "Peer ASN", import_policy: "Import policy", export_policy: "Export policy", advertise_default: "Default route" };
  function renderServiceInput(row: ConfigRow, index: number, field: string) {
    const change = (value: string) => setRows(values => values.map((item, at) => at === index ? editServiceValue(item, field, value) : item));
    if (field === "peer_as" && combined) {
      const override = remoteAsOverridden(row, combined);
      return <div className="generator-cell-input">
        <input aria-label={`Row ${index + 1} peer_as`} disabled={!override} value={effectiveRemoteAs(row, combined)} placeholder="Shared ASN" onChange={event => change(event.target.value)} />
        <label className="generator-peer-auto"><input type="checkbox" aria-label={`Row ${index + 1} override remote BGP AS`} checked={override} onChange={event => setRows(values => values.map((value, at) => at === index ? { ...value, peer_as_override: event.target.checked ? "true" : "false", peer_as: event.target.checked ? value.peer_as || combined.remoteAs || "" : "" } : value))} />Override</label>
      </div>;
    }
    if (combined?.checkboxFields.includes(field)) return <input type="checkbox" aria-label={`Row ${index + 1} ${field}`} checked={row[field] === "true"} onChange={event => change(event.target.checked ? "true" : "")} />;
    return <div className="generator-cell-input">
      <input aria-label={`Row ${index + 1} ${field}`} value={Object.hasOwn(row, field) ? row[field] : ""} placeholder={field === "ip" ? "192.0.2.1/30" : field === "mask" ? "255.255.255.252" : undefined} maxLength={10000} onBlur={() => {
        if (field === "ip" || field === "mask") setRows(values => values.map((value, at) => { if (at !== index) return value; try { return normalizeInterfaceAddress(value); } catch { return value; } }));
      }} onChange={event => change(event.target.value)} />
      {field === "peer_ip" && <label className="generator-peer-auto"><input type="checkbox" aria-label={`Row ${index + 1} automatic peer IP`} checked={row.peer_ip_mode !== "manual"} onChange={event => setRows(values => values.map((value, at) => at === index ? editServiceValue(value, "peer_ip_mode", event.target.checked ? "auto" : "manual") : value))} />Auto</label>}
    </div>;
  }
  function renderServiceTable(columns: string[], peers = false) {
    return <div className="generator-table-scroll"><table className="generator-data-table generator-service-table"><thead><tr><th scope="col">{peers ? "Service" : "Row"}</th>{columns.map(field => <th scope="col" data-field={field} key={field}>{labels[field] ?? field}</th>)}{!peers && <th scope="col">Actions</th>}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}><th scope="row">{peers ? row.vpn || `Row ${index + 1}` : index + 1}</th>{columns.map(field => <td key={field} data-field={field}>{renderServiceInput(row, index, field)}</td>)}{!peers && <td><div className="generator-row-actions">
        <button className="outline-button" disabled={rows.length >= 10000} aria-label={`Duplicate row ${index + 1}`} onClick={() => setRows(values => values.flatMap((value, at) => at === index ? [value, { ...value }] : [value]))}>Duplicate</button>
        <button className="outline-button" aria-label={`Remove row ${index + 1}`} onClick={() => setRows(values => values.filter((_, at) => at !== index))}>Remove</button>
      </div></td>}</tr>)}</tbody></table></div>;
  }
  return <div className="template-workspace">
    <div className="generator-actions">
      <label>Template <select aria-label="Saved template" value={selected} onChange={event => void load(event.target.value)}>
        <option value="" disabled>Unsaved template</option>{builtinTemplates.map(item => <option key={item.id} value={item.id}>{item.name} (example)</option>)}
        {templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <button className="outline-button" onClick={() => void save(true)}>Save as</button>
      <button className="outline-button" disabled={!templates.some(item => item.id === selected)} onClick={() => void save(false)}>Update</button>
      <button className="outline-button" disabled={!templates.some(item => item.id === selected)} onClick={() => void remove()}>Delete</button>
    </div>
    {notice && <p role="status">{notice}</p>}
    {combined?.platform && <details className="template-notes"><summary>Template notes</summary><p role="note">{templateNotes(combined.platform)} Commands are generated for review; they are not applied to a device.</p></details>}
    {combined?.logicalSystems && <details className="template-notes"><summary>Logical-system setup</summary><p role="note">Set logical_system for each service (initially LS-IPBW, LS-GGC, LS-FNA, LS-CDN and LS-BDIX). Prefix filters, policies, routing options and BGP are generated inside each logical system. Shared logical-system names reuse one policy definition. Physical interface tagging stays at the master level; configure ae members there. Referenced CLIENT export policies must exist in the corresponding logical system.</p></details>}
    <div className="generator-columns"><div className="generator-builder">
      <section className="generator-card generator-services"><h3>Interface and service variables</h3>
        <p>Enter an IP/CIDR or subnet mask. Peer IP updates automatically; edit it to override.</p>
        {renderServiceTable(interfaceFields)}
        <button className="outline-button" disabled={rows.length >= 10000} onClick={() => setRows(values => [...values, {}])}>Add row</button>
        {bgpFields.length > 0 && <><h4>BGP peers and policies</h4>{renderServiceTable(bgpFields, true)}</>}
      </section>
      {combined && <section className="generator-card"><h3>Shared settings</h3>
        <div className="generator-range"><label>Local BGP AS<input aria-label="Local BGP AS" value={combined.localAs} onChange={event => updateSection("localAs", event.target.value)} /></label><label>Remote BGP AS<input aria-label="Remote BGP AS" value={combined.remoteAs ?? ""} placeholder="Shared peer ASN" onChange={event => updateSection("remoteAs", event.target.value)} /></label><label>Prefix / policy name<input aria-label="Prefix policy name" value={combined.policyName} onChange={event => updateSection("policyName", event.target.value)} /></label></div>
        <p>Remote BGP AS applies to all services unless Override is enabled for a peer. Policy name is used by the prefix list and route-policy. Set each service’s import_policy to the matching name.</p>
      </section>}
      {combined && <section className="generator-card"><h3>Prefix entries</h3><p>Blank ge / le values omit the corresponding match limit. Prefix row values are not saved.</p>
        <div className="generator-table-scroll"><table className="generator-data-table"><thead><tr>{["index", "action", "network", "length", "ge", "le", "Actions"].map(field => <th key={field} scope="col">{field}</th>)}</tr></thead><tbody>{prefixes.map((row, index) => <tr key={index}>{["index", "action", "network", "length", "ge", "le"].map(field => <td key={field}><input aria-label={`Prefix ${index + 1} ${field}`} value={row[field] ?? ""} maxLength={10000} onChange={event => setPrefixes(values => values.map((value, at) => at === index ? { ...value, [field]: event.target.value } : value))} /></td>)}<td><button className="outline-button" aria-label={`Remove prefix ${index + 1}`} onClick={() => setPrefixes(values => values.filter((_, at) => at !== index))}>Remove</button></td></tr>)}</tbody></table></div>
        <button className="outline-button" disabled={prefixes.length >= 10000} onClick={() => setPrefixes(values => [...values, {}])}>Add prefix</button>
      </section>}
      <details className="generator-card template-editors"><summary>Edit command templates</summary><div className="generator-builder">
      <section className="generator-card"><h3>{combined ? "Interface commands · per service" : "Commands template"}</h3>
        <p>Use named fields such as <code>{"{{vlan}}"}</code>. Each row produces one block. Field names use letters, digits and underscores, starting with a letter or underscore.</p>
        <textarea ref={editor} className="generator-simple-editor" aria-label="Configuration template" value={text} maxLength={10000} spellCheck={false} onChange={event => setText(event.target.value)} />
        <div className="generator-number-buttons">{fields.map(field => <button key={field} className="generator-number" onClick={() => insert(field)}>Insert {field}</button>)}</div>
      </section>
      {combined && <section className="generator-card"><h3>Policy and BGP commands</h3>


        <p>Shared variables: <code>{"{{local_as}}"}</code> = Local BGP AS, <code>{"{{remote_as}}"}</code> = shared Remote BGP AS, <code>{"{{policy_name}}"}</code> = Prefix / policy name. Set these in Shared settings above.</p>
        {([ ["prefixes", "Prefix command · per prefix"], ["policy", "Import route-policy · once"], ["header", "BGP header · once"], ["peer", "VPN peer commands · per service"] ] as const).map(([key, label]) => <div className="generator-section-editor" key={key}>
          <label htmlFor={`generator-section-${key}`}>{label}</label>
          <textarea id={`generator-section-${key}`} ref={node => { if (node) sectionInputs.current.set(key, node); else sectionInputs.current.delete(key); }} className="generator-simple-editor" aria-label={label} value={combined[key]} maxLength={10000} spellCheck={false} onChange={event => updateSection(key, event.target.value)} />
          <div className="generator-number-buttons" role="group" aria-label={`${label} variables`}>{templateSectionVariables(current, key).map(field => <button key={field} className="generator-number" onClick={() => insert(field, key)} title={`Insert {{${field}}} at the cursor`}>{`{{${field}}}`}</button>)}</div>
          <p>{key === "prefixes" ? "Prefix values come from Prefix entries above. IOS XR combines permitted entries into one prefix set." : key === "peer" ? "Peer values come from Interface and service variables / BGP peers and policies. peer_as uses the shared ASN unless overridden." : key === "policy" && combined.platform === "iosxr" ? "prefix_rules is generated from Prefix entries; it is not a separate value to fill in." : "Values come from Shared settings above."}</p>
        </div>)}
        <p>Wrap optional peer commands in <code>{"{{#advertise_default}}…{{/advertise_default}}"}</code>. Prefix ge and le fields use the same conditional syntax.</p>
      </section>}
      </div></details>
    </div><section className="generator-card generator-preview"><h3>Result</h3><p>{result.count} blocks · Updates as you type</p>
      {result.errors.length > 0 && <div role="alert">{result.errors.slice(0, 20).map((error, index) => <p key={index}>{error}</p>)}{result.errors.length > 20 && <p>More rows need attention.</p>}</div>}
      <textarea ref={preview} aria-label="Template configuration preview" readOnly value={result.text} spellCheck={false} />
      <div className="generator-actions"><button className="primary-button" disabled={!result.text} onClick={() => void copy()}>Copy all</button><button className="outline-button" disabled={!result.text} onClick={download}>Save .txt</button></div>
    </section></div>
  </div>;
}
