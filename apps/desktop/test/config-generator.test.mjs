import assert from 'node:assert/strict';
import { generateConfig, simpleSections, replaceSimpleSection, moveBlock, findBlock, isLoop } from '../src/config-generator.ts';
const commands = [{ id: '1', text: 'interface eth 0/{n}' }, { id: '2', text: ' no shutdown' }];
assert.equal(generateConfig(commands, '1', '2', '1').text, 'interface eth 0/1\n no shutdown\ninterface eth 0/2\n no shutdown');
assert.equal(generateConfig([{ id: '1', text: '{n}-{n}' }], '3', '1', '-1').text, '3-3\n2-2\n1-1');
assert.equal(generateConfig(commands, '1', '6', '2').count, 3);
for (const range of [['', '2', '1'], ['1', '2', '0'], ['3', '1', '1'], ['0', '10000', '1'], ['1.5', '2', '1']]) {
  assert.ok(generateConfig(commands, ...range).error);
}
assert.ok(generateConfig([], '1', '2', '1').error);
assert.ok(generateConfig([{ id: '1', text: 'x'.repeat(1000) }], '1', '10000', '1').error);

const inner = { id: 'inner', kind: 'loop', start: '1', end: '2', step: '1', children: [
  { id: 'port', text: 'interface eth {n}/{n2}' }, { id: 'enable', text: ' no shutdown' },
] };
const tree = [{ id: 'before', text: 'slot {n}' }, inner, { id: 'after', text: 'exit' }];
assert.equal(generateConfig(tree, '0', '1', '1').text,
  'slot 0\ninterface eth 0/1\n no shutdown\ninterface eth 0/2\n no shutdown\nexit\nslot 1\ninterface eth 1/1\n no shutdown\ninterface eth 1/2\n no shutdown\nexit');
const third = { id: 'third', kind: 'loop', start: '4', end: '2', step: '-2', children: [{ id: 'three', text: '{n}/{n2}/{n3}' }] };
assert.equal(generateConfig([{ ...inner, children: [third] }], '1', '1', '1').text, '1/1/4\n1/1/2\n1/2/4\n1/2/2');
assert.ok(generateConfig([{ id: 'bad', text: '{n2}' }], '1', '2', '1').error);
assert.ok(generateConfig([{ ...inner, step: '0' }], '1', '2', '1').error);
assert.ok(generateConfig([{ ...inner, end: '10000' }], '1', '10000', '1').error);
assert.deepEqual(moveBlock(tree, 'inner', 'inner'), tree);
assert.deepEqual(moveBlock([{ ...inner, children: [third] }], 'inner', 'third'), [{ ...inner, children: [third] }]);
const movedIn = moveBlock(tree, 'before', 'inner', 'port');
assert.equal(movedIn.length, 2);
assert.equal(findBlock(movedIn, 'inner').children[0].id, 'before');
const movedOut = moveBlock(tree, 'port', 'root', 'before');
assert.equal(movedOut[0].id, 'port');
assert.equal(findBlock(movedOut, 'inner').children.length, 1);
assert.ok(isLoop(findBlock(movedOut, 'inner')));
assert.equal(tree[1].children.length, 2, 'moves must not mutate original tree');
let deep = [{ id: 'leaf', text: 'x' }];
for (let i = 0; i < 8; i++) deep = [{ ...inner, id: `depth${i}`, children: deep }];
assert.ok(generateConfig(deep, '1', '1', '1').error);
// Switching to Simple must describe branching trees without flattening loops.
const branching = [
  { id: 'intro1', text: 'configure' }, { id: 'intro2', text: 'slot {n}' },
  inner,
  { id: 'finish', text: 'exit' },
  { ...inner, id: 'sibling', start: '7', end: '8', children: [{ id: 'siblingText', text: 'vlan {n2}' }] },
];
const original = JSON.parse(JSON.stringify(branching));
function simpleRoundTrip(blocks) {
  return simpleSections(blocks).flatMap(section => Array.isArray(section)
    ? [{ id: section[0].id, text: section.map(command => command.text).join('\n') }]
    : [{ ...section, children: simpleRoundTrip(section.children) }]);
}
assert.deepEqual(generateConfig(simpleRoundTrip(branching), '1', '2', '1'), generateConfig(branching, '1', '2', '1'));
assert.deepEqual(branching, original, 'showing Simple view must not mutate the tree');
const rootEdit = replaceSimpleSection(branching, 'root', ['intro1', 'intro2'], 'updated slot {n}');
assert.equal(rootEdit[0].text, 'updated slot {n}');
assert.deepEqual(rootEdit.slice(1), branching.slice(2), 'editing commands before a loop must retain all later blocks');
const innerEdit = replaceSimpleSection(branching, 'inner', ['port', 'enable'], 'port {n}/{n2}\n enable');
assert.equal(findBlock(innerEdit, 'inner').children.length, 1);
assert.equal(findBlock(innerEdit, 'inner').children[0].text, 'port {n}/{n2}\n enable');
assert.deepEqual(findBlock(innerEdit, 'sibling'), findBlock(branching, 'sibling'));
assert.deepEqual(generateConfig(simpleRoundTrip([{ ...inner, children: [third] }]), '1', '2', '1'), generateConfig([{ ...inner, children: [third] }], '1', '2', '1'));
assert.deepEqual(simpleSections([]), []);

// Repeated range edits always regenerate from the requested first number.
for (const [start, end, step, expected] of [
  ['1', '60', '1', 60], ['1', '20', '1', 20],
  ['10', '14', '2', 3], ['3', '1', '-1', 3], ['1', '2', '1', 2],
]) {
  const result = generateConfig(commands, start, end, step);
  assert.equal(result.error, '');
  assert.equal(result.count, expected);
  assert.equal(result.text.split('\n').length, expected * 2);
  assert.equal(result.text.split('\n')[0], `interface eth 0/${start}`);
  assert.equal(result.text.split('\n').at(-2), `interface eth 0/${Number(start) + (expected - 1) * Number(step)}`);
}
