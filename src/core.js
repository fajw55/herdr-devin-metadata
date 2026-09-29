export function devinPanes(reply) {
  const panes = reply?.result?.panes ?? reply?.panes ?? [];
  return panes.filter(pane => String(pane.agent ?? '').toLowerCase() === 'devin' && (pane.pane_id ?? pane.id));
}

export function usageTokens(planStatus, now = Date.now()) {
  const format = (remainingRaw, resetRaw, label) => {
    if (remainingRaw == null) return null;
    const remaining = Number(remainingRaw);
    const reset = resetRaw == null ? null : Number(resetRaw);
    if (!Number.isFinite(remaining) || (reset != null && (!Number.isFinite(reset) || reset * 1000 <= now))) return null;
    return `${label} ${Math.round(100 - Math.max(0, Math.min(100, remaining)))}%`;
  };
  return {
    devin_daily_limit: format(planStatus?.dailyQuotaRemainingPercent, planStatus?.dailyQuotaResetAtUnix, 'day'),
    devin_weekly_limit: format(planStatus?.weeklyQuotaRemainingPercent, planStatus?.weeklyQuotaResetAtUnix, 'week'),
  };
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
