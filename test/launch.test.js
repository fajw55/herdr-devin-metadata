import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, join } from 'node:path';

const root = join(import.meta.dirname, '..');

function cleanEnv() {
  const env = { ...process.env };
  delete env.HERDR_SOCKET_PATH;
  delete env.HERDR_PLUGIN_STATE_DIR;
  env.PATH = `${dirname(process.execPath)}${delimiter}${env.PATH ?? env.Path ?? ''}`;
  return env;
}

function windowsCommands(manifest) {
  return manifest
    .split(/\n(?=\[\[)/)
    .filter(block => /platforms\s*=\s*\["windows"\]/.test(block))
    .map(block => JSON.parse(block.match(/command\s*=\s*(\[[^\n]+\])/)[1]));
}

test('launch.js exits cleanly when no Herdr socket or state dir is set', () => {
  const result = spawnSync(process.execPath, [join(root, 'src', 'launch.js')], {
    cwd: root,
    env: cleanEnv(),
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

test('the Windows startup and event commands declared in herdr-plugin.toml run cleanly', () => {
  const manifest = readFileSync(join(root, 'herdr-plugin.toml'), 'utf8');
  const commands = windowsCommands(manifest);
  assert.equal(commands.length, 2, 'expected one windows startup command and one windows event command');
  for (const [bin, ...args] of commands) {
    const result = spawnSync(bin, args, { cwd: root, env: cleanEnv(), encoding: 'utf8' });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
  }
});
