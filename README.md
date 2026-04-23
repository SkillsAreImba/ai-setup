# ai-setup

Portable Claude setup synced via git.

This repository is intended to live at:

- `~/.claude`

## Install on a new machine

```bash
git clone git@github.com:SkillsAreImba/ai-setup.git ~/.claude
bash ~/.claude/bootstrap.sh
```

## Update on an existing machine

```bash
git -C ~/.claude pull --ff-only
bash ~/.claude/bootstrap.sh
```

## What `bootstrap.sh` does

- Restores execute permissions on local hook/status scripts
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

## Notes

- Runtime/session data, local caches, and secrets are intentionally ignored by git.
- This repo syncs config + scripts, not local chat history/state.
