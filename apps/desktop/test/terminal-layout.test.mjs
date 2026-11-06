import assert from 'node:assert/strict';
import { branchTerminalLayout, layoutTerminalIds, rememberTerminalLayout, selectTerminalLayout, updateLayoutRatio } from '../src/terminal-layout.ts';

const parent = { kind: 'pane', terminalId: 'parent' };
const split = branchTerminalLayout(parent, 'parent', 'branch');
// Login setup and completion both place the same branch: there must be only two panes.
assert.strictEqual(branchTerminalLayout(split, 'parent', 'branch'), split);
assert.deepEqual(layoutTerminalIds(split), ['parent', 'branch']);
const resized = updateLayoutRatio(split, [], 63);
const saved = new Map();
rememberTerminalLayout(saved, resized);
const live = new Set(['parent', 'branch', 'other']);
assert.strictEqual(selectTerminalLayout(resized, saved, 'branch', live), resized);
const other = selectTerminalLayout(resized, saved, 'other', live);
rememberTerminalLayout(saved, other);
assert.strictEqual(selectTerminalLayout(other, saved, 'parent', live), resized);
assert.strictEqual(selectTerminalLayout(other, saved, 'branch', live), resized);
// Returning to a remembered split must not resurrect a terminal that was closed.
assert.deepEqual(selectTerminalLayout(other, saved, 'parent', new Set(['parent', 'other'])), parent);
// A pane moved into another group must not appear twice across restored groups.
rememberTerminalLayout(saved, branchTerminalLayout(other, 'other', 'branch'));
assert.deepEqual(selectTerminalLayout(other, saved, 'parent', live), parent);
const nested = branchTerminalLayout(resized, 'branch', 'child');
assert.deepEqual(layoutTerminalIds(nested), ['parent', 'branch', 'child']);
assert.strictEqual(branchTerminalLayout(nested, 'branch', 'child'), nested);
