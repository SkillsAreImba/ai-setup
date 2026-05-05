---
name: plan
description: Read-only investigation that outputs a structured implementation plan for a feature or bug. Trigger when the user asks "how should we…", "plan X", or wants design before code. Skip if implementation is already underway or scope is trivial.
argument-hint: <feature or bug description>
---

**READ-ONLY. NO CODE CHANGES.**

## Procedure

1. Grep + read relevant files. Follow imports. Note existing patterns.
2. Identify constraints: conventions, consumers, what would break.
3. Bugs → trace root cause. Features → find the right insertion point.
4. Output the plan.

## Output

```
## Context
What exists, what's relevant.

## Problem / Goal
One paragraph.

## Proposed approach
Step-by-step. File paths, function names, data shapes.

## Risks & open questions
What could go wrong. What needs a decision before coding.

## Out of scope
What this plan does NOT change.
```

Every claim backed by file:line or grep result. If ambiguous, ask one focused question — don't plan around unknowns.
