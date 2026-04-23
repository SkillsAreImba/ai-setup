# Portable setup for ~/.claude

This repo is designed so any machine can use the same stack from `~/.claude`.

## First install

```bash
git clone https://github.com/SkillsAreImba/ai-setup.git ~/.claude
bash ~/.claude/bootstrap.sh
```

## Daily update

```bash
git -C ~/.claude pull --ff-only
bash ~/.claude/bootstrap.sh
```

## Notes

- Runtime/private files are excluded by `.gitignore`.
- `skills/gstack/` is not versioned; it is installed/updated by `bootstrap.sh`.
- To skip gstack on a machine:

```bash
ENABLE_GSTACK=0 bash ~/.claude/bootstrap.sh
```

- To pin gstack to a specific ref temporarily:

```bash
GSTACK_REF=v1.1.2.0 bash ~/.claude/bootstrap.sh
```
