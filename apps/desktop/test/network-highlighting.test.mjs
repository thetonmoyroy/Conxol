import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers';
import console from 'node:console';
import { findNetworkHighlights, findUsefulNetworkHighlights, networkCellRanges, attachNetworkHighlighting } from '../src/network-highlighting.ts';
const tokens = text => findNetworkHighlights(text).map(span => [text.slice(span.start, span.end), span.kind]);
assert.deepEqual(tokens('GigabitEthernet0/0/1 192.0.2.1 YES manual administratively down down'), [
  ['GigabitEthernet0/0/1', 'interface'], ['192.0.2.1', 'address'], ['YES', 'good'], ['administratively down', 'bad'], ['down', 'bad'],
]);
assert.deepEqual(tokens('ge-0/0/0.0 up up inet 192.0.2.2/24'), [
  ['ge-0/0/0.0', 'interface'], ['up', 'good'], ['up', 'good'], ['inet', 'keyword'], ['192.0.2.2/24', 'address'],
]);
assert.deepEqual(tokens('Vlanif100 192.0.2.3/24 UP DOWN'), [
  ['Vlanif100', 'interface'], ['192.0.2.3/24', 'address'], ['UP', 'good'], ['DOWN', 'bad'],
]);
assert.deepEqual(tokens('no shutdown undo shutdown shutdown'), [['no shutdown', 'good'], ['undo shutdown', 'good'], ['shutdown', 'bad']]);
assert.deepEqual(tokens('not connected not established'), [['not connected', 'bad'], ['not established', 'bad']]);
for (const word of ['BGP', 'OSPFv3', 'MPLS', 'routing-options']) assert.deepEqual(tokens(word), [[word, 'keyword']]);
for (const word of ['Eth-Trunk1', 'XGigabitEthernet0/0/1', '100GE1/0/1', 'ae0.100', 'xe-0/0/0', 'irb.100']) {
  assert.deepEqual(tokens(word), [[word, 'interface']]);
}
for (const address of ['2001:db8::1/64', '::1', '::/0', '2001:db8:0:0:0:0:0:1', '192.0.2.0/24', 'aa:bb:cc:dd:ee:ff', 'aabb.ccdd.eeff', 'aabb-ccdd-eeff']) assert.deepEqual(tokens(address), [[address, 'address']]);
for (const invalid of ['999.1.1.1', '192.0.2.1/33', '2001:db8::1/129', 'abc:def', '2001::db8::1', 'backup setup showdown']) assert.deepEqual(tokens(invalid), []);
assert.equal(findNetworkHighlights('up '.repeat(10000)).length, 128);

function line(text, colored = false, prefix = []) {
  const cells = [...prefix, ...[...text].map(chars => ({ chars, width: 1 }))];
  return {
    length: cells.length,
    translateToString: () => cells.filter(cell => cell.width).map(cell => cell.chars).join(''),
    getCell: x => cells[x] && ({ getChars: () => cells[x].chars, getWidth: () => cells[x].width, isFgDefault: () => !colored }),
  };
}
assert.deepEqual(networkCellRanges(line('UP')).map(({x, width}) => [x, width]), [[0, 2]]);
assert.deepEqual(networkCellRanges(line('UP', true)), []);
const unicode = [{ chars: '界', width: 2 }, { chars: '', width: 0 }, { chars: 'e\u0301', width: 1 }, { chars: ' ', width: 1 }];
assert.equal(networkCellRanges(line('192.0.2.1', false, unicode))[0].x, 4);

// Revisit history without destroying/recreating unchanged decorations.
const callbacks = new Map();
let subscriptionsDisposed = 0, objectsLive = 0, reads = 0;
const decorationOptions = [], markerOffsets = [];
const contents = new Map();
let deviceColored = false;
const subscribe = name => callback => { callbacks.set(name, callback); return { dispose: () => { subscriptionsDisposed++; callbacks.delete(name); } }; };
const buffer = { type: 'normal', viewportY: 10, baseY: 10, cursorY: 2, length: 40, getLine: y => { reads++; return line(contents.get(y) ?? 'UP', deviceColored); } };
const terminal = {
  buffer: { active: buffer, onBufferChange: subscribe('buffer') }, rows: 3,
  options: { theme: { green: '#123456', red: '#654321' } },
  onWriteParsed: subscribe('write'), onScroll: subscribe('scroll'), onRender: subscribe('render'), onResize: subscribe('resize'),
  registerMarker: offset => {
    markerOffsets.push(offset); objectsLive++;
    const marker = { line: buffer.baseY + buffer.cursorY + offset, isDisposed: false, dispose: () => { if (!marker.isDisposed) { marker.isDisposed = true; objectsLive--; } } };
    return marker;
  },
  registerDecoration: options => { decorationOptions.push(options); objectsLive++; return { dispose: () => objectsLive-- }; },
};
const highlighter = attachNetworkHighlighting(terminal);
callbacks.get('write')(); callbacks.get('write')();
await new Promise(resolve => setTimeout(resolve, 60));
assert.equal(reads, 3);
assert.deepEqual(markerOffsets, [-2, -1, 0]);
assert.equal(decorationOptions[0].foregroundColor, '#123456');
assert.equal(objectsLive, 6);
buffer.viewportY = 0; callbacks.get('scroll')();
await Promise.resolve();
assert.equal(objectsLive, 12, 'scroll colors must be ready before the next animation frame');
assert.equal(objectsLive, 12, 'older rows receive color after the scroll burst');
assert.deepEqual(markerOffsets.slice(-3), [-12, -11, -10]);
buffer.viewportY = 10; callbacks.get('scroll')();
await new Promise(resolve => setTimeout(resolve, 60));
assert.equal(objectsLive, 12);
assert.equal(decorationOptions.length, 6, 'revisiting unchanged rows reuses their colors');
const readsBeforeBurst = reads;
for (let i = 0; i < 12000; i++) callbacks.get('scroll')();
assert.equal(reads, readsBeforeBurst, 'output scroll events must not scan while xterm parses');
await new Promise(resolve => setTimeout(resolve, 60));
assert.equal(reads - readsBeforeBurst, 0, 'unchanged visible rows reuse cached decorations after a scroll burst');
callbacks.get('write')();
await new Promise(resolve => setTimeout(resolve, 60));
assert.equal(reads - readsBeforeBurst, terminal.rows, 'parsed output invalidates cached rows');
contents.set(10, 'DOWN'); callbacks.get('write')();
await new Promise(resolve => setTimeout(resolve, 60));
assert.equal(objectsLive, 12);
assert.equal(decorationOptions.at(-1).foregroundColor, '#654321', 'rewritten lines update their status color');
contents.set(10, 'Welcome to this session'); callbacks.get('write')();
await new Promise(resolve => setTimeout(resolve, 60));
assert.equal(objectsLive, 10, 'ordinary prose loses stale decorations');
buffer.type = 'alternate'; callbacks.get('buffer')();
await new Promise(resolve => setTimeout(resolve, 60));
assert.equal(objectsLive, 0);
buffer.type = 'normal'; callbacks.get('buffer')();
await new Promise(resolve => setTimeout(resolve, 60));
assert.equal(objectsLive, 4);
terminal.options.theme.green = '#abcdef'; highlighter.refresh();
await new Promise(resolve => setTimeout(resolve, 60));
assert.equal(decorationOptions.at(-1).foregroundColor, '#abcdef', 'theme changes invalidate cached colors');
deviceColored = true; callbacks.get('write')();
await new Promise(resolve => setTimeout(resolve, 60));
assert.equal(objectsLive, 0, 'ANSI-only foreground changes remove cached highlighting');
deviceColored = false; callbacks.get('write')();
await new Promise(resolve => setTimeout(resolve, 60));
assert.equal(objectsLive, 4);
for (let y = 0; y < 30; y += 3) {
  buffer.viewportY = y; callbacks.get('scroll')();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(objectsLive <= terminal.rows * 4, 'retained marker/decorations stay bounded while visiting history');
}
// Scrollbar/render movement may settle after the public scroll notification.
buffer.viewportY = 0;
callbacks.get('render')();
await new Promise(resolve => setTimeout(resolve, 60));
assert(decorationOptions.some(option => option.marker.line === 0 && !option.marker.isDisposed), 'painted history is recolored even without another scroll event');
const readsAfterPaint = reads;
for (let i = 0; i < 20; i++) callbacks.get('render')();
await new Promise(resolve => setTimeout(resolve, 60));
assert.equal(reads, readsAfterPaint, 'decoration paint must not schedule an endless highlighting loop');
callbacks.get('write')(); highlighter.dispose();
const finalReads = reads;
await new Promise(resolve => setTimeout(resolve, 60));
assert.equal(objectsLive, 0); assert.equal(subscriptionsDisposed, 5); assert.equal(reads, finalReads);

for (const text of ['Welcome to this session', 'Please copy this file and save it', 'The system is active', '#', '!']) assert.deepEqual(findUsefulNetworkHighlights(text), []);
for (const text of ['peer 192.0.2.1 enable', 'GigabitEthernet0/0/1 up up', 'ip ip-prefix TEST permit 192.0.2.0 24', 'BGP neighbor failed', 'description Uplink to core', 'display ip interface brief']) assert(findUsefulNetworkHighlights(text).length > 0);
console.log('Network highlighting: vendor syntax, useful lines, persistent scrollback colors and cleanup passed');

// Additional vocabulary and color groups from the supplied Juniper/Huawei syntax files.
for (const word of ['system-view', 'commit', 'undo', 'display', 'compare', 'rename', 'reset']) assert.equal(tokens(word)[0]?.[1], 'command');
for (const word of ['policy-options', 'class-of-service', 'logical-systems', 'traffic-policy', 'security-zone', 'vrrp']) assert.deepEqual(tokens(word), [[word, 'keyword']]);
for (const word of ['disable', 'deactivate', 'fault', 'not_permitted', 'not-allowed', 'refused', 'notconnect', 'reject', 'deny']) assert.equal(tokens(word)[0]?.[1], 'bad');
for (const word of ['enable', 'permit', 'forwarding', 'yes', 'ok']) assert.equal(tokens(word)[0]?.[1], 'good');
assert.deepEqual(tokens('description uplink to core'), [['description uplink to core', 'good']]);
assert.deepEqual(tokens('# Huawei configuration comment'), [['# Huawei configuration comment', 'comment']]);
assert.deepEqual(tokens('! Cisco configuration comment'), [['! Cisco configuration comment', 'comment']]);
assert.deepEqual(tokens('localhost'), [['localhost', 'address']]);
assert.deepEqual(tokens('Ten-GigabitEthernet1/0/1'), [['Ten-GigabitEthernet1/0/1', 'interface']]);

assert.deepEqual(tokens('route-policy ROUTE-POLICY'), []);
assert.deepEqual(tokens('peer 10.3.226.209 route-policy DHAKA_RCV_V4 import'), [
  ['peer', 'keyword'], ['10.3.226.209', 'address'],
]);
assert.deepEqual(tokens('ip ip-prefix ALL_ROUTES index 10 permit 103.120.164.0 22 greater-equal 22 less-equal 32'), [
  ['ip', 'keyword'], ['ip-prefix', 'keyword'], ['permit', 'good'], ['103.120.164.0 22', 'address'],
  ['greater-equal', 'keyword'], ['22', 'address'], ['less-equal', 'keyword'], ['32', 'address'],
]);
assert.deepEqual(tokens('ipv6 ip-prefix V6 permit 2001:db8:: 32 greater-equal 48 less-equal 128'), [
  ['ipv6', 'keyword'], ['ip-prefix', 'keyword'], ['permit', 'good'], ['2001:db8:: 32', 'address'],
  ['greater-equal', 'keyword'], ['48', 'address'], ['less-equal', 'keyword'], ['128', 'address'],
]);
assert.deepEqual(tokens('ip ip-prefix DEFAULT permit 0.0.0.0 0'), [
  ['ip', 'keyword'], ['ip-prefix', 'keyword'], ['permit', 'good'], ['0.0.0.0 0', 'address'],
]);
assert.deepEqual(tokens('ip ip-prefix TEST permit 192.0.2.0/24'), [
  ['ip', 'keyword'], ['ip-prefix', 'keyword'], ['permit', 'good'], ['192.0.2.0/24', 'address'],
]);
assert.deepEqual(tokens('192.0.2.1 24'), [['192.0.2.1', 'address']]);
assert(!tokens('ip ip-prefix BAD permit 192.0.2.0 33 greater-equal 99').some(([text]) => text === '192.0.2.0 33' || text === '99'));

// Configuration is bounded and custom matches remain literal, even for regex syntax.
const { parseHighlightRules, defaultHighlightRules, getHighlightRules, saveHighlightRules, MAX_HIGHLIGHT_RULES } = await import('../src/network-highlighting.ts');
const defaults = defaultHighlightRules();
assert.equal(parseHighlightRules(null).length, defaults.length);
assert.deepEqual(parseHighlightRules([{ id: 'bad', text: 'x', color: 'red' }]), []);
assert.equal(parseHighlightRules(Array.from({ length: 100 }, (_, i) => ({ id: String(i), text: 'a'.repeat(100), color: '#123456' }))).length, MAX_HIGHLIGHT_RULES);
assert.equal(parseHighlightRules([{ id: 'long', text: 'a'.repeat(100), color: '#123456' }])[0].text.length, 80);
assert.equal(parseHighlightRules([defaults[0], defaults[0]]).length, 1);
let stored;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem: (_key, value) => { stored = value; } } });
saveHighlightRules([{ id: 'custom', text: '[a+].*', color: '#123456' }]);
assert.equal(JSON.parse(stored)[0].text, '[a+].*');
assert.equal(getHighlightRules().length, 1);
assert.equal(findUsefulNetworkHighlights('İ [A+].*')[0].start, 2);
assert.equal(findUsefulNetworkHighlights('İ [A+].*')[0].color, '#123456');
assert.deepEqual(tokens('DOWN'), [], 'removed built-ins no longer highlight');
assert.equal(findNetworkHighlights('[a+].* '.repeat(1000)).length, 128);
saveHighlightRules(defaults);
assert.equal(findNetworkHighlights('DOWN')[0].color, '#ee8d78');
const live = attachNetworkHighlighting(terminal);
await Promise.resolve();
saveHighlightRules([{ id: 'down', text: 'UP', color: '#112233' }]);
await Promise.resolve();
assert.equal(decorationOptions.at(-1).foregroundColor, '#112233', 'saving rules refreshes live terminal caches');
live.dispose();
console.log('Custom highlighting: persistence, bounds, literal matching, removal and live refresh passed');

const { builtinHighlightWords, MAX_GROUP_WORDS } = await import('../src/network-highlighting.ts');
assert(builtinHighlightWords(2).split(', ').includes('successful'));
assert(builtinHighlightWords(6).split(', ').includes('ospfv3'));
const edited = defaults.map(rule => rule.builtin === 1 ? { ...rule, words: 'broken, port[1], a+b' } : rule);
saveHighlightRules(edited);
assert.deepEqual(tokens('DOWN'), [], 'deleting a default word removes its highlighting');
assert.equal(findUsefulNetworkHighlights('broken')[0].color, '#ee8d78');
assert.deepEqual(tokens('unbroken'), [], 'edited default words retain whole-word matching');
assert.equal(findNetworkHighlights('port[1]')[0].color, '#ee8d78');
assert.equal(findNetworkHighlights('a+b')[0].color, '#ee8d78', 'edited lists treat regex punctuation literally');
assert.equal(getHighlightRules().find(rule => rule.builtin === 1).words, 'broken, port[1], a+b');
const overfull = parseHighlightRules([{ ...defaults[1], words: Array.from({ length: 200 }, (_, i) => `word${i}`).join(', ') }]);
assert.equal(overfull[0].words.split(', ').length, MAX_GROUP_WORDS);
saveHighlightRules(defaults.map(rule => rule.builtin === 1 ? { ...rule, words: '' } : rule));
assert.deepEqual(tokens('DOWN'), [], 'an empty default list disables that group');
saveHighlightRules(defaults);
assert.equal(findNetworkHighlights('DOWN')[0].color, '#ee8d78');
console.log('Editable defaults: complete lists, literal edits, removal, empty lists, persistence and caps passed');

const { normalizeHighlightWords } = await import('../src/network-highlighting.ts');
assert.deepEqual(normalizeHighlightWords('up, connected, successful, up, ,'), ['up', 'connected', 'successful']);
saveHighlightRules(defaults.map(rule => rule.builtin === 1 ? { ...rule, words: 'broken, offline, not ready' } : rule));
assert.equal(getHighlightRules().find(rule => rule.builtin === 1).words, 'broken, offline, not ready');
for (const text of ['broken', 'offline', 'not ready']) assert.equal(findUsefulNetworkHighlights(text)[0].color, '#ee8d78');
saveHighlightRules(defaults);
assert.deepEqual(normalizeHighlightWords('up\ndown'), ['up down'], 'newlines do not separate words');
console.log('Comma-only word lists and whitespace handling passed');

// Mobile highlighting has a per-frame budget, with no pause/resume timer.
const originalTimeout = globalThis.setTimeout;
const originalPerformance = globalThis.performance;
const originalRows = terminal.rows;
const frames = new Map();
let scheduledId = 0, clock = 0, clockStep = 0, timersCreated = 0;
globalThis.requestAnimationFrame = callback => { const id = ++scheduledId; frames.set(id, callback); return id; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
globalThis.setTimeout = () => { timersCreated++; assert.fail('mobile highlighting must not wait for a scroll-idle timer'); };
globalThis.performance = { now: () => { clock += clockStep; return clock; } };
const flushFrame = () => {
  const before = reads;
  const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback());
  assert(reads - before <= 4, 'at most four new rows are scanned in a frame');
  assert(frames.size <= 1, 'only one continuation may be queued');
  return reads - before;
};
const drain = () => {
  let count = 0;
  while (frames.size) { assert(count++ < 100, 'highlighting must eventually settle'); flushFrame(); }
};
try {
  terminal.rows = 12;
  buffer.viewportY = 0;
  contents.set(0, 'ordinary plain text');
  const mobile = attachNetworkHighlighting(terminal, true);
  const beforeInitial = reads;
  assert.equal(flushFrame(), 4);
  assert.equal(reads - beforeInitial, 4, 'a viewport is split across frames');
  assert.equal(frames.size, 1, 'remaining rows continue next frame without waiting for idle');
  drain();
  assert.equal(reads - beforeInitial, terminal.rows);

  const cachedReads = reads, cachedDecorations = decorationOptions.length;
  buffer.viewportY = 1; callbacks.get('scroll')(); drain();
  assert.equal(reads - cachedReads, 1, 'only the newly exposed row is scanned');
  buffer.viewportY = 0; callbacks.get('scroll')(); drain();
  assert.equal(reads - cachedReads, 1, 'plain and colored cached rows both survive revisits');
  assert.equal(decorationOptions.length - cachedDecorations, 1);

  const beforeBurst = reads;
  for (let y = 0; y < 5000; y++) { buffer.viewportY = y % 25; callbacks.get('scroll')(); callbacks.get('render')(); }
  assert.equal(reads, beforeBurst, 'scroll events never scan synchronously');
  assert.equal(frames.size, 1, 'rapid scrolls coalesce to one pending frame');
  buffer.viewportY = 20;
  const beforeMarkers = markerOffsets.length;
  callbacks.get('scroll')(); flushFrame();
  assert(markerOffsets.slice(beforeMarkers).every(offset => offset + buffer.baseY + buffer.cursorY >= 20), 'work uses the latest viewport');
  buffer.viewportY = 0; callbacks.get('scroll')(); drain();

  for (let y = 0; y < 100; y++) {
    buffer.viewportY = y % 25; callbacks.get('scroll')(); flushFrame();
    assert(objectsLive <= terminal.rows * 4, 'visited history retains a bounded marker/decoration cache');
  }
  buffer.viewportY = 0; callbacks.get('scroll')(); drain();

  clockStep = 1;
  callbacks.get('write')();
  assert.equal(flushFrame(), 2, 'the time budget yields before the row limit is reached');
  callbacks.get('write')(); // Output arrives while a partial pass is pending.
  drain();
  clockStep = 0;
  const afterUpdates = reads;
  mobile.refresh(); drain();
  assert.equal(reads, afterUpdates, 'all rows eventually reach the newest output generation');

  const beforeDeviceColors = decorationOptions.length;
  deviceColored = true; callbacks.get('write')(); drain();
  assert.equal(decorationOptions.length, beforeDeviceColors, 'device ANSI colors retain precedence');
  deviceColored = false;
  callbacks.get('write')(); drain();
  assert(decorationOptions.length > beforeDeviceColors, 'removing ANSI colors restores highlights');
  buffer.type = 'alternate'; callbacks.get('buffer')(); drain();
  assert.equal(objectsLive, 0, 'alternate buffers release the normal-buffer cache');
  buffer.type = 'normal'; callbacks.get('buffer')(); flushFrame();
  mobile.dispose();
  assert.equal(frames.size, 0, 'closing a pane cancels partial work');
  assert.equal(objectsLive, 0, 'closing a pane releases cached rows and decorations');
  assert.equal(timersCreated, 0);
} finally {
  terminal.rows = originalRows;
  globalThis.setTimeout = originalTimeout;
  globalThis.performance = originalPerformance;
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
}
console.log('Mobile highlighting: row/time budgets, cached plain rows, latest viewport, output invalidation and cleanup passed');
