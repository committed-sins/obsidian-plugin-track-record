import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function within(parent, child)
{
    const relative = path.relative(parent, child);
    return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

export async function deploy({ root, artifacts = 'dist' })
{
    if (!root) throw Error('Pass the test vault path explicitly: node scripts/deploy.mjs <test-vault>.');
    const vault = await fs.realpath(path.resolve(root));
    // This preview may only be deployed to a deliberately named test vault.
    if (path.basename(vault).toLowerCase() !== 'test') throw Error('Preview deployment requires a vault named Test.');
    const config = await fs.realpath(path.join(vault, '.obsidian'));
    if (!within(vault, config)) throw Error('Config resolves outside the test vault.');
    const manifest = JSON.parse(await fs.readFile(path.join(artifacts, 'manifest.json'), 'utf8'));
    if (manifest.id !== 'track-record') throw Error('Wrong plugin ID.');
    const plugins = path.join(config, 'plugins');
    await fs.mkdir(plugins, { recursive: true });
    const pluginsReal = await fs.realpath(plugins);
    if (!within(config, pluginsReal)) throw Error('Plugins resolve outside the config directory.');
    const target = path.join(pluginsReal, 'track-record');
    try {
        if ((await fs.lstat(target)).isSymbolicLink()) throw Error('Refusing a redirected plugin directory.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.mkdir(target, { recursive: true });
    const targetReal = await fs.realpath(target);
    if (!within(pluginsReal, targetReal)) throw Error('Plugin resolves outside the plugins directory.');
    const names = ['main.js', 'manifest.json', 'styles.css'];
    for (const name of names) {
        await fs.access(path.join(artifacts, name));
        try {
            const stat = await fs.lstat(path.join(targetReal, name));
            if (stat.isSymbolicLink() || !stat.isFile()) throw Error(`Unsafe destination: ${name}.`);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    // Never touch settings, activation, workspace state, records or other plugins.
    for (const name of names) await fs.copyFile(path.join(artifacts, name), path.join(targetReal, name));
    return targetReal;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    console.log(`Deployed Track Record to ${await deploy({ root: process.argv[2] })}. Enable/reload it manually in Test.`);
}
