import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { devinPanes } from './core.js';
import { listPanes } from './herdr.js';

const socket = process.env.HERDR_SOCKET_PATH;
const stateDir = process.env.HERDR_PLUGIN_STATE_DIR;
const bin = process.env.HERDR_BIN_PATH ?? 'herdr';
if (!socket || !stateDir) process.exit(0);

try {
  if (!devinPanes(await listPanes(bin, socket)).length) process.exit(0);
  const registry = join(stateDir, 'servers');
  await mkdir(registry, { recursive: true });
  const key = createHash('sha256').update(socket).digest('hex');
  await writeFile(join(registry, `${key}.json`), JSON.stringify({ socket, bin }), { mode: 0o600 });
  const child = spawn(process.execPath, [join(import.meta.dirname, 'worker.js')], {
    cwd: process.env.HERDR_PLUGIN_ROOT ?? process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: process.env,
    windowsHide: true,
  });
  child.unref();
} catch (error) {
  console.error(`Devin metadata could not start: ${error.message}`);
  process.exitCode = 1;
}
