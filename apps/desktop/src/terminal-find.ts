export type TerminalFindKey = {
  key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean;
  preventDefault(): void; stopPropagation(): void;
};
/** Capture before xterm so Find never sends Ctrl+F to the remote shell. */
export function handleTerminalFindKey(event: TerminalFindKey, allowed: boolean, configuredMatch: boolean, open: () => void): boolean {
  const standardFind = event.key.toLowerCase() === "f" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
  if (!allowed || (!standardFind && !configuredMatch)) return false;
  event.preventDefault();
  event.stopPropagation();
  open();
  return true;
}
