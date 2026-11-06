import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const directory = new URL('./windows-x86_64/', import.meta.url);
const expected = '795e325ede3a1afa69ccf1d1aee250f30ebc3e40d6598e2e2f2c0a3d4678491b';
const actual = createHash('sha256').update(readFileSync(new URL('mtr.exe', directory))).digest('hex');
if (actual !== expected) throw new Error('Bundled MTR checksum mismatch');
for (const name of ['LICENSE.txt', 'README.txt', 'SHA256SUM', 'PROVENANCE.txt']) {
  if (!existsSync(fileURLToPath(new URL(name, directory)))) throw new Error(`Missing MTR distribution file: ${name}`);
}
console.log('Bundled windows-mtr v1.2.9 checksum and distribution files verified');
