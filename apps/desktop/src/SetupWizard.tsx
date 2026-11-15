import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "./App";
import { WorkspaceLockSettings } from "./WorkspaceSecurity";
import { useWorkspaceLock } from "./workspace-lock-state";
import { appThemeVariables, terminalPresets, terminalThemes, themeMode, type ColorTheme, type ThemePreference } from "./theme";

const native = "__TAURI_INTERNALS__" in window;

// Keep the workspace unmounted until setup is finished, so shortcuts and startup
// work cannot run behind the wizard.
export function FirstRunSetup({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [ready, setReady] = useState(!native);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!native) return;
    let active = true;
    void invoke<AppSettings>("settings_get").then(value => {
      if (!active) return;
      setSettings(value);
      setReady(value.general.setupComplete !== false);
      setError("");
    }).catch(() => { if (active) setError("Setup preferences could not be loaded."); });
    return () => { active = false; };
  }, [attempt]);
  if (ready) return children;
  if (!settings) return <div className="setup-surface"><section className="setup-card"><h1>Welcome to Conxol</h1><p role="status">{error || "Loading your workspace…"}</p>{error && <button className="primary-button" onClick={() => setAttempt(value => value + 1)}>Retry</button>}</section></div>;
  return <SetupWizard settings={settings} onComplete={() => setReady(true)} />;
}

function SetupWizard({ settings, onComplete }: { settings: AppSettings; onComplete: () => void }) {
  const { status } = useWorkspaceLock();
  const [step, setStep] = useState(0);
  const [theme, setTheme] = useState<ThemePreference>(settings.general.theme);
  const [fontSize, setFontSize] = useState(settings.appearance.fontSize);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const gate = useRef(false);
  const resolved: ColorTheme = theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  const colors = terminalPresets[resolved]?.theme ?? terminalThemes[themeMode(resolved)];
  const finish = async () => {
    if (gate.current || !status?.enabled || status.locked) return;
    gate.current = true; setBusy(true); setError("");
    try {
      // Read again so completing setup preserves any concurrent preference changes.
      const current = await invoke<AppSettings>("settings_get");
      await invoke("settings_save", { settings: {
        ...current,
        general: { ...current.general, theme, setupComplete: true },
        appearance: { ...current.appearance, fontSize },
        terminal: { ...current.terminal, colorTheme: "", background: "", foreground: "" },
      } });
      try { localStorage.setItem("conxol-theme", theme); } catch { /* Native settings are authoritative. */ }
      onComplete();
    } catch { setError("Your preferences could not be saved. Please try again."); }
    finally { gate.current = false; setBusy(false); }
  };
  return <div className="setup-surface" style={appThemeVariables(resolved) as CSSProperties} data-theme={themeMode(resolved)}>
    <div className="setup-workspace-preview" aria-hidden="true" inert>
      <div className="setup-preview-menu">Terminal  Sessions  View  Tools  Settings  Help</div>
      <div className="setup-preview-body">
        <aside className="setup-preview-rail">⌘<br />▤<br />⚙</aside>
        <aside className="setup-preview-sidebar"><strong>User sessions</strong><div className="setup-preview-search">Find a session</div><p>⌄ Local terminals</p><span>  › Default shell</span><p>⌄ Remote sessions</p></aside>
        <main className="setup-preview-main"><div className="setup-preview-tabs">⌂ Home   ＋</div><div className="setup-preview-home"><span className="setup-preview-logo">C</span><strong>Conxol</strong><p>Your network, in command</p><div className="setup-preview-tiles"><span>＋ New session</span><span>›_ Local terminal</span><span>⌕ Network tools</span></div></div></main>
      </div>
    </div>
    <section className="setup-card" aria-labelledby="setup-heading">
      <span className="setup-brand">Conxol</span>
      <ol className="setup-steps" aria-label="Setup progress">
        <li aria-current={step === 0 ? "step" : undefined}>1 · Security</li>
        <li aria-current={step === 1 ? "step" : undefined}>2 · Appearance</li>
      </ol>
      {step === 0 ? <div key="security">
        <h1 id="setup-heading">Set your PIN</h1>
        <p>Protect your workspace, saved passwords and backups.</p>
        <WorkspaceLockSettings initialSetup onSetupComplete={() => setStep(1)} />
        {status?.enabled && <footer className="setup-actions"><button className="primary-button" type="button" onClick={() => setStep(1)}>Continue</button></footer>}
      </div> : <div key="appearance">
        <h1 id="setup-heading">Make it yours</h1>
        <p>Choose a theme and comfortable text size.</p>
        <div className="settings-grid">
          <label>Theme<select autoFocus value={theme} disabled={busy} onChange={event => setTheme(event.target.value as ThemePreference)}>
            <option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option>
            {Object.entries(terminalPresets).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}
          </select></label>
          <label>Terminal font size<select value={fontSize} disabled={busy} onChange={event => setFontSize(Number(event.target.value))}>
            {Array.from(new Set([12, 14, 16, 18, 20, fontSize])).sort((a, b) => a - b).map(size => <option key={size} value={size}>{size} px</option>)}
          </select></label>
        </div>
        <div className="setup-terminal-preview" aria-label="Terminal appearance preview" style={{ background: colors.background, color: colors.foreground, fontSize }}>
          <span style={{ color: colors.green }}>user@conxol</span> ~<br /><span style={{ color: colors.blue }}>$</span> Welcome to your workspace<span className="setup-cursor">▌</span>
        </div>
        {error && <p role="alert">{error}</p>}
        <footer className="setup-actions"><button className="outline-button" type="button" disabled={busy} onClick={() => setStep(0)}>Back</button><button className="primary-button" type="button" disabled={busy} onClick={() => void finish()}>{busy ? "Saving…" : "Finish setup"}</button></footer>
      </div>}
    </section>
  </div>;
}
