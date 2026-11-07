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

// New-session submissions must stay gated through trust approval and SSH auth,
// including submissions arriving before a React render can disable Connect.
const sshGate = new ConnectionAttemptGate();
let approveTrust;
let finishAuthentication;
let inspections = 0;
let sshConnects = 0;
const tabs = [];
const connectSsh = () => sshGate.run(async () => {
  inspections++;
  await new Promise(resolve => { approveTrust = resolve; });
  tabs.push({ id: 'pending-ssh' });
  sshConnects++;
  await new Promise(resolve => { finishAuthentication = resolve; });
});
const pendingSsh = connectSsh();
await Promise.all([connectSsh(), connectSsh()]);
assert.equal(inspections, 1, 'repeat submits do not duplicate host inspection');
approveTrust();
await Promise.resolve();
await connectSsh();
assert.equal(tabs.length, 1, 'repeat submits create one pending SSH tab');
assert.equal(sshConnects, 1, 'only one native connect is started during authentication');
finishAuthentication();
await pendingSsh;
// A later intentional connection remains available.
const laterSsh = connectSsh();
approveTrust();
await Promise.resolve();
finishAuthentication();
await laterSsh;
assert.equal(tabs.length, 2);
