export function devinPanes(reply) {
  const panes = reply?.result?.panes ?? reply?.panes ?? [];
  return panes.filter(pane => String(pane.agent ?? '').toLowerCase() === 'devin' && (pane.pane_id ?? pane.id));
}

export function usageTokens(planStatus, now = Date.now()) {
  const acu = acuRemainingToken(planStatus, now);
  const format = (remainingRaw, resetRaw, label) => {
    if (remainingRaw == null) return null;
    const remaining = Number(remainingRaw);
    const reset = resetRaw == null ? null : Number(resetRaw);
    if (!Number.isFinite(remaining) || (reset != null && (!Number.isFinite(reset) || reset * 1000 <= now))) return null;
    return `${label} ${Math.round(100 - Math.max(0, Math.min(100, remaining)))}%`;
  };
  return {
    devin_acu_remaining: acu,
    devin_daily_limit: acu == null ? format(planStatus?.dailyQuotaRemainingPercent, planStatus?.dailyQuotaResetAtUnix, 'day') : null,
    devin_weekly_limit: acu == null ? format(planStatus?.weeklyQuotaRemainingPercent, planStatus?.weeklyQuotaResetAtUnix, 'week') : null,
  };
}

function acuRemainingToken(planStatus, now) {
  const number = value => {
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return NaN;
    return Number(value);
  };
  const limit = number(planStatus?.acuLimit);
  const consumed = number(planStatus?.acuConsumed);
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(consumed) || consumed < 0) return null;
  if (planStatus.planEnd != null) {
    const end = typeof planStatus.planEnd === 'string' ? Date.parse(planStatus.planEnd) : NaN;
    if (!Number.isFinite(end) || end <= now) return null;
  }
  const remaining = Number(Math.max(0, limit - consumed).toFixed(1));
  return `ACU ${remaining} / ${limit} left`;
}

export function parseCredentials(text) {
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(api_server_url|windsurf_api_key)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/);
    if (!match) continue;
    fields[match[1]] = match[2][0] === '"' ? JSON.parse(match[2]) : match[2].slice(1, -1);
  }
  if (!fields.api_server_url || !fields.windsurf_api_key) throw new Error('Devin credentials are unavailable');
  const url = new URL(fields.api_server_url);
  if (url.protocol !== 'https:') throw new Error('Devin API URL must use HTTPS');
  return { apiServerUrl: url.toString().replace(/\/$/, ''), apiKey: fields.windsurf_api_key };
}
