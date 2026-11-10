import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { X } from "lucide-react";
import { defaultHighlightRules, getHighlightRules, saveHighlightRules, MAX_HIGHLIGHT_RULES, MAX_HIGHLIGHT_TEXT, MAX_GROUP_WORDS, builtinHighlightWords, type HighlightRule } from "./network-highlighting";

const defaultGroups = [
  { name: "Turned-on ports", examples: "no shutdown, undo shutdown" },
  { name: "Errors and problems", examples: "down, failed, denied, error…" },
  { name: "Healthy status", examples: "up, connected, success, active…" },
  { name: "Warnings", examples: "warning, timeout, dropped, blocking…" },
  { name: "Port names", examples: "GigabitEthernet0/1, Vlan100, ge-0/0/0…" },
  { name: "Commands", examples: "show, display, configure, save…" },
  { name: "Network words", examples: "interface, router, BGP, VLAN…" },
];

function WordList(props: ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    const resize = () => {
      field.style.height = "0px";
      field.style.height = `${Math.max(32, field.scrollHeight + 2)}px`;
    };
    resize();
    let width = field.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = field.getBoundingClientRect().width;
      if (next !== width) { width = next; resize(); }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [props.value]);
  return <textarea {...props} ref={ref} rows={1} wrap="soft" />;
}

export function SyntaxHighlightSettings({ onClose, embedded = false, onRulesChange }: { onClose: () => void; embedded?: boolean; onRulesChange?: (rules: HighlightRule[]) => void }) {
  const formRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (embedded) return;
    const previous = document.activeElement;
    formRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [embedded]);
  const [rules, setRules] = useState(getHighlightRules);
  useEffect(() => { onRulesChange?.(rules); }, [rules, onRulesChange]);
  const Form = embedded ? "div" : "form";
  const [error, setError] = useState("");
  const update = (id: string, patch: Partial<HighlightRule>) => setRules(current => current.map(rule => rule.id === id ? { ...rule, ...patch } : rule));
  return <div className={embedded ? "syntax-settings-embedded" : "palette-backdrop"} onMouseDown={embedded ? undefined : onClose}>
    <Form ref={(node: HTMLFormElement | HTMLDivElement | null) => { formRef.current = node; }} onKeyDown={event => { if (!embedded && event.key === "Escape") { event.stopPropagation(); onClose(); } }} className="syntax-settings" role={embedded ? undefined : "dialog"} aria-modal={embedded ? undefined : true} aria-labelledby="syntax-settings-title" onMouseDown={event => event.stopPropagation()} onSubmit={event => {
      event.preventDefault();
      const tooManyWords = rules.some(rule => rule.words !== undefined && (rule.words.split(",").filter(word => word.trim()).length > MAX_GROUP_WORDS || rule.words.split(",").some(word => word.trim().length > MAX_HIGHLIGHT_TEXT)));
      if (tooManyWords) { setError(`Use up to ${MAX_GROUP_WORDS} words per list, with up to ${MAX_HIGHLIGHT_TEXT} characters each.`); return; }
      try { saveHighlightRules(rules); onClose(); } catch { setError("Could not save highlighting settings. Please try again."); }
    }}>
      {!embedded && <div className="quick-connect-heading"><h2 id="syntax-settings-title">Highlight words</h2><button type="button" className="icon-button" aria-label="Close syntax highlighting" onClick={onClose}><X size={17} /></button></div>}
      <p>Separate words with commas, then pick a color. Capital letters don’t matter. Up to {MAX_GROUP_WORDS} words per list.</p>
      <div className="syntax-rules">
        {rules.map((rule, index) => <div className="syntax-rule" key={rule.id}>
          {rule.builtin === undefined ? <label><span>Word or phrase</span><input aria-label={`Word or phrase ${index + 1}`} placeholder="e.g. offline" required maxLength={MAX_HIGHLIGHT_TEXT} value={rule.text} onChange={event => update(rule.id, { text: event.target.value })} /></label> : rule.builtin === 4 ? <div className="syntax-default-group"><strong>Port names (automatic)</strong><small>{defaultGroups[4].examples}</small><small>Recognizes numbered network ports automatically.</small></div> : <label><span className="syntax-list-label">{defaultGroups[rule.builtin].name}<small>{(rule.words ?? builtinHighlightWords(rule.builtin)).split(",").filter(word => word.trim()).length}/{MAX_GROUP_WORDS}</small></span><WordList aria-label={`${defaultGroups[rule.builtin].name} words`} maxLength={MAX_GROUP_WORDS * (MAX_HIGHLIGHT_TEXT + 1)} value={rule.words ?? builtinHighlightWords(rule.builtin)} onChange={event => update(rule.id, { words: event.target.value.replace(/[\r\n]+/g, " ") })} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} /></label>}

          <label><span>Color</span><input aria-label={`Color ${index + 1}`} type="color" value={rule.color} onChange={event => update(rule.id, { color: event.target.value })} /></label>
          <button type="button" className="outline-button" aria-label={`Remove match ${index + 1}`} onClick={() => setRules(current => current.filter(item => item.id !== rule.id))}>Remove</button>
        </div>)}
        {!rules.length && <p>No words yet. Add your first word below.</p>}
      </div>
      <div className="syntax-rule-actions"><button type="button" className="outline-button" disabled={rules.length >= MAX_HIGHLIGHT_RULES} onClick={() => setRules(current => [...current, { id: crypto.randomUUID(), text: "", color: "#e8b45c" }])}>Add a word</button><span>{rules.length} of {MAX_HIGHLIGHT_RULES} available</span><button type="button" className="outline-button" onClick={() => setRules(defaultHighlightRules())}>Reset to defaults</button></div>
      {error && <p role="alert">{error}</p>}
      <p>Colors already sent by your device stay as they are.</p>
      {!embedded && <div className="syntax-footer"><button type="button" className="outline-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">{embedded ? "Save highlighting" : "Save"}</button></div>}
    </Form>
  </div>;
}
