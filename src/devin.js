import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseCredentials } from './core.js';

const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
export const credentialsPath = process.env.DEVIN_CREDENTIALS_PATH ?? join(dataHome, 'devin', 'credentials.toml');
export const sessionsPath = process.env.DEVIN_SESSIONS_DB ?? join(dataHome, 'devin', 'cli', 'sessions.db');

export async function readDevinCredentials(path = credentialsPath) {
  return parseCredentials(await readFile(path, 'utf8'));
}

export function readSessionModel(sessionId, path = sessionsPath) {
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) return null;
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const row = db.prepare('SELECT model FROM sessions WHERE id = ?').get(sessionId);
    return typeof row?.model === 'string' && row.model.length <= 80 ? row.model : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function fetchPlanStatus(credentials, fetchImpl = fetch) {
  const response = await fetchImpl(`${credentials.apiServerUrl}/exa.seat_management_pb.SeatManagementService/GetUserStatus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'connect-protocol-version': '1' },
    body: JSON.stringify({ metadata: {
      api_key: credentials.apiKey,
      extension_name: 'chisel',
      extension_version: '0.1.0',
      ide_name: 'herdr-devin-metadata',
      ide_version: '0.1.0',
    } }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Devin quota unavailable (HTTP ${response.status})`);
  const body = await response.json();
  const plan = body?.userStatus?.planStatus;
  if (!plan || typeof plan !== 'object') throw new Error('Devin quota response has no plan status');
  return plan;
}
