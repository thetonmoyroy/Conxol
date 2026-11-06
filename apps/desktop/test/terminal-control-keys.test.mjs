import console from "node:console";
import assert from 'node:assert/strict';
import { handleTerminalControlKey } from '../src/terminal-control-keys.ts';
let selection = 'selected scrollback', allowed = true;
const calls = [];
const terminal = { getSelection: () => selection, clearSelection: () => { selection = ''; calls.push('clear'); }, scrollToBottom: () => calls.push('bottom') };
const event = (patch = {}) => ({ type: 'keydown', key: 'c', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop'), ...patch });
const handle = key => handleTerminalControlKey(key, terminal, () => allowed, data => calls.push(['send', data]), text => calls.push(['copy', text]));
assert.equal(handle(event()), true);
assert.deepEqual(calls, ['prevent', 'stop', 'clear', 'bottom', ['send', '\x03']], 'selection never swallows or duplicates interrupt');
calls.length = 0; selection = 'copy me';
assert.equal(handle(event({ shiftKey: true, key: 'C' })), true);
assert.deepEqual(calls, ['prevent', 'stop', ['copy', 'copy me']]);
assert.equal(selection, 'copy me');
calls.length = 0; allowed = false;
handle(event()); assert.deepEqual(calls, ['prevent', 'stop'], 'locked, hidden or disposed terminals cannot receive interrupt');
allowed = true;
for (const patch of [{ type: 'keyup' }, { altKey: true }, { metaKey: true }, { ctrlKey: false }, { key: 'v' }]) {
  calls.length = 0; assert.equal(handle(event(patch)), false); assert.deepEqual(calls, []);
}
console.log('Terminal Ctrl+C interruption and Ctrl+Shift+C copy checks passed');
