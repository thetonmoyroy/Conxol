import assert from 'node:assert/strict';
import { ConnectionAttemptGate } from '../src/connection-attempt.ts';

const gate = new ConnectionAttemptGate();
let release;
let starts = 0;
const first = gate.run(async () => {
  starts++;
  await new Promise(resolve => { release = resolve; });
});
// Rapid clicks, including before a render, cannot start another connection.
await gate.run(async () => { starts++; });
assert.equal(starts, 1);
release();
await first;
await gate.run(async () => { starts++; });
assert.equal(starts, 2);
// Failed/cancelled attempts release the lock so retry works.
await assert.rejects(gate.run(async () => { throw new Error('cancelled'); }), /cancelled/);
await gate.run(async () => { starts++; });
assert.equal(starts, 3);
