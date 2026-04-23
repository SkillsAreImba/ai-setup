#!/usr/bin/env bash
# Safety check hook: blocks sloppy patterns that have already burned us.
# Reads tool input JSON from stdin, blocks with exit 2 + stderr msg if pattern matches.

set -euo pipefail

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""')

# Skip empty or non-shell commands
[ -z "$cmd" ] && exit 0

# Pattern 1: bare `&` backgrounding inside an ssh command (no nohup/setsid/disown)
# Catches: ssh host '... cmd &'  but allows: ssh host '... nohup setsid cmd & disown'
if echo "$cmd" | grep -qE 'ssh[[:space:]]'; then
  # Extract the remote command portion (very rough)
  remote=$(echo "$cmd" | sed -E "s/^.*ssh[[:space:]]+[^[:space:]]*[[:space:]]+//; s/^['\"]//; s/['\"]$//")
  if echo "$remote" | grep -qE '[^&] &([^&]|$)'; then
    if ! echo "$remote" | grep -qE '(nohup|setsid)'; then
      echo "BLOCKED by safety-check: bare '&' over SSH detected." >&2
      echo "Remote backgrounded processes are owned by the SSH session and get SIGHUPed when the next ssh call runs." >&2
      echo "Use: ssh host 'nohup setsid CMD </dev/null >/tmp/LOG 2>&1 & disown'" >&2
      echo "This already broke ntfsresize once. Don't repeat it." >&2
      exit 2
    fi
  fi
fi

# Pattern 2: destructive disk ops without explicit confirmation marker
# Catches: ntfsresize -s, parted resizepart, mkfs, dd of=/dev, wipefs
# Allows if the command contains the marker --confirmed-by-user (we set this when user has explicitly OK'd)
if echo "$cmd" | grep -qE '\b(ntfsresize[[:space:]]+-s|parted[[:space:]]+.*resizepart|mkfs\.[a-z]+[[:space:]]+/dev|dd[[:space:]]+.*of=/dev/|wipefs[[:space:]]+/dev/|sgdisk[[:space:]]+(--zap|-Z))'; then
  if ! echo "$cmd" | grep -q 'CONFIRMED-BY-USER'; then
    echo "BLOCKED by safety-check: destructive disk operation without confirmation marker." >&2
    echo "Before running, state:" >&2
    echo "  1. State if interrupted mid-way" >&2
    echo "  2. Manual recovery cost" >&2
    echo "  3. Cross-OS dirty flag implications" >&2
    echo "Then ask the user for explicit confirmation, and add '# CONFIRMED-BY-USER' as a comment in the command." >&2
    exit 2
  fi
fi

# Pattern 3: bare `sleep` in commands that monitor remote processes (catches the rtk-swallow issue)
if echo "$cmd" | grep -qE '(^|;|&&|\|\|)[[:space:]]*sleep[[:space:]]+[0-9]+'; then
  echo "BLOCKED by safety-check: bare 'sleep' detected. rtk wrapper swallows it silently." >&2
  echo "Use: /usr/bin/sleep <seconds>" >&2
  exit 2
fi

exit 0
