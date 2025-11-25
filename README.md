# AI Setup

Global Claude + Gemini config for all projects.

## Setup

```bash
# Clone
git clone https://github.com/SkillsAreImba/ai-setup.git ~/ai-setup

# Symlink
ln -s ~/ai-setup/.claude ~/.claude
ln -s ~/ai-setup/.gemini ~/.gemini
```

## Sync

```bash
cd ~/ai-setup && git pull
```

## Structure

- `.claude/` - Claude Code config (persona, commands, permissions)
- `.gemini/` - Gemini config (context, prompts)

## Commands

- `/research <query>` - Delegate to Gemini (save tokens)
- `/coder` - Developer mode (pure implementation)
- `/adviser` - Strategic mode (brutal feedback)

## Identity

- **Rodolphe:** YOU (human) - Architect/PO/PM
- **Claude:** ME (AI) - Developer/Adviser/Designer
