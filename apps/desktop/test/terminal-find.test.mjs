import assert from "node:assert/strict";
import { handleTerminalFindKey } from "../src/terminal-find.ts";
function attempt(overrides = {}, allowed = true, configured = false) {
  const events = [];
  const event = { key: 'f', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false,
    preventDefault: () => events.push('prevent'), stopPropagation: () => events.push('stop'), ...overrides };
  const handled = handleTerminalFindKey(event, allowed, configured, () => events.push('open'));
  return { handled, events };
}
assert.deepEqual(attempt(), { handled: true, events: ['prevent', 'stop', 'open'] }, 'Ctrl+F must be consumed before opening Find');
assert.equal(attempt({ key: 'F' }).handled, true);
assert.equal(attempt({ ctrlKey: false, metaKey: true }).handled, true);
assert.deepEqual(attempt({}, false), { handled: false, events: [] }, 'do not hijack dialogs, locked workspaces, other editors');
for (const overrides of [{ ctrlKey: false }, { altKey: true }, { shiftKey: true }, { key: 'g' }]) assert.equal(attempt(overrides).handled, false);
assert.equal(attempt({ key: 'g' }, true, true).handled, true, 'keep the configured shortcut working');
assert.equal(attempt({}, true, false).handled, true, 'Ctrl+F stays available with a custom configured shortcut');
assert.deepEqual(attempt({ key: 'g' }, false, true), { handled: false, events: [] });
assert.equal(attempt().handled, true, 'repeated Ctrl+F must call the focus action again');
