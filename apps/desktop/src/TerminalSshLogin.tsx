import { useEffect, useRef, useSyncExternalStore } from "react";
import { TerminalAuthentication } from "./terminal-authentication";
import { terminalThemes, type ColorTheme } from "./theme";

export function TerminalSshLogin({ authentication, connecting, label, colorTheme, fontSize }: {
  authentication: TerminalAuthentication; connecting: boolean; label: string; colorTheme: ColorTheme; fontSize: number;
}) {
  const question = useSyncExternalStore(authentication.subscribe, authentication.getSnapshot);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const field = input.current;
    if (field) { field.value = ""; field.focus(); }
    return () => { if (field) field.value = ""; };
  }, [question]);
  if (!connecting && !question) return null;
  return <section className="terminal-ssh-login" aria-label={`SSH login for ${label}`} style={{ background: terminalThemes[colorTheme].background, color: terminalThemes[colorTheme].foreground, fontSize }}>
    <p>{question ? "Password required" : `Connecting to ${label}…`}</p>
    {question ? <form key={question.message} onSubmit={event => {
      event.preventDefault();
      const field = input.current;
      const value = field?.value ?? "";
      if (field) field.value = "";
      authentication.submit(value);
    }} onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape" || (event.ctrlKey && event.key === "c")) { event.preventDefault(); authentication.submit(null); } }}>
      <pre>{question.message}</pre>
      <label>Password: <input ref={input} type="password" maxLength={16384} aria-label="SSH password" autoComplete="off" autoCapitalize="off" spellCheck={false} /></label>
      <p className="terminal-login-help">Enter to continue · Ctrl+C or Escape to cancel</p>
    </form> : <p role="status">Waiting for the SSH server…</p>}
  </section>;
}
