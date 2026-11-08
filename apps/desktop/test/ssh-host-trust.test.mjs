import assert from 'node:assert/strict';
import { approveUnknownHost } from '../src/ssh-host-trust.ts';
import { sidebarWidth } from '../src/sidebar-layout.ts';
const fingerprint = 'SHA256:' + 'A'.repeat(43);
function fixture(overrides = {}) {
  const calls = [];
  return { calls, services: {
    lookup: async () => { calls.push('lookup'); return null; },
    inspect: async t => { calls.push('inspect'); return { ...t, fingerprint }; },
    confirm: async () => { calls.push('confirm'); return true; },
    save: async () => { calls.push('save'); },
    ...overrides,
  }};
}
{
  const target = { host: 'fixture.test', port: 2222 };
  const { calls, services } = fixture();
  assert.equal(await approveUnknownHost(target, services), true);
  assert.deepEqual(calls, ['lookup', 'inspect', 'confirm', 'save']);
  assert.equal(target.pinnedFingerprint, fingerprint);
}
for (const policy of [{ pinnedFingerprint: fingerprint }, { knownHostsPath: 'fixture-known-hosts' }]) {
  const { calls, services } = fixture();
  assert.equal(await approveUnknownHost({ host: 'fixture.test', port: 22, ...policy }, services), true);
  assert.deepEqual(calls, []); // Existing trust cannot be replaced by a fresh observation.
}
{
  const { calls, services } = fixture({ confirm: async () => false });
  const target = { host: 'fixture.test', port: 22 };
  assert.equal(await approveUnknownHost(target, services), false);
  assert.equal(target.pinnedFingerprint, undefined);
  assert.ok(!calls.includes('save'));
}
{
  const { calls, services } = fixture({ lookup: async () => fingerprint });
  const target = { host: 'fixture.test', port: 22 };
  assert.equal(await approveUnknownHost(target, services), true);
  assert.deepEqual(calls, []);
  assert.equal(target.pinnedFingerprint, fingerprint);
}
{
  const { calls, services } = fixture({ inspect: async () => ({ host: 'wrong.test', port: 22, fingerprint }) });
  await assert.rejects(approveUnknownHost({ host: 'fixture.test', port: 22 }, services), /invalid endpoint/);
  assert.ok(!calls.includes('confirm'));
  assert.ok(!calls.includes('save'));
}
{
  let allowed = true;
  const { calls, services } = fixture({ confirm: async () => { allowed = false; return true; } });
  assert.equal(await approveUnknownHost({ host: 'fixture.test', port: 22 }, services, () => allowed), false);
  assert.ok(!calls.includes('save'));
}
{
  const { calls, services } = fixture();
  await assert.rejects(approveUnknownHost({ host: 'private.fixture', port: 22 }, services, () => true, false), /jump route/);
  assert.deepEqual(calls, ['lookup']); // Never probe a private hop through the wrong route.
}
assert.equal(sidebarWidth(10, 1440), 140);
assert.equal(sidebarWidth(900, 1440), 900);
assert.equal(sidebarWidth(2000, 1440), 1050);
assert.equal(sidebarWidth(NaN, 1440), 164);
assert.equal(sidebarWidth(1000, 1100), 710);


{
  const request = { host: 'fixture.test', port: 22, auth: { method: 'password', credentialId: 'fixture' } };
  const { services } = fixture({ inspect: async endpoint => {
    assert.deepEqual(Object.keys(endpoint).sort(), ['host', 'legacyRsa', 'port']);
    return { ...endpoint, fingerprint };
  }});
  assert.equal(await approveUnknownHost(request, services), true);
}

{
  const target = { host: 'fixture.test', port: 22, legacyRsa: true };
  const { calls, services } = fixture({ inspect: async endpoint => {
    assert.equal(endpoint.legacyRsa, true);
    return { host: endpoint.host, port: endpoint.port, fingerprint };
  }});
  assert.equal(await approveUnknownHost(target, services), true);
  assert.equal(target.pinnedFingerprint, fingerprint);
  assert.deepEqual(calls, ['lookup', 'confirm', 'save']);
}
