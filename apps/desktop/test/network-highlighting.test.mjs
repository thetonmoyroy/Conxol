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
  onWriteParsed: subscribe('write'), onScroll: subscribe('scroll'), onResize: subscribe('resize'),
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
await new Promise(resolve => setTimeout(resolve, 60));
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
callbacks.get('write')(); highlighter.dispose();
const finalReads = reads;
await new Promise(resolve => setTimeout(resolve, 60));
assert.equal(objectsLive, 0); assert.equal(subscriptionsDisposed, 4); assert.equal(reads, finalReads);

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
