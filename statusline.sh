#!/usr/bin/env bash
# Claude Code statusline — model, dir, git branch, context usage
# Receives JSON on stdin: { session_id, transcript_path, cwd, model:{id,display_name}, workspace:{current_dir,project_dir}, version }

set -eu

input=$(cat)

model=$(printf '%s' "$input" | jq -r '.model.display_name // .model.id // "claude"')
cwd=$(printf '%s' "$input" | jq -r '.workspace.current_dir // .cwd // "."')
transcript=$(printf '%s' "$input" | jq -r '.transcript_path // ""')
version=$(printf '%s' "$input" | jq -r '.version // ""')

# Pretty dir: ~ for home, basename otherwise
case "$cwd" in
  "$HOME") dir="~" ;;
  "$HOME"/*) dir="~/${cwd#"$HOME"/}" ;;
  *) dir="$cwd" ;;
esac
# Shorten to last 2 segments if long
if [ "${#dir}" -gt 40 ]; then
  dir=".../$(basename "$(dirname "$cwd")")/$(basename "$cwd")"
fi

# Git branch (fast — no network)
branch=""
if git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
  branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null \
    || git -C "$cwd" rev-parse --short HEAD 2>/dev/null \
    || printf '')
  # Dirty marker
  if [ -n "$branch" ] && ! git -C "$cwd" diff --quiet --ignore-submodules HEAD 2>/dev/null; then
    branch="${branch}*"
  fi
fi

# Approximate context usage: lines in transcript (proxy — not exact tokens)
ctx=""
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  lines=$(wc -l < "$transcript" 2>/dev/null || printf 0)
  # Rough estimate: ~400 tokens per transcript entry line for mixed content
  est=$(( lines * 400 / 1000 ))
  ctx="${est}k"
fi

# ANSI colors
C_MODEL=$'\033[38;5;141m'   # purple
C_DIR=$'\033[38;5;117m'     # cyan
C_GIT=$'\033[38;5;150m'     # green
C_CTX=$'\033[38;5;245m'     # grey
C_SEP=$'\033[38;5;240m'     # dark grey
C_RST=$'\033[0m'

out="${C_MODEL}${model}${C_RST}"
out="${out} ${C_SEP}|${C_RST} ${C_DIR}${dir}${C_RST}"
[ -n "$branch" ] && out="${out} ${C_SEP}|${C_RST} ${C_GIT}${branch}${C_RST}"
[ -n "$ctx" ] && out="${out} ${C_SEP}|${C_RST} ${C_CTX}~${ctx}${C_RST}"
[ -n "$version" ] && out="${out} ${C_SEP}v${version}${C_RST}"

printf '%s' "$out"
