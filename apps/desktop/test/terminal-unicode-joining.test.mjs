import assert from 'node:assert/strict';
import test from 'node:test';
import { unicodeJoinRanges, attachTerminalUnicodeJoining } from '../src/terminal-unicode-joining.ts';

test('joins Bengali vowel marks and conjuncts in UTF-16 ranges', () => {
  for (const cluster of ['কি', 'কু', 'ক্ষ', 'ক্তি', 'র্য', 'র্ক', 'শ্র', 'ক\u09cd\u200dষ']) {
    const text = `REF: ${cluster} end`;
    assert.deepEqual(unicodeJoinRanges(text), [[5, 5 + cluster.length]], cluster);
  }
});

test('preserves word boundaries and does not join ordinary ASCII or single codepoints', () => {
  assert.deepEqual(unicodeJoinRanges('prompt$ 123 ASCII -> []'), []);
  assert.deepEqual(unicodeJoinRanges('ক খ গ 中文 😀'), []);
  assert.deepEqual(unicodeJoinRanges('কি কু'), [[0, 2], [3, 5]]);
});

test('handles combining accents, Indic conjuncts, and emoji without splitting surrogate pairs', () => {
  for (const cluster of ['e\u0301', 'क्षि', '👩\u200d💻', '🇧🇩', '👍🏽']) {
    const prefix = '😀 ';
    assert.deepEqual(unicodeJoinRanges(prefix + cluster), [[prefix.length, prefix.length + cluster.length]], cluster);
  }
});

test('registers once and removes the joiner during terminal cleanup', () => {
  let removed;
  const dispose = attachTerminalUnicodeJoining({
    registerCharacterJoiner(handler) { assert.equal(handler, unicodeJoinRanges); return 7; },
    deregisterCharacterJoiner(id) { removed = id; },
  });
  dispose();
  assert.equal(removed, 7);
});
