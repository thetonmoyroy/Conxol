import assert from 'node:assert/strict';
import test from 'node:test';
import xterm from '@xterm/xterm';
import { unicodeJoinRanges, attachTerminalUnicodeJoining, configureTerminalUnicodeWidths } from '../src/terminal-unicode-joining.ts';

test('Bangla combining marks retain their base cell during cursor-positioned redraws', async () => {
  const terminal = new xterm.Terminal({ allowProposedApi: true });
  try {
    configureTerminalUnicodeWidths(terminal);
    assert.equal(terminal.unicode.activeVersion, '6-conxol');
    for (const cluster of ['কা', 'কৌ', 'ক৾', 'কি', 'ক্ষ', '中', 'A']) {
      const width = ['কা', 'কৌ', 'কি', 'ক্ষ', '中'].includes(cluster) ? 2 : 1;
      await new Promise(resolve => terminal.write(`\r\x1b[2K${cluster}\x1b[${width + 1}G|`, resolve));
      assert.equal(terminal.buffer.active.getLine(0).translateToString(true), `${cluster}|`);
      assert.equal(terminal.buffer.active.cursorX, width + 1);
    }
  } finally {
    terminal.dispose();
  }
});

test('joins Bengali vowel marks and conjuncts in UTF-16 ranges', () => {
  for (const cluster of ['কি', 'কু', 'ক্ষ', 'ক্তি', 'র্য', 'র্ক', 'শ্র', 'ক\u09cd\u200dষ']) {
    const text = `REF: ${cluster} end`;
    assert.deepEqual(unicodeJoinRanges(text), [[5, 5 + cluster.length]], cluster);
  }
});

test('retains the reported Bangla sentence in the terminal buffer', async () => {
  const sentence = 'শাহআলম ভাই। এই আইপিডা একটু দেহেন। ডি আই এস সাতশো সাতশো আইপি।';
  const terminal = new xterm.Terminal({ allowProposedApi: true, cols: 120 });
  try {
    configureTerminalUnicodeWidths(terminal);
    await new Promise(resolve => terminal.write(`$ ${sentence}`, resolve));
    assert.equal(terminal.buffer.active.getLine(0).translateToString(true), `$ ${sentence}`);
    assert.equal(terminal.buffer.active.cursorX, 61);
  } finally {
    terminal.dispose();
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
