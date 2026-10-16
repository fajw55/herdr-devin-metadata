import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

async function checkWatcher(acu) {
  const root = await mkdtemp(join(tmpdir(), 'herdr-devin-worker-'));
  let child;
  try {
    const stateDir = join(root, 'state');
    const dataDir = join(root, 'devin');
    const dbPath = join(dataDir, 'sessions.db');
    const credentialsPath = join(root, 'credentials.toml');
    const reportPath = join(root, 'report.json');
    const fetchMarker = join(root, 'fetch-count');
    await mkdir(join(stateDir, 'servers'), { recursive: true });
    await mkdir(dataDir);
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT NOT NULL)');
    db.prepare('INSERT INTO sessions (id, model) VALUES (?, ?)').run('session-one', 'adaptive');
    db.close();
    await writeFile(credentialsPath, 'api_server_url = "https://example.test"\nwindsurf_api_key = "test-secret"\n');
    await writeFile(join(stateDir, 'servers', 'server.json'), JSON.stringify({ socket: 'test-socket', bin: join(root, 'fake-herdr') }));
    await writeFile(join(root, 'mock-fetch.mjs'), `import { writeFileSync } from 'node:fs';
globalThis.fetch = async () => {
  writeFileSync(process.env.TEST_FETCH_MARKER, '1');
  return { ok: true, json: async () => ({ userStatus: { planStatus: {
    ${acu ? "acuLimit: 200, acuConsumed: 0.809125, planEnd: '2033-05-18T03:33:20Z'," : ''}
    dailyQuotaRemainingPercent: 62, weeklyQuotaRemainingPercent: 38,
    dailyQuotaResetAtUnix: 2000000000, weeklyQuotaResetAtUnix: 2000000000,
  } } }) };
};
`);
    await writeFile(join(root, 'fake-herdr'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'pane' && args[1] === 'list') console.log(JSON.stringify({result:{panes:[{pane_id:'p1',agent:'devin',agent_session:{kind:'id',value:'session-one'}}]}}));
else if (args[0] === 'plugin') console.log(JSON.stringify({result:{plugins:[{plugin_id:'herdr-devin-metadata',enabled:true}]}}));
else if (args[0] === 'pane' && args[1] === 'report-metadata') {fs.writeFileSync(process.env.TEST_REPORT_PATH,JSON.stringify(args));console.log('{}');}
else process.exit(1);
`);
    await chmod(join(root, 'fake-herdr'), 0o755);
    child = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'worker.js')], {
      env: { ...process.env, HERDR_PLUGIN_STATE_DIR: stateDir, DEVIN_SESSIONS_DB: dbPath,
        DEVIN_CREDENTIALS_PATH: credentialsPath, TEST_REPORT_PATH: reportPath,
        TEST_FETCH_MARKER: fetchMarker, NODE_OPTIONS: `--import=${join(root, 'mock-fetch.mjs')}` },
      stdio: 'ignore',
    });
    let args;
    for (let i = 0; i < 50; i++) {
      try { args = JSON.parse(await readFile(reportPath, 'utf8')); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(args, 'expected a Herdr metadata report');
    assert.ok(args.includes('devin_model=adaptive'));
    if (acu) {
      assert.ok(args.includes('devin_acu_remaining=ACU 199.2 / 200 left'));
      assert.ok(!args.some(arg => arg.startsWith('devin_daily_limit=')));
      assert.ok(!args.some(arg => arg.startsWith('devin_weekly_limit=')));
    } else {
      assert.ok(args.includes('devin_daily_limit=day 38%'));
      assert.ok(args.includes('devin_weekly_limit=week 62%'));
    }
    assert.equal(await readFile(fetchMarker, 'utf8'), '1');
  } finally {
    child?.kill();
    await rm(root, { recursive: true, force: true });
  }
}

const windowsSkipReason = 'fake-herdr test fixture is a Unix shebang script executed via execFile with no shell; '
  + 'shell:true is not an acceptable workaround because Node concatenates array args unescaped on Windows (DEP0190)';

for (const acu of [false, true]) {
  test(
    `watcher reports model and shared ${acu ? 'ACU usage with priority over legacy quotas' : 'legacy quotas'} to a Devin pane`,
    { skip: process.platform === 'win32' ? windowsSkipReason : false },
    () => checkWatcher(acu),
  );
}
