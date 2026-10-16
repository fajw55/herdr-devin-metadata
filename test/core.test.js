import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { devinCredentialsPath, devinPanes, devinSessionsPath, parseCredentials, usageTokens } from '../src/core.js';
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
  assert.deepEqual(usageTokens(plan, 1000), { devin_acu_remaining: null, devin_daily_limit: 'day 38%', devin_weekly_limit: 'week 62%' });
  assert.deepEqual(usageTokens(plan, 2000000000000), { devin_acu_remaining: null, devin_daily_limit: null, devin_weekly_limit: null });
});

test('ACU remaining takes priority over daily and weekly quota', () => {
  const plan = { acuLimit: 200, acuConsumed: 0.809125, planEnd: '2026-11-15T08:00:00Z',
    dailyQuotaRemainingPercent: 62, weeklyQuotaRemainingPercent: 38 };
  assert.deepEqual(usageTokens(plan, Date.parse('2026-10-15T12:00:00Z')), {
    devin_acu_remaining: 'ACU 199.2 / 200 left', devin_daily_limit: null, devin_weekly_limit: null,
  });
});

test('ACU readings support zero consumption and exhausted allowances', () => {
  for (const [acuConsumed, expected] of [[0, 'ACU 200 / 200 left'], [200, 'ACU 0 / 200 left'], [201, 'ACU 0 / 200 left']]) {
    assert.equal(usageTokens({ acuLimit: 200, acuConsumed }).devin_acu_remaining, expected);
  }
  assert.equal(usageTokens({ acuLimit: '200', acuConsumed: '12.5' }).devin_acu_remaining, 'ACU 187.5 / 200 left');
});

test('unavailable or invalid ACU readings fall back to whichever legacy quotas exist', () => {
  const invalidPlans = [
    {}, { acuLimit: 200 }, { acuConsumed: 1 }, { acuLimit: 200, acuConsumed: null },
    { acuLimit: -1, acuConsumed: 1 }, { acuLimit: 0, acuConsumed: 0 },
    { acuLimit: 200, acuConsumed: -1 }, { acuLimit: Infinity, acuConsumed: 1 },
    { acuLimit: 200, acuConsumed: NaN }, { acuLimit: 200, acuConsumed: '' },
    { acuLimit: 200, acuConsumed: ' ' }, { acuLimit: true, acuConsumed: false },
    { acuLimit: 200, acuConsumed: [] },
  ];
  for (const plan of invalidPlans) {
    assert.deepEqual(usageTokens({ ...plan, dailyQuotaRemainingPercent: 62 }), {
      devin_acu_remaining: null, devin_daily_limit: 'day 38%', devin_weekly_limit: null,
    });
  }
  assert.deepEqual(usageTokens({ weeklyQuotaRemainingPercent: 38 }), {
    devin_acu_remaining: null, devin_daily_limit: null, devin_weekly_limit: 'week 62%',
  });
  assert.deepEqual(usageTokens(null), {
    devin_acu_remaining: null, devin_daily_limit: null, devin_weekly_limit: null,
  });
});

test('ACU readings expire at the billing period end and reject an invalid end date', () => {
  const plan = { acuLimit: 200, acuConsumed: 50, planEnd: '2026-11-15T08:00:00Z', dailyQuotaRemainingPercent: 62 };
  assert.equal(usageTokens(plan, Date.parse(plan.planEnd) - 1).devin_acu_remaining, 'ACU 150 / 200 left');
  for (const planEnd of [plan.planEnd, 'invalid', '']) {
    assert.deepEqual(usageTokens({ ...plan, planEnd }, Date.parse(plan.planEnd)), {
      devin_acu_remaining: null, devin_daily_limit: 'day 38%', devin_weekly_limit: null,
    });
  }
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
  assert.deepEqual(usageTokens(plan), { devin_acu_remaining: null, devin_daily_limit: 'day 28%', devin_weekly_limit: 'week 51%' });
});

test('devin credentials and sessions paths use platform-specific locations', () => {
  assert.equal(
    devinCredentialsPath('win32', { APPDATA: 'C:\\Users\\jan\\AppData\\Roaming' }),
    'C:\\Users\\jan\\AppData\\Roaming\\Devin\\credentials.toml',
  );
  assert.equal(
    devinSessionsPath('win32', { APPDATA: 'C:\\Users\\jan\\AppData\\Roaming' }),
    'C:\\Users\\jan\\AppData\\Roaming\\Devin\\cli\\sessions.db',
  );
  assert.equal(
    devinCredentialsPath('linux', { XDG_DATA_HOME: '/home/jan/.data' }),
    '/home/jan/.data/devin/credentials.toml',
  );
  assert.equal(
    devinSessionsPath('darwin', { XDG_DATA_HOME: '/home/jan/.data' }),
    '/home/jan/.data/devin/cli/sessions.db',
  );
});

test('devin paths fall back to the home directory when APPDATA or XDG_DATA_HOME are unset', () => {
  assert.equal(
    devinCredentialsPath('win32', {}),
    path.win32.join(homedir(), 'AppData', 'Roaming', 'Devin', 'credentials.toml'),
  );
  assert.equal(
    devinSessionsPath('win32', {}),
    path.win32.join(homedir(), 'AppData', 'Roaming', 'Devin', 'cli', 'sessions.db'),
  );
  assert.equal(
    devinCredentialsPath('linux', {}),
    path.posix.join(homedir(), '.local', 'share', 'devin', 'credentials.toml'),
  );
});
