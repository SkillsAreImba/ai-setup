# ai-setup

Portable SSOT setup synced via git.

This repository is intended to live at:

- `~/.claude`

## Install on a new machine

```bash
git clone git@github.com:SkillsAreImba/ai-setup.git ~/.claude
git -C ~/.claude config core.hooksPath .githooks
bash ~/.claude/bootstrap.sh
```

After this one-time setup, every `git pull` that creates a merge will auto-run bootstrap through `.githooks/post-merge`.

## Ongoing update on machine 2

```bash
git -C ~/.claude pull --ff-only
```

## What `bootstrap.sh` does

- Restores execute permissions on local hook/status scripts
- Syncs `~/.claude/profiles/pi-agent` -> `~/.pi/agent` (idempotent, no symlink)
- Installs or updates `gstack` in `~/.claude/skills/gstack`
- Runs gstack setup if available

## Optional flags

Skip gstack install/update:

```bash
ENABLE_GSTACK=0 bash ~/.claude/bootstrap.sh
```

Pin gstack to a specific ref:

```bash
GSTACK_REF=v1.1.2.0 bash ~/.claude/bootstrap.sh
```

Use a custom gstack repo:

```bash
GSTACK_REPO=https://github.com/<org>/<repo>.git bash ~/.claude/bootstrap.sh
```

Skip `~/.pi/agent` profile sync:

```bash
ENABLE_PI_AGENT_SYNC=0 bash ~/.claude/bootstrap.sh
```

## SSOT workflow (2 Linux computers)

On your SSOT computer (this one):

1. Edit files in `~/.claude` (and `~/.claude/profiles/pi-agent` when needed)
2. Commit + push

On second computer:

```bash
git -C ~/.claude pull --ff-only
```

That keeps both `~/.claude` and `~/.pi/agent` aligned from one source of truth for tracked files.

## Secrets are not in git (public repo)

`.env` and keys are intentionally ignored, so copy them over LAN SSH from SSOT when needed:

```bash
rsync -avz -e ssh ~/.pi/agent/.env user@second-host:~/.pi/agent/.env
```

Repeat this after secrets change on SSOT.

A reusable template is included at:

- `scripts/sync-secrets-to-second.sh.example`

## Notes

- Runtime/session data, local caches, and secrets are intentionally ignored by git.
- This repo syncs config + scripts, not local chat history/state.
