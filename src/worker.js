import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { devinPanes, usageTokens } from './core.js';
import { fetchPlanStatus, readDevinCredentials, readSessionModel } from './devin.js';
import { callHerdr, listPanes, reportTokens } from './herdr.js';

const stateDir = process.env.HERDR_PLUGIN_STATE_DIR;
if (!stateDir) process.exit(0);
const registry = join(stateDir, 'servers');
const lock = join(stateDir, 'worker.lock');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await mkdir(lock);
      await writeFile(join(lock, 'pid'), String(process.pid));
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner = 0;
      try { owner = Number(await readFile(join(lock, 'pid'), 'utf8')); } catch { /* not written yet */ }
      if (owner > 0) {
        try { process.kill(owner, 0); return false; } catch (checkError) {
          if (checkError.code !== 'ESRCH') return false;
        }
      } else if (Date.now() - (await stat(lock)).mtimeMs < 5000) {
        return false;
      }
      await rm(lock, { recursive: true, force: true });
    }
  }
  return false;
}

function changed(previous, desired, now) {
  const patch = {};
  for (const [key, value] of Object.entries(desired)) {
    if (previous?.values?.[key] !== value || now - (previous?.writtenAt ?? 0) > 40000) {
      if (value !== null || previous?.values?.[key] != null) patch[key] = value;
    }
  }
  return patch;
}

async function main() {
  if (!(await acquireLock())) return;
  const reports = new Map();
  let quota = null;
  let quotaTime = 0;
  let lastFetch = 0;
  let lastPluginCheck = 0;
  try {
    while (true) {
      const now = Date.now();
      let files;
      try { files = (await readdir(registry)).filter(name => name.endsWith('.json')); }
      catch { files = []; }
      const active = [];
      for (const name of files) {
        const file = join(registry, name);
        let server;
        try { server = JSON.parse(await readFile(file, 'utf8')); } catch { continue; }
        try {
          const panes = devinPanes(await listPanes(server.bin, server.socket));
          if (panes.length) active.push({ ...server, panes });
          else await rm(file, { force: true });
        } catch {
          await rm(file, { force: true });
        }
      }
      if (!active.length) break;

      if (now - lastPluginCheck >= 60000) {
        lastPluginCheck = now;
        try {
          const reply = await callHerdr(active[0].bin, active[0].socket, ['plugin', 'list', '--json']);
          const plugin = reply?.result?.plugins?.find(item => item.plugin_id === 'herdr-devin-metadata');
          if (plugin && !plugin.enabled) break;
        } catch { /* transient Herdr error */ }
      }

      if (now - lastFetch >= 60000) {
        lastFetch = now;
        try {
          quota = await fetchPlanStatus(await readDevinCredentials());
          quotaTime = Date.now();
        } catch { /* offline, unavailable, or signed out */ }
      }
      const limits = usageTokens(now - quotaTime <= 180000 ? quota : null, now);
      for (const server of active) {
        for (const pane of server.panes) {
          const paneId = pane.pane_id ?? pane.id;
          const key = `${server.socket}:${paneId}`;
          const ref = pane.agent_session;
          const model = ref?.kind === 'id' ? readSessionModel(ref.value) : null;
          const desired = { devin_model: model, devin_effort: null, ...limits };
          const patch = changed(reports.get(key), desired, now);
          if (!Object.keys(patch).length) continue;
          try {
            await reportTokens(server.bin, server.socket, paneId, patch, 70000);
            reports.set(key, { values: desired, writtenAt: now });
          } catch { /* pane may have exited */ }
        }
      }
      await sleep(10000);
    }
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

main().catch(error => console.error(`Devin metadata watcher stopped: ${error.message}`));
