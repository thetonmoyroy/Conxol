import assert from 'node:assert/strict';
import { parseSessionFolderState, parseSessionFolders, unfileSessionFolder, sessionFolderAncestors, sessionFolderParent, sessionFolderWithin, sessionFolderOpenState, groupSessionFolders, planSessionFolderMove } from '../src/session-folders.ts';
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

assert.deepEqual(sessionFolderAncestors('Production/Routers/Edge'), ['Production', 'Production/Routers', 'Production/Routers/Edge']);
assert.equal(sessionFolderParent('Production/Routers/Edge'), 'Production/Routers');
assert.equal(sessionFolderParent('Production'), '');
assert.equal(sessionFolderWithin('Production/Routers', 'Production'), true);
assert.equal(sessionFolderWithin('Production2/Routers', 'Production'), false);
assert.deepEqual(sessionFolderOpenState('Production/Routers'), { 'folder:Production': true, 'folder:Production/Routers': true });
const nestedSessions = [{ name: 'Edge', folder: 'Production/Routers' }, { name: 'Root', folder: '' }];
const nestedGroups = groupSessionFolders(nestedSessions, ['Lab/Empty']);
assert.deepEqual(nestedGroups.map(([path]) => path), ['Lab', 'Lab/Empty', 'Production', 'Production/Routers', '']);
assert.deepEqual(nestedGroups.find(([path]) => path === 'Production')[1], []);
assert.deepEqual(nestedGroups.find(([path]) => path === 'Production/Routers')[1], [nestedSessions[0]]);
assert.deepEqual(groupSessionFolders([], ['Lab/Empty']).map(([path]) => path), ['Lab', 'Lab/Empty']);

// Dragging a folder moves its descendants but leaves similarly named siblings alone.
const relocate = planSessionFolderMove('Lab', 'Production/Lab', ['Lab', 'Lab/Routers', 'Lab2', 'Production']);
assert.deepEqual(['Lab', 'Lab/Routers', 'Lab2', 'Production'].map(relocate), ['Production/Lab', 'Production/Lab/Routers', 'Lab2', 'Production']);
const toRoot = planSessionFolderMove('Production/Lab', 'Lab', ['Production', 'Production/Lab', 'Production/Lab/Routers']);
assert.equal(toRoot('Production/Lab/Routers'), 'Lab/Routers');
assert.throws(() => planSessionFolderMove('Lab', 'Lab/Routers/Lab', ['Lab', 'Lab/Routers']), /inside itself/);
assert.throws(() => planSessionFolderMove('Lab', 'Production/Lab', ['Lab', 'Production/Lab/Existing']), /already exists/);
assert.throws(() => planSessionFolderMove('Lab', 'x'.repeat(125) + '/Lab', ['Lab']), /128/);
assert.throws(() => planSessionFolderMove('Lab', 'x'.repeat(120), ['Lab', 'Lab/12345678']), /128/);
assert.equal(planSessionFolderMove('Lab', 'Lab', ['Lab'])('Lab'), 'Lab');
