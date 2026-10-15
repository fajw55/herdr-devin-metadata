# herdr-devin-metadata

Shows Devin CLI's session model and account usage in Herdr's Agent sidebar. The plugin reports metadata to the existing sidebar and opens no extra pane.

> **Personal-use notice:** This plugin was vibe coded for my own use. It may have rough edges. I do not plan to provide support or fix issues that do not affect my own use.
>
> **Platform support:** macOS and Linux only. Tested only on macOS; Linux has not been tested.

## Requirements

- Herdr 0.9 or newer
- Node.js 24 or newer on the machine running Herdr
- Devin CLI signed in on that machine
- Herdr's Devin integration for per-pane session IDs (`herdr integration install devin`)

## Install

```sh
herdr plugin install fajw55/herdr-devin-metadata
```

## Sidebar layout

Add this Devin-specific layout to `~/.config/herdr/config.toml` (or adjust it to your needs):

```toml
[ui.sidebar.agents.rows_by_agent]
devin = [
  ["state_icon", "machine", "workspace", "tab"],
  ["agent", "$devin_model", "$devin_effort"],
  ["$devin_acu_remaining", "$devin_daily_limit", "$devin_weekly_limit"],
]
```

If the table already exists, add only the `devin = [...]` entry. This override replaces the complete default Agent layout for Devin, so include any built-in tokens you want to keep. Reload Herdr's config to apply it. Restart the Herdr server after installing or linking so the startup hook runs for existing panes; newly detected Devin panes trigger the plugin automatically.

The plugin reports `devin_model`, `devin_acu_remaining`, `devin_daily_limit`, and `devin_weekly_limit`. ACU takes priority when a valid allowance and consumption reading are available; daily and weekly tokens are cleared. Otherwise, whichever daily and weekly readings are available appear. Include all three usage tokens in your layout to support both account types. The `devin_effort` token is reserved but currently empty because Devin CLI does not expose a reliable per-session effort value. Missing tokens and their separators disappear automatically. If Herdr detects a Devin pane without a session reference, account usage can still appear while the model remains blank.

## How it works

The plugin starts one watcher per machine only while Herdr has a Devin pane. It checks panes every 10 seconds, reads each pane's model from Devin's local `sessions.db`, and makes one shared account quota request at most once per minute. It reports remaining ACU, such as `ACU 199.2 / 200 left`, rounded to one decimal place. The allowance comes from the account response and is not fixed at 200. Accounts without valid ACU readings fall back to **consumed** daily and weekly percentages, such as `day 38% · week 62%`. The quota request uses Devin CLI's existing credentials in memory; the key is not stored or logged by this plugin.

If quota cannot be refreshed, the last successful reading expires after three minutes or at the quota window's reset time, whichever comes first. ACU readings also expire at the account's billing period end when provided. The watcher stops when no Devin panes remain. No account request runs while there are no Devin panes.

## Develop

```sh
npm test
```

There are no package dependencies or build step. The launcher searches common Node.js locations if Herdr starts with a limited GUI PATH. Set `HERDR_DEVIN_EXTRA_PATH` in Herdr's environment if Node.js is elsewhere.

The plugin stores only a server registry and process lock in `HERDR_PLUGIN_STATE_DIR`, outside the source directory. It has no dedicated log file; inspect Herdr's records with `herdr plugin log list --plugin herdr-devin-metadata`.

## License

[0BSD](LICENSE).
