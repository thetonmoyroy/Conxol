import assert from 'node:assert/strict';
import { parseSessionFolderState, parseSessionFolders, unfileSessionFolder } from '../src/session-folders.ts';
assert.deepEqual(parseSessionFolderState(null), {});
assert.deepEqual(parseSessionFolderState('invalid'), {});
assert.deepEqual(parseSessionFolderState('[]'), {});
assert.deepEqual(parseSessionFolderState('{"remote":false,"folder:Production":true,"other":"invalid"}'), { remote: false, 'folder:Production': true });
const state = { remote: true, 'folder:Production': false, 'folder:Development': true };
assert.deepEqual(parseSessionFolderState(JSON.stringify(state)), state);
assert.deepEqual(parseSessionFolderState('x'.repeat(100001)), {});

assert.deepEqual(parseSessionFolders(null), []);
assert.deepEqual(parseSessionFolders('invalid'), []);
assert.deepEqual(parseSessionFolders('{}'), []);
assert.deepEqual(parseSessionFolders(JSON.stringify([' Production ', 'Production', '', null, 42, 'Lab'])), ['Production', 'Lab']);
assert.deepEqual(parseSessionFolders(JSON.stringify(['x'.repeat(129)])), []);
assert.deepEqual(parseSessionFolders(JSON.stringify(['Empty folder'])), ['Empty folder']);

const records = [
  { id: 'one', folder: 'Lab', auth: { kind: 'agent' }, tags: ['router'], name: 'Router' },
  { id: 'two', folder: ' Lab ', auth: { kind: 'password', credentialRef: 'opaque-ref' }, name: 'Switch' },
  { id: 'three', folder: 'Other', name: 'Other host' },
  { id: 'four', folder: null, name: 'Unfiled' },
];
const snapshot = JSON.parse(JSON.stringify(records));
const saved = [];
assert.equal(await unfileSessionFolder('Lab', records, async record => saved.push(record)), 2);
assert.deepEqual(saved, [{ ...records[0], folder: null }, { ...records[1], folder: null }]);
assert.deepEqual(records, snapshot, 'source records remain unchanged until persistence succeeds');
assert.equal(await unfileSessionFolder('Empty folder', records, async () => assert.fail('empty folder must not write sessions')), 0);
let attempts = 0;
await assert.rejects(unfileSessionFolder('Lab', records, async () => { attempts++; throw new Error('write failed'); }), /write failed/);
assert.equal(attempts, 1, 'failed persistence stops before further moves');
