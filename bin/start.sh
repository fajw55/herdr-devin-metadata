#!/bin/sh
set -eu

# GUI-launched Herdr may not inherit the user's interactive shell PATH.
PATH="${HERDR_DEVIN_EXTRA_PATH:+${HERDR_DEVIN_EXTRA_PATH}:}${PATH:-/usr/bin:/bin}:/opt/homebrew/bin:/usr/local/bin"
if [ -n "${HOME:-}" ]; then
  PATH="$PATH:$HOME/.local/share/mise/shims:$HOME/.local/bin"
fi
export PATH

if command -v node >/dev/null 2>&1; then
  exec node src/launch.js
fi

if [ -n "${SHELL:-}" ] && [ -x "$SHELL" ]; then
  node_path=$("$SHELL" -lic 'command -v node' 2>/dev/null | tail -n 1) || true
  if [ -n "$node_path" ] && [ -x "$node_path" ]; then
    exec "$node_path" src/launch.js
  fi
fi

printf '%s\n' 'herdr-devin-metadata needs Node.js 24 or newer in PATH' >&2
exit 127
