#!/usr/bin/env bash
# fetch.sh — fetch URL as clean markdown via Jina Reader (r.jina.ai).
# Usage: fetch.sh <url> [--max-tokens N] [--raw]
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $(basename "$0") <url> [--max-tokens N] [--raw]" >&2
  exit 2
fi

URL="$1"; shift
MAX_CHARS=32000   # ~8k tokens @ 4 chars/token
RAW=0

while [ $# -gt 0 ]; do
  case "$1" in
    --max-tokens) MAX_CHARS=$(( $2 * 4 )); shift 2 ;;
    --max-chars)  MAX_CHARS="$2"; shift 2 ;;
    --raw)        RAW=1; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Jina Reader accepts the target URL appended to https://r.jina.ai/
# X-Return-Format: markdown gives cleaner output than default.
if [ "$RAW" -eq 1 ]; then
  curl -sSfL --max-time 30 \
    -H "Accept: text/plain" \
    -H "X-Return-Format: markdown" \
    "https://r.jina.ai/${URL}"
else
  curl -sSfL --max-time 30 \
    -H "Accept: text/plain" \
    -H "X-Return-Format: markdown" \
    "https://r.jina.ai/${URL}" \
    | head -c "$MAX_CHARS"
fi
