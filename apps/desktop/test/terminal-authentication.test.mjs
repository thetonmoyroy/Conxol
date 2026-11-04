import assert from 'node:assert/strict';
import { TerminalAuthentication } from '../src/terminal-authentication.ts';

const first = new TerminalAuthentication();
const second = new TerminalAuthentication();
const controller = new globalThis.AbortController();
const answer = first.ask('fixture password:', controller.signal);
assert.deepEqual(first.getSnapshot(), { message: 'fixture password:' });
first.submit('synthetic-password');
assert.equal(await answer, 'synthetic-password');
assert.equal(first.getSnapshot(), null);
assert.ok(!JSON.stringify(first).includes('synthetic-password'));

const expired = first.ask('expired prompt', controller.signal);
const other = second.ask('another tab', new globalThis.AbortController().signal);
controller.abort();
assert.equal(await expired, null);
assert.equal(first.getSnapshot(), null);
assert.equal(second.getSnapshot().message, 'another tab');
second.submit('second-response');
assert.equal(await other, 'second-response');

const reconnect = first.ask('reconnect password:', new globalThis.AbortController().signal);
first.submit('fresh-response');
assert.equal(await reconnect, 'fresh-response');
const closing = first.ask('closing tab', new globalThis.AbortController().signal);
first.cancel();
assert.equal(await closing, null);
assert.equal(await first.ask('late challenge', new globalThis.AbortController().signal), null);
assert.equal(first.getSnapshot(), null);
