import assert from 'node:assert/strict';
import test from 'node:test';
import { suppressMirroredTerminalReports } from '../src/terminal-window-reports.ts';

test('only the source answers terminal reports; mirror still accepts color updates', () => {
  const csi = [], dcs = [], osc = [];
  let disposed = 0;
  const register = entries => (id, handler) => {
    entries.push({ id, handler });
    return { dispose() { disposed++; } };
  };
  const dispose = suppressMirroredTerminalReports({ parser: {
    registerCsiHandler: register(csi), registerDcsHandler: register(dcs), registerOscHandler: register(osc),
  } });
  assert.equal(csi.find(({ id }) => id.final === 'n' && !id.prefix).handler([6]), true);
  assert.equal(csi.find(({ id }) => id.final === 'c' && id.prefix === '>').handler([]), true);
  assert.equal(dcs[0].handler('m'), true);
  const palette = osc.find(({ id }) => id === 4).handler;
  assert.equal(palette('1;?'), true);
  assert.equal(palette('1;rgb:ffff/0000/0000'), false);
  assert.equal(osc.find(({ id }) => id === 11).handler('?'), true);
  assert.equal(csi.some(({ id }) => id.final === 'm'), false);
  dispose();
  assert.equal(disposed, csi.length + dcs.length + osc.length);
});
