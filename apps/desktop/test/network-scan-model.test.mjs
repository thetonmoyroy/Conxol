import assert from 'node:assert/strict';
import { mergeScanResults, openScanResults, scanProgress } from '../src/network-scan-model.ts';
const results = mergeScanResults([{ host: '192.0.2.2', port: 22, status: 'open' }], [{ host: '192.0.2.1', port: 22, status: 'closed' }]);
assert.equal(results.length, 2);
assert.deepEqual(results.map(item => item.host), ['192.0.2.1', '192.0.2.2']);
const updated = mergeScanResults(results, [{ host: '192.0.2.1', port: 22, status: 'open' }]);
assert.equal(updated.length, 2);
assert.equal(updated[0].status, 'open');
assert.equal(results[0].status, 'closed');

assert.deepEqual(openScanResults([{ status: 'closed' }, { status: 'open' }, { status: 'open-or-filtered' }, { status: 'timed-out' }, { status: 'failed' }]), [{ status: 'open' }]);
assert.deepEqual(scanProgress(50, 200), { completed: 50, total: 200, percent: 25 });
assert.deepEqual(scanProgress(200, 200), { completed: 200, total: 200, percent: 100 });
assert.deepEqual(scanProgress(10, 0), { completed: 0, total: 0, percent: 0 });
assert.deepEqual(scanProgress(100, 80), { completed: 80, total: 80, percent: 100 });
assert.deepEqual(scanProgress(-1, 80), { completed: 0, total: 80, percent: 0 });
