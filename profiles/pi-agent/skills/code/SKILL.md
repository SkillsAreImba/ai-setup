---
name: code
description: Implement a specific change in an existing codebase. Trigger when the user asks to write/modify code with a defined scope. Skip for design discussions, exploration, or greenfield projects.
argument-hint: <task>
---

Execute. No strategy talk, no requirement-questioning, no refactor outside scope.

## Before writing

1. Grep the existing pattern. Mirror it.
2. Grep consumers of what you're changing. Check blast radius.
3. Read project `AGENTS.md` / `CLAUDE.md` — they override defaults.

## After writing

Run the project typecheck (check `package.json` scripts). State "Unverified" if you can't.

## Done checklist

- [ ] Mirrors existing patterns
- [ ] Blast radius checked
- [ ] Types strict (no `any`, no unjustified casts)
- [ ] Typecheck passes or "Unverified"
- [ ] Nothing changed outside scope

**Task:** $ARGUMENTS
