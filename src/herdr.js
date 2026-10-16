import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function callHerdr(bin, socket, args) {
  const { stdout } = await exec(bin, args, {
    env: { ...process.env, HERDR_SOCKET_PATH: socket },
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  return JSON.parse(stdout);
}

export function listPanes(bin, socket) {
  return callHerdr(bin, socket, ['pane', 'list']);
}

export async function reportTokens(bin, socket, paneId, patch, ttlMs) {
  const args = ['pane', 'report-metadata', String(paneId), '--source', 'herdr-devin-metadata', '--ttl-ms', String(ttlMs)];
  for (const [name, value] of Object.entries(patch)) {
    if (value == null) args.push('--clear-token', name);
    else args.push('--token', `${name}=${value}`);
  }
  if (Object.keys(patch).length) await callHerdr(bin, socket, args);
}

