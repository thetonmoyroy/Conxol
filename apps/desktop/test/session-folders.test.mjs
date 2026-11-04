import assert from 'node:assert/strict';
import { parseSessionFolderState } from '../src/session-folders.ts';
assert.deepEqual(parseSessionFolderState(null), {});
assert.deepEqual(parseSessionFolderState('invalid'), {});
assert.deepEqual(parseSessionFolderState('[]'), {});
assert.deepEqual(parseSessionFolderState('{"remote":false,"folder:Production":true,"other":"invalid"}'), { remote: false, 'folder:Production': true });
const state = { remote: true, 'folder:Production': false, 'folder:Development': true };
assert.deepEqual(parseSessionFolderState(JSON.stringify(state)), state);
assert.deepEqual(parseSessionFolderState('x'.repeat(100001)), {});
