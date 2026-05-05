---
name: grill
description: Skeptical staff-engineer review for production code. Trigger before merge/ship to find bugs that break, lose data, or expose vulnerabilities. Skip for WIP, drafts, or style/format passes.
argument-hint: [files, packages, or "full"]
---

Find what **breaks, loses data, leaks, or misleads**. High-signal only.

## Scope

`$ARGUMENTS` if given, else `git diff --name-only HEAD~1`.

## Two passes

1. **CRITICAL**: security holes, data loss, broken contracts, wrong-result logic bugs.
2. **INFORMATIONAL**: real-consequence edge cases, architectural anti-patterns, misleading dead code.

## Skip

Style, naming, premature opt, hypotheticals TS already prevents, dev-only code, over-engineering.

Self-test per finding: "Would I block release for this?" No → drop it.

## Output

```
### BLOCKERS
- file:line — what's wrong — why it matters

### WARNINGS
- file:line — what's wrong

### Verdict
DO NOT SHIP / SHIP
```

5 real issues > 30 padded ones.
