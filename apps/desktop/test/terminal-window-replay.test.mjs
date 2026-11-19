import assert from 'node:assert/strict';
import test from 'node:test';
import { TerminalWindowReplay } from '../src/terminal-window-replay.ts';

test('snapshot drops overlapping output and preserves concurrently arriving text', () => {
  const replay = new TerminalWindowReplay();
  replay.push(1, 'already in snapshot');
  replay.push(3, 'third');
  replay.push(2, 'second');
  replay.snapshot(1);
  const output = [];
  replay.drain(data => output.push(data));
  assert.deepEqual(output, ['second', 'third']);
  replay.push(3, 'duplicate');
  replay.drain(data => output.push(data));
  assert.deepEqual(output, ['second', 'third']);
});

test('holds gaps and bounds buffered output without dropping accepted text', () => {
  const replay = new TerminalWindowReplay(6);
  replay.snapshot(0);
  assert.equal(replay.push(2, 'cd'), true);
  const output = [];
  replay.drain(data => output.push(data));
  assert.deepEqual(output, []);
  assert.equal(replay.push(3, 'oversized'), false);
  assert.equal(replay.push(1, 'ab'), true);
  replay.drain(data => output.push(data));
  assert.deepEqual(output, ['ab', 'cd']);
  assert.equal(replay.push(3, '123456'), true);
});
