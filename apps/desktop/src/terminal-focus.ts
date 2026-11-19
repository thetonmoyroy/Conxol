/** Focus a rendered terminal pane only while it still owns the ready selection. */
export function focusConnectedTerminal(terminal: { element?: HTMLElement; focus(): void }, stillSelected: () => boolean): void {
  window.requestAnimationFrame(() => {
    const host = terminal.element;
    const active = document.activeElement;
    if (!stillSelected() || !host?.isConnected || host.closest('[hidden], [aria-hidden="true"]')) return;
    if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
    // Tab cycling may leave focus in the previous pane's xterm textarea.
    // Allow that handoff while preserving search, login and other form inputs.
    if (active?.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
      && !host.contains(active) && !active.closest?.(".terminal-host")) return;
    terminal.focus();
  });
}
