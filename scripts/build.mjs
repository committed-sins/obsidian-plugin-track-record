import { build } from 'esbuild';
import { mkdir, readFile, copyFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const versions = JSON.parse(await readFile('versions.json', 'utf8'));
if (manifest.id !== 'track-record' || manifest.version !== pkg.version || versions[pkg.version] !== manifest.minAppVersion) throw Error('Inconsistent plugin identity or version.');
await mkdir('dist', { recursive: true });
await build({
    entryPoints: ['src/main.ts'], outfile: 'dist/main.js', bundle: true,
    external: ['obsidian'], platform: 'browser', format: 'cjs', target: 'es2022',
    banner: { js: '/* Track Record — MIT — Michael J. Stallinger / Committed Sins */' }
});
for (const name of ['manifest.json', 'styles.css']) await copyFile(name, `dist/${name}`);
