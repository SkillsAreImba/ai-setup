#!/usr/bin/env bash
set -euo pipefail

# Portable bootstrap for ~/.claude on any machine.
# Safe to re-run after clone/pull.

CLAUDE_DIR="${HOME}/.claude"
PI_AGENT_SOURCE_DIR="${CLAUDE_DIR}/profiles/pi-agent"
PI_AGENT_TARGET_DIR="${HOME}/.pi/agent"
GSTACK_DIR="${CLAUDE_DIR}/skills/gstack"
GSTACK_REPO="${GSTACK_REPO:-https://github.com/garrytan/gstack.git}"
GSTACK_REF="${GSTACK_REF:-main}" # Can be a tag, branch, or commit.
ENABLE_GSTACK="${ENABLE_GSTACK:-1}" # Set to 0 to skip.
ENABLE_PI_AGENT_SYNC="${ENABLE_PI_AGENT_SYNC:-1}" # Set to 0 to skip.

log() {
  printf '[bootstrap] %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "Missing required command: $1"
    exit 1
  fi
}

ensure_claude_dir() {
  if [[ ! -d "${CLAUDE_DIR}" ]]; then
    log "Expected ${CLAUDE_DIR} to exist."
    exit 1
  fi
}

restore_exec_bits() {
  local paths=(
    "${CLAUDE_DIR}/statusline.sh"
    "${CLAUDE_DIR}/hooks/rtk-rewrite.sh"
    "${CLAUDE_DIR}/hooks/safety-check.sh"
  )

  for p in "${paths[@]}"; do
    if [[ -f "${p}" ]]; then
      chmod +x "${p}" || true
    fi
  done
}

sync_gstack() {
  if [[ "${ENABLE_GSTACK}" != "1" ]]; then
    log "Skipping gstack (ENABLE_GSTACK=${ENABLE_GSTACK})."
    return 0
  fi

  require_cmd git

  if [[ ! -d "${GSTACK_DIR}/.git" ]]; then
    log "Installing gstack into ${GSTACK_DIR}"
    mkdir -p "${CLAUDE_DIR}/skills"
    git clone --single-branch --depth 1 "${GSTACK_REPO}" "${GSTACK_DIR}"
  else
    log "Updating gstack in ${GSTACK_DIR}"
    git -C "${GSTACK_DIR}" fetch --depth 1 origin "${GSTACK_REF}"
    git -C "${GSTACK_DIR}" checkout -q "${GSTACK_REF}"
    git -C "${GSTACK_DIR}" pull --ff-only --depth 1 origin "${GSTACK_REF}" || true
  fi

  if [[ -x "${GSTACK_DIR}/setup" ]]; then
    log "Running gstack setup"
    "${GSTACK_DIR}/setup"
  else
    log "gstack setup script not executable; skipping setup."
  fi
}

sync_pi_agent_profile() {
  if [[ "${ENABLE_PI_AGENT_SYNC}" != "1" ]]; then
    log "Skipping pi-agent profile sync (ENABLE_PI_AGENT_SYNC=${ENABLE_PI_AGENT_SYNC})."
    return 0
  fi

  if [[ ! -d "${PI_AGENT_SOURCE_DIR}" ]]; then
    log "No pi-agent profile at ${PI_AGENT_SOURCE_DIR}; skipping."
    return 0
  fi

  mkdir -p "${PI_AGENT_TARGET_DIR}"

  if command -v rsync >/dev/null 2>&1; then
    log "Syncing pi-agent profile to ${PI_AGENT_TARGET_DIR} via rsync"
    rsync -a --delete \
      --exclude '.git/' \
      --exclude '.DS_Store' \
      --exclude '__pycache__/' \
      "${PI_AGENT_SOURCE_DIR}/" "${PI_AGENT_TARGET_DIR}/"
  else
    log "rsync not found; falling back to cp (no delete sync)"
    cp -a "${PI_AGENT_SOURCE_DIR}/." "${PI_AGENT_TARGET_DIR}/"
  fi
}

main() {
  ensure_claude_dir
  restore_exec_bits
  sync_pi_agent_profile
  sync_gstack
  log "Done."
}

main "$@"
