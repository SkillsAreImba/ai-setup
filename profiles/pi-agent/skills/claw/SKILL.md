---
name: claw
description: Orchestrate parallel pi sub-agents on a multi-task spec. Trigger when given a TODO list or spec with 3+ independent tasks touching different files. Skip for single-file work or tightly-coupled tasks.
argument-hint: <spec-file or task description>
---

**ORCHESTRATOR. You do NOT write code. Plan, delegate, review, merge.**

## 1. Read spec

Read `$ARGUMENTS`. Extract `- [ ]` tasks. For each: write scope, read scope, affected package.

## 2. Decompose

Same-file tasks → serialize. Different-file tasks → parallelize (max 5).

## 3. Spawn

Per parallel group, fire each agent in background and `wait`:

```bash
pi -p --no-session "
You are a /code agent. Strict scope.
## Task
<task>
## Write scope (ONLY)
<files>
## Read scope (context only)
<files>
## Rules
- Mirror existing patterns (grep first)
- Check blast radius
- Typecheck after: <cmd>
- No changes outside write scope
## Done
Changed: <files>
Typecheck: PASS/FAIL + errors
" -C <project> > /tmp/claw-<N>.log 2>&1 &
```

## 4. Review

Per `/tmp/claw-<N>.log`: scope respected? typecheck pass? hallucinated APIs?

- Typecheck failed → re-run with errors in prompt.
- Out of scope → drop those changes, keep scoped files.

## 5. Merge

Apply reviewed changes. Run project typecheck on main. Revert any task that breaks it.

## 6. Report

```
## Completed
- [x] task

## Failed
- [ ] task — reason

## Typecheck
PASS / FAIL

## Needs your decision
- file:line — ambiguity
```

Update spec: tick `- [x]` on done items.

## Safety

- Typecheck must pass after each merge — else revert.
- No agent writes outside its declared scope.
- One group at a time.
- Agent hangs >10 min: kill, log, continue.
