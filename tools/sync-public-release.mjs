import { readFileSync, writeFileSync } from 'node:fs';

// Read only GitHub release metadata; never download or build packages.
const repository = process.env.GITHUB_REPOSITORY || 'thetonmoyroy/Conxol';
const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
  headers: { Accept: 'application/vnd.github+json', ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) },
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error(`Release lookup failed: HTTP ${response.status}`);
const release = await response.json();
if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error('Expected a published stable release');
const version = release.tag_name.slice(1);
const suffixes = ['windows-x64.exe', 'macos-arm64.dmg', 'macos-x64.dmg', 'linux-x64.deb', 'linux-x64.AppImage', 'android-arm64.apk'];
// Fail before modifying any file if publishing is still incomplete.
for (const suffix of suffixes) {
  const name = `Conxol-${version}-${suffix}`;
  if (!release.assets.some(asset => asset.name === name && asset.state === 'uploaded')) throw new Error(`Release is missing ${name}; finish publishing assets before syncing`);
}
const files = ['README.md', 'site/index.html', 'site/docs.html'];
let stale = false;
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  // Preserve explicitly historical preview notes and their signing guidance.
  const after = before.replace(/(?<![\d.])0\.\d+\.\d+\b(?![.\d]|-android-preview)/g, version);
  if (before === after) continue;
  stale = true;
  if (!process.argv.includes('--check')) writeFileSync(file, after);
  console.log(`${process.argv.includes('--check') ? 'Stale' : 'Updated'}: ${file}`);
}
if (stale && process.argv.includes('--check')) process.exitCode = 1;
console.log(`Published release: ${release.tag_name}; verified ${suffixes.length} package assets`);
