import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const script = new URL('./sync-public-release.mjs', import.meta.url).href;
const release = { tag_name: 'v0.1.65', assets: ['windows-x64.exe','macos-arm64.dmg','macos-x64.dmg','linux-x64.deb','linux-x64.AppImage','android-arm64.apk'].map(suffix => ({ name: `Conxol-0.1.65-${suffix}`, state: 'uploaded' })) };
function fixture(run) {
  const cwd = mkdtempSync(join(tmpdir(), 'conxol-front-pages-'));
  try {
    mkdirSync(join(cwd, 'site'));
    const original = 'Conxol 0.1.60 v0.1.60/Conxol-0.1.60-windows-x64.exe 192.0.2.1/30 docs/release/v0.1.60-android-preview.1.md';
    for (const file of ['README.md','site/index.html','site/docs.html']) writeFileSync(join(cwd,file), original);
    const invoke = (metadata, check = false) => spawnSync(process.execPath, ['--input-type=module','-e', `globalThis.fetch = async () => ({ok:true,json:async()=>(${JSON.stringify(metadata)})}); await import(${JSON.stringify(script)});`, ...(check ? ['--','--check'] : [])], {cwd, encoding:'utf8'});
    run({ cwd, original, invoke });
  } finally { rmSync(cwd, {recursive:true, force:true}); }
}
test('sync updates release links, preserves IPs/history, and becomes idempotent', () => fixture(({cwd, invoke}) => {
  assert.equal(invoke(release, true).status, 1);
  assert.equal(invoke(release).status, 0);
  const result = readFileSync(join(cwd,'README.md'),'utf8');
  assert.match(result, /v0\.1\.65\/Conxol-0\.1\.65-windows-x64.exe/);
  assert.match(result, /192\.0\.2\.1\/30/);
  assert.match(result, /v0\.1\.60-android-preview\.1.md/);
  assert.equal(invoke(release, true).status, 0);
}));
test('incomplete publication leaves all front pages untouched', () => fixture(({cwd, original, invoke}) => {
  assert.notEqual(invoke({...release, assets:release.assets.slice(1)}).status, 0);
  for (const file of ['README.md','site/index.html','site/docs.html']) assert.equal(readFileSync(join(cwd,file),'utf8'),original);
}));
