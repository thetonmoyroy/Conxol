import assert from 'node:assert/strict';
import { attachTerminalGpuRenderer } from '../src/terminal-gpu-renderer.ts';

function fixture(fail = false) {
  let loss, disposed = 0, unsubscribed = 0, refreshes = [];
  const addon = {
    activate() {},
    onContextLoss(listener) { loss = listener; return { dispose() { unsubscribed++; } }; },
    dispose() { disposed++; },
  };
  const terminal = {
    rows: 24,
    loadAddon(value) { assert.equal(value, addon); if (fail) throw Error('No WebGL2'); },
    refresh(...rows) { refreshes.push(rows); },
  };
  const renderer = attachTerminalGpuRenderer(terminal, () => addon);
  return { renderer, loseContext: () => loss(), stats: () => ({disposed, unsubscribed, refreshes}) };
}
const active = fixture();
assert.equal(active.stats().disposed, 0);
active.loseContext();
assert.deepEqual(active.stats(), {disposed: 1, unsubscribed: 1, refreshes: [[0, 23]]});
active.renderer.dispose();
assert.equal(active.stats().disposed, 1, 'fallback and terminal cleanup cannot dispose the addon twice');

const unsupported = fixture(true);
assert.deepEqual(unsupported.stats(), {disposed: 1, unsubscribed: 1, refreshes: []});
unsupported.renderer.dispose();
assert.equal(unsupported.stats().disposed, 1);

let loaded = false;
attachTerminalGpuRenderer({ rows: 10, loadAddon() { loaded = true; }, refresh() {} }, () => { throw Error('No GPU'); }).dispose();
assert(!loaded, 'an unavailable GPU leaves the original renderer active');
const closed = fixture();
closed.renderer.dispose();
assert.deepEqual(closed.stats(), {disposed: 1, unsubscribed: 1, refreshes: []});
globalThis.console.log('GPU renderer: context-loss fallback, unsupported GPU and cleanup passed');
