import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { attachNetworkHighlighting } from '../apps/desktop/src/network-highlighting.ts';

// Measures highlighter work, not WebView layout/paint, SSH, or native memory.
const callbacks = new Map();
let liveMarkers = 0, liveDecorations = 0, peakDecorations = 0, reads = 0;
const samples = [
  'ip ip-prefix CUSTOMER_RCV_V4 index 100 permit 103.120.164.0 22 greater-equal 24 less-equal 28',
  'set routing-options static route 192.0.2.0/24 next-hop 198.51.100.1',
  'GigabitEthernet0/0/1 192.0.2.1 YES manual administratively down down',
  'peer 2001:db8::1 enable description Uplink to core',
  '    family inet { address 10.50.2.233/30; }',
];
const lines = Array.from({ length: 10000 }, (_, i) => {
  const text = samples[i % samples.length];
  const cells = Array.from({ length: 160 }, (_, x) => ({ getChars: () => text[x] ?? ' ', getWidth: () => 1, isFgDefault: () => true }));
  return { length: cells.length, translateToString: () => text, getCell: x => cells[x] };
});
const subscribe = name => callback => { callbacks.set(name, callback); return { dispose: () => callbacks.delete(name) }; };
const buffer = { type: 'normal', viewportY: 0, baseY: 9940, cursorY: 59, length: lines.length, getLine: y => { reads++; return lines[y]; } };
const terminal = {
  rows: 60, buffer: { active: buffer, onBufferChange: subscribe('buffer') }, options: { theme: {} },
  onWriteParsed: subscribe('write'), onScroll: subscribe('scroll'), onRender: subscribe('render'), onResize: subscribe('resize'),
  registerMarker: offset => { liveMarkers++; const marker = { line: buffer.baseY + buffer.cursorY + offset, isDisposed: false, dispose() { if (!this.isDisposed) { this.isDisposed = true; liveMarkers--; } } }; return marker; },
  registerDecoration: () => { liveDecorations++; peakDecorations = Math.max(peakDecorations, liveDecorations); let disposed = false; return { dispose: () => { if (!disposed) { disposed = true; liveDecorations--; } } }; },
};
global.gc?.();
const startHeap = process.memoryUsage().heapUsed;
const highlighter = attachNetworkHighlighting(terminal);
await Promise.resolve();
async function measure(name, iterations, action) {
  const times = [], beforeReads = reads;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now(); action(i); await Promise.resolve();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const percentile = p => +times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(3);
  return { name, iterations, meanMs: +(times.reduce((a,b) => a+b,0)/times.length).toFixed(3), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: times.at(-1), lineReads: reads - beforeReads, modeled6xSlowerP95Ms: +(percentile(.95)*6).toFixed(3) };
}
const scenarios = [];
scenarios.push(await measure('cold history jumps, 60 rows x 160 columns', 400, i => { buffer.viewportY = (i * 79) % 9940; callbacks.get('scroll')(); }));
scenarios.push(await measure('back/forward cached viewport', 400, i => { buffer.viewportY = i % 2 ? 100 : 110; callbacks.get('scroll')(); }));
scenarios.push(await measure('new output invalidates 60 visible rows', 400, () => { callbacks.get('write')(); }));
scenarios.push(await measure('12000 scroll notifications in one parser burst', 30, () => { for(let j=0;j<12000;j++) callbacks.get('scroll')(); callbacks.get('write')(); }));
global.gc?.();
const retainedHeapBytes = process.memoryUsage().heapUsed - startHeap;
const retained = { liveMarkers, liveDecorations, peakDecorations, retainedHeapBytes };
assert(liveMarkers <= terminal.rows * 2, 'marker cache must stay bounded');
assert(liveDecorations <= terminal.rows * 128, 'decoration cache must stay bounded');
assert.equal(scenarios[3].lineReads, 30 * terminal.rows, 'parser bursts must coalesce to one visible scan');
highlighter.dispose();
assert.equal(liveMarkers + liveDecorations + callbacks.size, 0, 'disposal must release retained resources');
const report = { node: process.version, viewport: { rows: 60, columns: 160, scrollback: 10000 }, limitations: 'Node synthetic buffer and decoration handles; excludes DOM layout/paint, WebView, actual CPU throttling, SSH and native memory. 6x values are arithmetic estimates only.', scenarios, retained, afterDispose: { liveMarkers, liveDecorations, subscriptions: callbacks.size } };
writeFileSync('target/network-highlighting-performance.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
