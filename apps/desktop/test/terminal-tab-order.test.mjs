import assert from 'node:assert/strict';
import test from 'node:test';
import { moveTerminalTab } from '../src/terminal-tab-order.ts';

test('moves in both directions while preserving session identity', () => {
  const tabs = ['a', 'b', 'c', 'd'].map(id => ({ id, connection: {} }));
  const moved = moveTerminalTab(tabs, 'a', 'c', true);
  assert.deepEqual(moved.map(tab => tab.id), ['b', 'c', 'a', 'd']);
  assert.equal(moved[2], tabs[0]);
  assert.deepEqual(moveTerminalTab(moved, 'd', 'b').map(tab => tab.id), ['d', 'b', 'c', 'a']);
  assert.deepEqual(tabs.map(tab => tab.id), ['a', 'b', 'c', 'd']);
});

test('stale, self and unchanged drops retain the original array', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }];
  for (const [source, target, after] of [['missing', 'b', true], ['a', 'missing', false], ['a', 'a', true], ['a', 'b', false], ['b', 'a', true]]) {
    assert.equal(moveTerminalTab(tabs, source, target, after), tabs);
  }
});
