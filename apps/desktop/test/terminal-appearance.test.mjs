import assert from 'node:assert/strict';
import console from 'node:console';
import { resolveTerminalTheme, terminalSurface, defaultTerminalAppearance, terminalPresets, selectedTerminalPreset } from '../src/terminal-appearance.ts';
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

for (const [id, preset] of Object.entries(terminalPresets)) {
  assert.equal(selectedTerminalPreset(id), id);
  {
    const resolved = resolveTerminalTheme(id, defaultTerminalAppearance);
    assert.equal(resolved.background, preset.theme.background);
    assert.equal(resolved.red, preset.theme.red);
    for (const color of Object.values(preset.theme)) assert.match(color, /^#[0-9a-f]{6}$/i);
    const custom = resolveTerminalTheme(id, { colorTheme: "", background: '#123456', foreground: '#abcdef' });
    assert.equal(custom.background, '#123456');
    assert.equal(custom.red, preset.theme.red);
    assert.equal(terminalSurface(id, defaultTerminalAppearance), preset.theme.background);
  }
}
assert.equal(selectedTerminalPreset('toString'), '');
console.log('Terminal presets, overrides and surface colors passed');

const { workspaceTheme, themeMode, appThemeVariables, isThemePreference } = await import('../src/theme.ts');
for (const id of Object.keys(terminalPresets)) {
  assert.equal(workspaceTheme('system', id), id);
  assert.equal(workspaceTheme(id, 'nord'), id);
  assert.equal(isThemePreference(id), true);
  assert.equal(appThemeVariables(id)['--bg'], terminalPresets[id].theme.background);
  assert.equal(themeMode(id), id === 'solarizedLight' ? 'light' : 'dark');
}
assert.equal(workspaceTheme('light', 'unknown'), 'light');
assert.equal(isThemePreference('toString'), false);
console.log('Unified app palettes and legacy terminal preset migration passed');

