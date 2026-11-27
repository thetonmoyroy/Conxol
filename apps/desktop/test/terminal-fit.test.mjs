import assert from 'node:assert/strict';
import { createTerminalFitScheduler, createTerminalResizeQueue } from '../src/terminal-fit.ts';
const frames = new Map();
let id = 0, font = 12, rows = 50, visible = true, disposed = false;
const calls = [];
const scheduler = createTerminalFitScheduler(() => { assert(!disposed); if (!visible) return false; rows = Math.floor(600 / font); calls.push('fit'); return true; }, () => calls.push('bottom'), callback => { frames.set(++id, callback); return id; }, key => frames.delete(key));
const paint = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
font = 17; scheduler.schedule(true);
assert.equal(rows, 50);
paint(); assert.equal(rows, 35, 'larger text reduces the row count to fit the host');
assert.deepEqual(calls, ['fit', 'bottom'], 'follow the prompt after resizing, never before');
calls.length = 0;
scheduler.schedule(false); font = 20; scheduler.schedule(false); font = 24;
assert.equal(frames.size, 1); paint(); assert.equal(rows, 25); assert.deepEqual(calls, ['fit'], 'zooming in scrollback preserves browsing position');
calls.length = 0; visible = false; scheduler.schedule(true); paint(); assert.deepEqual(calls, []);
visible = true; scheduler.schedule(true); scheduler.dispose(); disposed = true; paint(); scheduler.schedule(true); assert.equal(frames.size, 0); assert.deepEqual(calls, [], 'closed terminals cannot refit or scroll');

const sizes = [];
const splitResize = Promise.withResolvers();
const resizeStarted = Promise.withResolvers();
const resize = createTerminalResizeQueue((cols, rows) => {
  sizes.push([cols, rows]);
  if (cols === 80) {
    resizeStarted.resolve();
    return splitResize.promise;
  }
  return Promise.resolve();
});
const split = resize(80, 50);
await resizeStarted.promise;
const intermediate = resize(100, 50);
const expanded = resize(160, 50);
assert.deepEqual(sizes, [[80, 50]], 'wait for the split size already in flight');
const failedSplit = assert.rejects(split, /resize interrupted/);
splitResize.reject(new Error('resize interrupted'));
await Promise.all([failedSplit, intermediate, expanded]);
assert.deepEqual(sizes, [[80, 50], [160, 50]], 'send the surviving pane size even if the earlier resize failed');
