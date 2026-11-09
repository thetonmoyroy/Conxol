import assert from 'node:assert/strict';
import console from 'node:console';
import { resolveTerminalTheme, terminalSurface, defaultTerminalAppearance } from '../src/terminal-appearance.ts';
import { terminalThemes } from '../src/theme.ts';

// Old saved presets must never override the shared workspace theme.
for (const mode of ['dark', 'light']) {
  for (const colorTheme of ['', 'dark', 'light', 'midnight']) {
    const appearance = { ...defaultTerminalAppearance, colorTheme };
    const resolved = resolveTerminalTheme(mode, appearance);
    assert.equal(resolved.background, terminalThemes[mode].background);
    assert.equal(resolved.foreground, terminalThemes[mode].foreground);
    assert.equal(resolved.red, terminalThemes[mode].red);
    assert.equal(terminalSurface(mode, appearance), resolved.background);
  }
  const custom = resolveTerminalTheme(mode, { colorTheme: 'midnight', background: '#123456', foreground: '#abcdef' });
  assert.equal(custom.background, '#123456');
  assert.equal(custom.foreground, '#abcdef');
  assert.equal(custom.cursor, '#abcdef');
  assert.equal(custom.cursorAccent, '#123456');
  assert.equal(custom.red, terminalThemes[mode].red);
}
console.log('Shared terminal theme, old presets, and custom colors passed');
