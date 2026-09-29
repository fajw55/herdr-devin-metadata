import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { devinPanes, parseCredentials, usageTokens } from '../src/core.js';
import { fetchPlanStatus, readSessionModel } from '../src/devin.js';

test('only Devin panes are selected from Herdr', () => {
  const reply = { result: { panes: [
    { pane_id: 'p1', agent: 'devin' }, { pane_id: 'p2', agent: 'codex' }, { pane_id: 'p3' },
  ] } };
  assert.deepEqual(devinPanes(reply).map(pane => pane.pane_id), ['p1']);
});

test('usage tokens show consumed daily and weekly quota and expire at reset', () => {
  const plan = { dailyQuotaRemainingPercent: 62, weeklyQuotaRemainingPercent: 38,
    dailyQuotaResetAtUnix: 2000000000, weeklyQuotaResetAtUnix: 2000000000 };
  assert.deepEqual(usageTokens(plan, 1000), { devin_daily_limit: 'day 38%', devin_weekly_limit: 'week 62%' });
  assert.deepEqual(usageTokens(plan, 2000000000000), { devin_daily_limit: null, devin_weekly_limit: null });
});

test('credentials parser reads only the two required generated fields', () => {
  const credentials = parseCredentials('windsurf_api_key = "test-secret"\napi_server_url = "https://example.test"\n');
  assert.deepEqual(credentials, { apiKey: 'test-secret', apiServerUrl: 'https://example.test' });
});

test('model lookup reads the matching Devin session only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devin-model-'));
  try {
    const path = join(root, 'sessions.db');
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT NOT NULL)');
    db.prepare('INSERT INTO sessions (id, model) VALUES (?, ?)').run('session-one', 'adaptive');
    db.close();
    assert.equal(readSessionModel('session-one', path), 'adaptive');
    assert.equal(readSessionModel('another-session', path), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('quota request uses Devin account endpoint without exposing credentials in result', async () => {
  let requested;
  const fetchImpl = async (url, options) => {
    requested = { url, metadata: JSON.parse(options.body).metadata };
    return { ok: true, json: async () => ({ userStatus: { planStatus: {
      dailyQuotaRemainingPercent: 72, weeklyQuotaRemainingPercent: 49,
    } } }) };
  };
  const plan = await fetchPlanStatus({ apiServerUrl: 'https://example.test', apiKey: 'test-secret' }, fetchImpl);
  assert.equal(requested.url, 'https://example.test/exa.seat_management_pb.SeatManagementService/GetUserStatus');
  assert.equal(requested.metadata.api_key, 'test-secret');
  assert.deepEqual(usageTokens(plan), { devin_daily_limit: 'day 28%', devin_weekly_limit: 'week 51%' });
});
