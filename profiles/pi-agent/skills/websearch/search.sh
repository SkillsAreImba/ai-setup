#!/usr/bin/env bash
# search.sh — query the local SearXNG instance, return top N results as JSON.
# Usage: search.sh "query" [--n N] [--engines eng1,eng2]
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $(basename "$0") \"query\" [--n N] [--engines eng1,eng2]" >&2
  exit 2
fi

QUERY="$1"; shift
N=5
ENGINES=""

while [ $# -gt 0 ]; do
  case "$1" in
    --n) N="$2"; shift 2 ;;
    --engines) ENGINES="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

ENCODED=$(printf '%s' "$QUERY" | jq -sRr @uri)
URL="http://localhost:8888/search?q=${ENCODED}&format=json"
[ -n "$ENGINES" ] && URL="${URL}&engines=${ENGINES}"

curl -sSfL --max-time 15 "$URL" \
  | jq --argjson n "$N" '.results[:$n] | map({title, url, content})'
