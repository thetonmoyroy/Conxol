# Terminal tab rearranging and detached windows

Drag a session tab horizontally to reorder it. Home remains fixed. Near the
strip edges, dragging scrolls the strip. Alt+Shift+Left/Right and the tab context
menu provide the same movement. Session identity, the selected tab and split
ratios stay unchanged; keyboard cycling follows the displayed order.

On native desktop, right-click a connected tab and choose **Move to new window**.
**Return to main window**, the tab context menu, or the detached window's close
button returns the session. **Close session** closes the actual transport.
Pending authentication, disconnected sessions, Android and browser preview do not
offer detaching. Authentication/reconnect and broadcast/macro activity return
detached sessions to the workspace. The main application must remain running;
exiting it closes its sessions, including detached views.

## Implementation

The existing Rust connection managers and main renderer retain session lifetime.
The source xterm remains mounted and retains terminal state and scrollback. It
stops accepting input and fitting its hidden DOM while detached. A local Tauri
window receives a serialized terminal snapshot and sequenced live output, with
bounded buffering. The snapshot uses a write barrier so output arriving during
serialization is neither omitted nor duplicated. Input returns through the main
renderer and its existing lifecycle-bound native FIFO. Window destruction is the
commit point for enabling the source input surface again.
Only the source emulator answers terminal device/status/color queries; the mirror
suppresses those reports so terminal applications receive exactly one response,
including while the initial snapshot is being prepared.

Native window registration binds each view to one workspace session. Detached
views have a narrow command allowlist and cannot open another workspace or call
connection commands. Messages are size bounded; terminal output and snapshots
remain transient. No credentials or authentication challenges are transferred.
The normal workspace PIN screen covers every view. Output skipped during lock is
recovered from a fresh snapshot after unlock. Multiline paste requires approval
in the detached window, with a 64 KiB detached paste limit. Oversized snapshots
or a display that cannot keep up return the live session to the main window.

## Automated checks

Run frontend check, lint, build and unit scripts. `terminal-tab-order.test.mjs`
covers movement in both directions, stale drops and stable object identity.
`terminal-window-replay.test.mjs` covers overlapping snapshot/live output,
out-of-order output, duplicate suppression and bounded buffering. The focused
native filter `cargo test -p conxol --lib terminal_windows::tests --locked`
checks message direction and bounds without opening windows or connections.

## Manual acceptance with disposable local sessions

1. Open three local test shells; split two. Reorder repeatedly by pointer,
   keyboard and context menu. Confirm no prompt restart or split-ratio change.
2. Detach a connected local shell while it prints synthetic numbered lines.
   Confirm scrollback, ANSI styling, current prompt and subsequent line ordering.
3. Resize, type, use Ctrl+C, copy text and approve/cancel a multiline paste.
   Verify input reaches only the intended session and the main placeholder cannot
   accept input. Check a terminal application using the alternate screen.
4. Return, detach again, close the detached window, and explicitly close its
   session. Verify the first three preserve the connection; the last ends it.
5. Lock/unlock, disconnect/reconnect, close a tab from the main window, and exit
   the application with a detached view. Check cleanup and absence of orphaned
   windows. Use loopback SSH fixtures for SSH branches; never real credentials.

Native GUI acceptance is separate from compilation and unit checks.
