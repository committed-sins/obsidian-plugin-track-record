import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deploy } from '../scripts/deploy.mjs';

test('deployment copies only runtime artifacts and preserves settings and activation', async () =>
{
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'track-record-deploy-'));
    const vault = path.join(base, 'Test');
    const config = path.join(vault, '.obsidian');
    const target = path.join(config, 'plugins', 'track-record');
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'data.json'), '{"preserve":true}');
    await fs.writeFile(path.join(config, 'community-plugins.json'), '["example"]');
    await fs.writeFile(path.join(config, 'workspace.json'), 'workspace');
    const artifacts = path.join(base, 'artifacts');
    await fs.mkdir(artifacts);
    for (const [file, content] of Object.entries({ 'main.js': 'code', 'manifest.json': '{"id":"track-record"}', 'styles.css': 'css' })) await fs.writeFile(path.join(artifacts, file), content);
    assert.equal(await deploy({ root: vault, artifacts }), await fs.realpath(target));
    assert.equal(await fs.readFile(path.join(target, 'data.json'), 'utf8'), '{"preserve":true}');
    assert.equal(await fs.readFile(path.join(config, 'community-plugins.json'), 'utf8'), '["example"]');
    assert.equal(await fs.readFile(path.join(config, 'workspace.json'), 'utf8'), 'workspace');
    assert.deepEqual((await fs.readdir(target)).sort(), ['data.json', 'main.js', 'manifest.json', 'styles.css']);
});

test('deployment refuses production vaults and wrong artifacts', async () =>
{
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'track-record-reject-'));
    const production = path.join(base, 'Continuum');
    await fs.mkdir(production);
    await assert.rejects(deploy({ root: production }), /named Test/);
    const vault = path.join(base, 'Test');
    await fs.mkdir(path.join(vault, '.obsidian'), { recursive: true });
    const artifacts = path.join(base, 'artifacts');
    await fs.mkdir(artifacts);
    await fs.writeFile(path.join(artifacts, 'manifest.json'), '{"id":"other"}');
    await assert.rejects(deploy({ root: vault, artifacts }), /Wrong plugin/);
});

test('deployment refuses a plugin junction redirected into another plugin', async () =>
{
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'track-record-junction-'));
    const vault = path.join(base, 'Test');
    const plugins = path.join(vault, '.obsidian', 'plugins');
    const other = path.join(plugins, 'other-plugin');
    await fs.mkdir(other, { recursive: true });
    await fs.writeFile(path.join(other, 'main.js'), 'other plugin');
    await fs.symlink(other, path.join(plugins, 'track-record'), 'junction');
    const artifacts = path.join(base, 'artifacts');
    await fs.mkdir(artifacts);
    await fs.writeFile(path.join(artifacts, 'manifest.json'), '{"id":"track-record"}');
    await assert.rejects(deploy({ root: vault, artifacts }), /redirected plugin directory/);
    assert.equal(await fs.readFile(path.join(other, 'main.js'), 'utf8'), 'other plugin');
});
