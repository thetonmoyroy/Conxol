import { useEffect, useRef, useState, type PointerEvent, type DragEvent } from "react";
import { ArrowDown, ArrowUp, Copy, Download, GripVertical, Plus, Trash2 } from "lucide-react";
import { writeClipboardText } from "./clipboard-access";
import { generateConfig, simpleSections, replaceSimpleSection, isLoop, findBlock, editBlocks, removeBlock, moveBlock, type GeneratorBlock } from "./config-generator";
import "./config-generator.css";
import { TemplateGenerator } from "./TemplateGenerator";

const example = (): GeneratorBlock[] => [{ id: crypto.randomUUID(), text: "interface eth 0/{n}\n no shutdown" }];
const dragType = "application/x-conxol-generator";
const token = (depth: number) => depth === 1 ? "{n}" : `{n${depth}}`;

export function ConfigGenerator() {
  const [mode, setMode] = useState("templates");
  return <div>
    <div className="generator-mode generator-actions" role="group" aria-label="Generator mode">
      <button className="outline-button" aria-pressed={mode === "templates"} onClick={() => setMode("templates")}>Template + rows</button>
      <button className="outline-button" aria-pressed={mode === "numbers"} onClick={() => setMode("numbers")}>Numeric loops</button>
    </div>
    <section className="config-generator" aria-label="Template configuration generator" hidden={mode !== "templates"}><header className="generator-heading"><div><h2>Generator</h2><p>Write a template. Fill the rows. Copy the result.</p></div></header><TemplateGenerator /></section>
    <div hidden={mode !== "numbers"}><NumericGenerator /></div>
  </div>;
}

function NumericGenerator() {
  const [commands, setCommands] = useState<GeneratorBlock[]>(example);
  const [start, setStart] = useState("1"), [end, setEnd] = useState("24"), [step, setStep] = useState("1");
  const [advanced, setAdvanced] = useState(false);
  const previewInput = useRef<HTMLTextAreaElement>(null);
  const simpleInput = useRef<HTMLTextAreaElement>(null);
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const suppressClick = useRef(false);
  const inputs = useRef(new Map<string, HTMLTextAreaElement>());
  const result = generateConfig(commands, start, end, step);
  useEffect(() => {
    const preview = previewInput.current;
    if (preview) { preview.scrollTop = 0; preview.scrollLeft = 0; }
    setNotice("");
  }, [result.text]);
  // A single chain uses one editor; branching layouts use compact sections in order.
  const chain: Extract<GeneratorBlock, { kind: "loop" }>[] = [];
  let leaves = commands;
  while (leaves.length === 1 && isLoop(leaves[0])) { chain.push(leaves[0]); leaves = leaves[0].children; }
  const canSimplify = leaves.every(block => !isLoop(block));
  const template = leaves.map(block => isLoop(block) ? "" : block.text).join("\n");
  const simpleParent = chain.at(-1)?.id ?? "root";
  function setTemplate(text: string) {
    const block = { id: leaves[0]?.id ?? crypto.randomUUID(), text };
    change(tree => simpleParent === "root" ? [block] : editBlocks(tree, simpleParent, item => isLoop(item) ? { ...item, children: [block] } : item));
  }
  function simpleNumber(number: string) {
    const input = simpleInput.current;
    if (!input) return;
    const at = input.selectionStart;
    setTemplate(template.slice(0, at) + number + template.slice(input.selectionEnd));
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(at + number.length, at + number.length); });
  }
  function addNumber() {
    change(tree => {
      const wrap = (children: GeneratorBlock[]): GeneratorBlock[] => [{ id: crypto.randomUUID(), kind: "loop", start: "1", end: "4", step: "1", children }];
      return simpleParent === "root" ? wrap(tree) : editBlocks(tree, simpleParent, item => isLoop(item) ? { ...item, children: wrap(item.children) } : item);
    });
  }
  function change(edit: (items: GeneratorBlock[]) => GeneratorBlock[]) { setCommands(edit); setNotice(""); }
  function update(id: string, text: string) { change(items => editBlocks(items, id, block => isLoop(block) ? block : { ...block, text })); }
  function add(parent: string, loop = false) {
    const block: GeneratorBlock = loop ? { id: crypto.randomUUID(), kind: "loop", start: "1", end: "4", step: "1", children: [] } : { id: crypto.randomUUID(), text: "" };
    change(items => parent === "root" ? [...items, block] : editBlocks(items, parent, item => isLoop(item) ? { ...item, children: [...item.children, block] } : item));
  }
  function insertNumber(id: string, number: string) {
    const input = inputs.current.get(id), item = findBlock(commands, id);
    if (!input || !item || isLoop(item)) return;
    const at = input.selectionStart;
    update(id, item.text.slice(0, at) + number + item.text.slice(input.selectionEnd));
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(at + number.length, at + number.length); });
  }
  function drop(value: string, target: Element | null) {
    const row = target?.closest<HTMLElement>("[data-generator-command]");
    const box = target?.closest<HTMLElement>("[data-generator-parent]");
    if (value.startsWith("number:") && target?.closest(".generator-simple-editor")) simpleNumber(value.slice(7));
    else if (value.startsWith("number:") && row?.dataset.generatorCommand) insertNumber(row.dataset.generatorCommand, value.slice(7));
    else if (box) {
      const parent = box.dataset.generatorParent!;
      if (value === "new" || value === "loop") add(parent, value === "loop");
      else if (value.startsWith("move:")) change(items => moveBlock(items, value.slice(5), parent, row?.dataset.generatorCommand));
    }
  }
  function pointerDrag(event: PointerEvent<HTMLElement>, value: string) {
    const x = event.clientX, y = event.clientY;
    if (event.button !== 0) return;
    event.preventDefault();
    const moving = (move: globalThis.PointerEvent) => { if (Math.hypot(move.clientX - x, move.clientY - y) >= 5) setDragging(true); };
    const cancel = () => { window.removeEventListener("pointerup", finish); window.removeEventListener("pointermove", moving); window.removeEventListener("pointercancel", cancel); setDragging(false); };
    const finish = (up: globalThis.PointerEvent) => { cancel(); if (Math.hypot(up.clientX - x, up.clientY - y) >= 5) { suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0); drop(value, document.elementFromPoint(up.clientX, up.clientY)); } };
    window.addEventListener("pointermove", moving);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
  }
  const dragProps = (value: string) => ({ draggable: true, onPointerDown: (event: PointerEvent<HTMLElement>) => pointerDrag(event, value), onDragStart: (event: DragEvent<HTMLElement>) => event.dataTransfer.setData(dragType, value) });
  function rangeFields(values: string[], updateRange: (index: number, value: string) => void, name: string, compact = false) {
    const field = (label: string, index: number) => <label key={label}>{label}<input aria-label={`${name} ${label}`} type="number" step="1" value={values[index]} onChange={event => { updateRange(index, event.target.value); setNotice(""); }} /></label>;
    return <div className="generator-range">{field("From", 0)}{field("To", 1)}{compact ? <details className="generator-step"><summary>{values[2] === "1" ? "Count by" : `Step: ${values[2]}`}</summary><input aria-label={`${name} Count by`} type="number" step="1" value={values[2]} onChange={event => { updateRange(2, event.target.value); setNotice(""); }} /></details> : field("Count by", 2)}</div>;
  }
  function renderBlocks(items: GeneratorBlock[], parent: string, depth: number) {
    return <div className="generator-loop" data-generator-parent={parent}>
      <strong>Repeat for each number in Loop {depth} · {token(depth)}</strong>
      {items.map((block, index) => <div className={`generator-command ${isLoop(block) ? "generator-nested" : ""}`} data-generator-command={block.id} key={block.id}>
        <div className="generator-command-tools"><span {...dragProps(`move:${block.id}`)} title="Drag to move"><GripVertical size={16} /></span><span>{isLoop(block) ? `Loop ${depth + 1}` : `Command ${index + 1}`}</span>
          <button aria-label={`Move block ${index + 1} up in Loop ${depth}`} disabled={index === 0} onClick={() => change(tree => moveBlock(tree, block.id, parent, items[index - 1].id))}><ArrowUp size={14} /></button>
          <button aria-label={`Move block ${index + 1} down in Loop ${depth}`} disabled={index === items.length - 1} onClick={() => change(tree => moveBlock(tree, block.id, parent, items[index + 2]?.id))}><ArrowDown size={14} /></button>
          <button aria-label={`Remove ${isLoop(block) ? "loop and its contents" : "command"} ${index + 1}`} onClick={() => change(tree => removeBlock(tree, block.id))}><Trash2 size={14} /></button>
        </div>
        {isLoop(block) ? <>
          {rangeFields([block.start, block.end, block.step], (field, value) => change(tree => editBlocks(tree, block.id, item => isLoop(item) ? { ...item, [(["start", "end", "step"] as const)[field]]: value } : item)), `Loop ${depth + 1}`)}
          <p>For each Loop {depth} number, run all numbers in this loop.</p>
          {renderBlocks(block.children, block.id, depth + 1)}
        </> : <>
          <div className="generator-number-buttons">{Array.from({ length: depth }, (_, level) => <button key={level} className="generator-number" {...dragProps(`number:${token(level + 1)}`)} onClick={() => insertNumber(block.id, token(level + 1))}>+ Loop {level + 1} number</button>)}</div>
          <textarea aria-label={`Command ${index + 1} in Loop ${depth}`} ref={element => { if (element) inputs.current.set(block.id, element); else inputs.current.delete(block.id); }} value={block.text} placeholder="Type a command, then add a loop number above" maxLength={10000} rows={2} onChange={event => update(block.id, event.target.value)} />
        </>}
      </div>)}
      <div className="generator-actions"><button className="outline-button" onClick={() => add(parent)}><Plus size={14} /> Add command</button><button className="outline-button" disabled={depth >= 8} onClick={() => add(parent, true)}><Plus size={14} /> Add inner loop</button></div>
    </div>;
  }
  function renderSimpleSections(items: GeneratorBlock[], parent: string, depth: number) {
    return <div className="generator-simple-sections">{simpleSections(items).map((section, index) => {
      if (!Array.isArray(section)) return <section className="generator-simple-branch" key={section.id}>
        <h4>Repeat with number {String.fromCharCode(65 + depth)} · {token(depth + 1)}</h4>
        {rangeFields([section.start, section.end, section.step], (field, value) => change(tree => editBlocks(tree, section.id, item => isLoop(item) ? { ...item, [(["start", "end", "step"] as const)[field]]: value } : item)), `Section ${index + 1} number ${depth + 1}`, true)}
        {renderSimpleSections(section.children, section.id, depth + 1)}
      </section>;
      const text = section.map(command => command.text).join("\n");
      const id = section[0].id;
      const edit = (value: string) => change(tree => replaceSimpleSection(tree, parent, section.map(command => command.id), value));
      const insert = (number: string) => {
        const input = inputs.current.get(`simple:${id}`);
        if (!input) return;
        const at = input.selectionStart;
        edit(text.slice(0, at) + number + text.slice(input.selectionEnd));
        requestAnimationFrame(() => { input.focus(); input.setSelectionRange(at + number.length, at + number.length); });
      };
      return <div className="generator-simple-section" key={id}>
        <textarea aria-label={`Commands section ${index + 1} for number ${String.fromCharCode(64 + depth)}`} rows={Math.max(3, Math.min(8, text.split("\n").length + 1))} value={text} spellCheck={false} maxLength={10000} ref={element => { if (element) inputs.current.set(`simple:${id}`, element); else inputs.current.delete(`simple:${id}`); }} onChange={event => edit(event.target.value)} />
        <div className="generator-number-buttons">{Array.from({ length: depth }, (_, level) => <button key={level} className="generator-number" onClick={() => insert(token(level + 1))}>Insert number {String.fromCharCode(65 + level)} · {token(level + 1)}</button>)}</div>
      </div>;
    })}
      {!items.length && <button className="text-button" onClick={() => add(parent)}>+ Add commands</button>}
    </div>;
  }
  async function copy() {
    try { await writeClipboardText(result.text); setNotice("Copied! Paste it wherever you need it."); }
    catch { setNotice("Could not copy. Select the preview text and copy it manually."); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([result.text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "generated-config.txt"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className={`config-generator ${dragging ? "generator-dragging" : ""}`} aria-label="Configuration generator" onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }} onDragOver={event => { if (event.dataTransfer.types.includes(dragType)) event.preventDefault(); }} onDrop={event => { event.preventDefault(); drop(event.dataTransfer.getData(dragType), event.target as Element); }}>
    <header className="generator-heading"><div><h2>Generator</h2><p>Write your commands. Pick the numbers. Copy the result.</p></div><button className="outline-button" onClick={() => setAdvanced(value => !value)}>{advanced ? "Simple view" : "Advanced"}</button></header>
    <div className="generator-columns"><div className="generator-builder">
      {!advanced && canSimplify && <section className="generator-card generator-simple">
        <h3>Your commands</h3>
        <p>Select the number that changes, then click a number button below.</p>
        <textarea className="generator-simple-editor" aria-label="Commands to repeat" ref={simpleInput} value={template} rows={7} maxLength={10000} spellCheck={false} onChange={event => setTemplate(event.target.value)} />
        <div className="generator-number-buttons">{Array.from({ length: chain.length + 1 }, (_, index) => <button key={index} className="generator-number" {...dragProps(`number:${token(index + 1)}`)} onClick={() => simpleNumber(token(index + 1))}>Insert number {String.fromCharCode(65 + index)} · {token(index + 1)}</button>)}</div>
        <h3 className="generator-numbers-heading">Numbers to use</h3>
        <div className="generator-simple-ranges">
          {[null, ...chain].map((loop, index) => <div className="generator-simple-range" key={loop?.id ?? "root"}>
            <div className="generator-range-title"><strong>Number {String.fromCharCode(65 + index)}</strong><code>{token(index + 1)}</code>
              {loop && index === chain.length && <button className="text-button" disabled={template.includes(token(index + 1))} title={template.includes(token(index + 1)) ? "Remove this number from your commands first" : "Remove this number range"} onClick={() => change(tree => {
                const parent = chain[index - 2]?.id;
                return parent ? editBlocks(tree, parent, item => isLoop(item) ? { ...item, children: loop.children } : item) : loop.children;
              })}>Remove</button>}
            </div>
            {index > 0 && <p>Runs through all these numbers for each Number {String.fromCharCode(64 + index)}.</p>}
            {rangeFields(loop ? [loop.start, loop.end, loop.step] : [start, end, step], (field, value) => {
              if (!loop) [setStart, setEnd, setStep][field](value);
              else change(tree => editBlocks(tree, loop.id, item => isLoop(item) ? { ...item, [(["start", "end", "step"] as const)[field]]: value } : item));
            }, `Number ${String.fromCharCode(65 + index)}`, true)}
          </div>)}
        </div>
        <button className="text-button" disabled={chain.length >= 7} onClick={addNumber}><Plus size={14} /> Add another number</button>
      </section>}
      {!advanced && !canSimplify && <section className="generator-card generator-simple">
        <h3>Your commands</h3><p>These sections run from top to bottom. Each repeat keeps its own number range.</p>
        <div className="generator-simple-range"><div className="generator-range-title"><strong>Number A</strong><code>{token(1)}</code></div>
          {rangeFields([start, end, step], (field, value) => [setStart, setEnd, setStep][field](value), "Number A", true)}
        </div>
        {renderSimpleSections(commands, "root", 1)}
      </section>}
      <div hidden={!advanced} className="generator-builder">
      <section className="generator-card"><h3>1. Pick your numbers for Loop 1</h3>{rangeFields([start, end, step], (index, value) => [setStart, setEnd, setStep][index](value), "Loop 1")}</section>
      <section className="generator-card"><h3>2. Build your commands and loops</h3><p>Drag blocks into any loop. An inner loop finishes all its numbers before the outer loop moves on. Click a number button to insert it at the cursor.</p>
        <div className="generator-palette"><button className="outline-button" {...dragProps("new")} onClick={() => add("root")}><Plus size={14} /> Command</button><button className="outline-button" {...dragProps("loop")} onClick={() => add("root", true)}><Plus size={14} /> Inner loop</button></div>
        {renderBlocks(commands, "root", 1)}
        <p>Example: put <code>interface eth {"{n}"}/{"{n2}"}</code> inside Loop 2 to generate every slot and port combination.</p>
      </section>
    </div></div><section className="generator-card generator-preview"><h3>Result</h3><p>{result.text ? `${result.count.toLocaleString()} repeats · ${result.text.split("\n").length.toLocaleString()} lines · Updates as you type` : "Updates as you type"}</p>
      {result.error && <p role="alert">{result.error}</p>}<textarea ref={previewInput} aria-label="Generated configuration preview" readOnly value={result.text} spellCheck={false} />
      <div className="generator-actions"><button className="primary-button" disabled={!result.text} onClick={() => void copy()}><Copy size={14} /> Copy all</button><button className="outline-button" disabled={!result.text} onClick={download}><Download size={14} /> Save .txt</button></div>
      <p role="status">{notice || "Ready to copy. Commands are never run automatically."}</p>
    </section></div>
  </section>;
}
