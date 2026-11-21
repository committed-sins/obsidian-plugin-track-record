import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.id !== 'track-record' || manifest.version !== pkg.version || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw Error('Release identity/version mismatch.');
const output = path.join('dist', 'release', manifest.version);
await mkdir(output, { recursive: true });
const hashes = [];
for (const name of ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    const source = ['main.js', 'manifest.json', 'styles.css'].includes(name) ? path.join('dist', name) : name;
    const bytes = await readFile(source);
    if (name === 'main.js' && !bytes.includes(Buffer.from('Copyright Eemeli Aro'))) throw Error('Bundled dependency license missing.');
    await copyFile(source, path.join(output, name));
    hashes.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
}
await writeFile(path.join(output, 'SHA256SUMS'), hashes.join('\n') + '\n');
await copyFile(`docs/releases/${manifest.version}.md`, path.join(output, 'RELEASE_NOTES.md'));
console.log(`Prepared ${output}. No Git tag or GitHub release was created. User Test-vault acceptance is required before publishing.`);
