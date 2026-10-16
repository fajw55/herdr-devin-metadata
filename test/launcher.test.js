import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const root = join(import.meta.dirname, '..');

test('Herdr can start the plugin with a minimal GUI PATH', {
  skip: process.platform === 'win32'
    ? 'bin/start.sh is POSIX-only; Windows uses a direct "node src/launch.js" startup command instead (see test/launch.test.js)'
    : false,
}, () => {
  const manifest = readFileSync(join(root, 'herdr-plugin.toml'), 'utf8');
  const command = manifest.match(/\[\[startup\]\]\s*command = (\[[^\n]+\])/);
  assert.ok(command, 'startup command is declared');
  const argv = JSON.parse(command[1]);
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: root,
    env: {
      PATH: '/usr/bin:/bin',
      SHELL: '/bin/false',
      HERDR_DEVIN_EXTRA_PATH: dirname(process.execPath),
    },
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});
