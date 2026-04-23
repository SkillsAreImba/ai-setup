---
name: bugs
description: |
  ONE central bug tracker across Rodolphe's 4 repos (gontrand, obsivault,
  moolti, dndev). User pastes a symptom — doesn't need to know which repo.
  An investigator agent finds the repo + root cause + proposed fix, updates
  the entry. Then `/claw` executes the fix.

  Use when the user says "bug", "bugs", "log this bug", "what's broken",
  "find the root cause", "who owns this bug", or pastes a console error /
  stack trace / symptom description.

  Subcommands:
    /bugs add <paste>         → append entry with symptom (no classification required)
    /bugs investigate [#N]    → spawn investigator agent; updates entry with repo + root cause + fix plan
    /bugs list                → show all entries + status
    /bugs fix [#N]            → execute the proposed fix via /claw (after investigate)
    /bugs close <#N> [reason] → mark fixed / wontfix / duplicate

  Single source of truth: `/data/obsivault/BUGS.md`.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---

## Persona

**Bug triage orchestrator** — `BUGS.md` SSOT; read-only investigate; `/claw` runs fixes.

## Input

| Input | Required | Notes |
|--------|----------|--------|
| **Subcommand** | Yes | `/bugs add`, `/bugs investigate`, `/bugs list`, `/bugs fix`, `/bugs close` (see **Steps**). |
| **Symptom / paste** | For `add` | Verbatim user text, console output, stack trace, or screenshot description. |
| **Bug id `#N`** | Optional on `investigate`, `fix`, `close` | Default: top open matching status (see **Steps**). |
| **SSOT file** | Implicit | `/data/obsivault/BUGS.md` — git-tracked, human-readable. |

**Repos in scope for investigation** (investigator must consider all four; no pre-filtering):

- `/data/ws/gontrand` — Bun + Hono server, React PWA  
- `/data/obsivault` — vault scripts under `_pi-brain/`  
- `/data/ws/moolti` — mini-tools monorepo  
- `/data/ws/dndev` — DoNotDev framework  

## Steps (tools & methods)

### End-to-end flow (reference)

```
USER pastes symptom
       │
       ▼
/bugs add → entry #N, status=new
       │
       ▼
/bugs investigate #N  (or the user just says "go")
       │
       ▼
INVESTIGATOR AGENT (spawned by this skill)
  - reads the symptom
  - greps across all 4 repos: /data/ws/gontrand, /data/obsivault, /data/ws/moolti, /data/ws/dndev
  - runs relevant tests / starts local servers / queries DB if needed
  - identifies the owner repo + file:line + root cause
  - writes back: Investigation + Proposed fix + Severity + Repo
  - status → diagnosed
       │
       ▼
USER reviews the diagnosis, says "go"
       │
       ▼
/bugs fix #N
  - builds a CLAW_TODO entry (scoped, one task)
  - invokes /claw with that TODO
  - on success: status → fixed, SHA logged
  - on failure: status → investigating (re-spawn with error context)
```

### `/bugs add <paste>`

1. Read `/data/obsivault/BUGS.md`; determine `N` = highest existing `#` + 1.
2. Append a new bug section using the **Bug entry** template in **Output** → **Deliverable templates**.
3. Set `Reported` = now; `Status` = `new`; **Symptom** = verbatim paste.
4. Stub all other fields with `(pending investigation)` where applicable.
5. On commit: ask the user; stage **only** `BUGS.md` (`git add` that path — no `git add -A`).
6. Suggest: `Run /bugs investigate #N now?`

### `/bugs investigate [#N]`

1. If no `#N`, select the top open entry with `status=new`.
2. Spawn a **single Agent** with the symptom text from `BUGS.md` and the **Investigator system prompt** below (substitute the symptom verbatim where indicated).
3. On agent completion: parse the structured report (see **Investigator return format** in **Output**).
4. Update Bug `#N`: Investigation, Proposed fix, Severity, Repo, File:line; set `Status` → `diagnosed`.
5. Print the diagnosis; ask whether to run `/bugs fix #N`.

**Investigator system prompt** (embed verbatim; replace `SYMPTOM` placeholder):

```
You are the bug investigator. One job: find the root cause of this symptom.

REPOS IN SCOPE (investigate all 4, don't pre-filter):
  - /data/ws/gontrand  (Bun + Hono server, React PWA)
  - /data/obsivault    (vault scripts under _pi-brain/)
  - /data/ws/moolti    (mini-tools monorepo)
  - /data/ws/dndev     (DoNotDev framework)

SYMPTOM:
<verbatim paste from BUGS.md>

YOUR JOB:
1. Understand the symptom. If it mentions a URL, a console message, a file
   path, a page name, use that as your entry point.
2. Grep across all 4 repos for matching keywords. Trace the error to source.
3. If it's runtime, reproduce: start the server, curl the endpoint, read
   journalctl, inspect the DB, whatever is needed.
4. Identify the owner repo + file:line + root cause.
5. Propose a concrete fix: files to edit, behavior change, tests to add,
   estimated LOC, estimated time.
6. Set severity: CRIT (prod-down) / HIGH (blocks workflow) / MED (annoying) /
   LOW (cosmetic).

DO NOT edit any code. DO NOT commit. DO NOT invoke /claw. You are read-only.

Return your findings as a structured report:
  Repo: <one of the 4>
  File: <path:line>
  Severity: <CRIT/HIGH/MED/LOW>
  Root cause: <1-3 sentences>
  Proposed fix: <bullet list of files + changes>
  Estimated time: <15m / 1h / 4h>
  Verification: <how to confirm the fix worked>
  Blast radius: <what else might break>
```

### `/bugs list`

1. Read `/data/obsivault/BUGS.md`.
2. Emit a table-of-contents style listing: `N | title | status | severity | repo`.
3. Sort: open first (`new` / `investigating` / `diagnosed` / `fixing`), then closed; within each bucket, severity descending.

### `/bugs fix [#N]`

1. If no `#N`, select the top entry with `status=diagnosed`.
2. Read **Proposed fix**; build a one-task `CLAW_TODO` in the owner repo.
3. Set `Status` → `fixing`.
4. Invoke `/claw` with that TODO.
5. On success: `Status` → `fixed`; append **Fix log** with SHA; commit `BUGS.md` (scoped add only).
6. On failure: `Status` → `investigating`; append failure context; suggest re-investigation.

### `/bugs close <#N> [reason]`

1. Set `Status` to `fixed`, `wontfix`, or `duplicate` as directed.
2. Append reason to **Fix log**; commit `BUGS.md` with scoped staging only.

**Entry lifecycle:** Entries are **never deleted** — closed rows remain for audit.

## Output

- **Primary artifact:** Updates to `/data/obsivault/BUGS.md` (append or in-place section edits).
- **User-visible:** Diagnosis summary after investigate; list rows after `list`; optional next-step prompts (`/bugs fix`, re-investigate).
- **Git:** Commits should include only `BUGS.md` unless the user explicitly expands scope.

### Deliverable templates

**Bug entry** (each bug is one `##` section; `N` increments monotonically):

```md
## Bug #N — <one-line title>

**Reported:** <YYYY-MM-DD HH:MM>
**Status:** new | investigating | diagnosed | fixing | fixed | wontfix | duplicate
**Severity:** CRIT | HIGH | MED | LOW  (set by investigator, not user)
**Repo:** (set by investigator) | unknown
**File:line:** (set by investigator)

### Symptom (what the user pasted)

<verbatim paste of what the user said / screenshotted / copied>

### Investigation (filled by investigator agent)

<diagnosis: what's actually broken + why. Includes file:line, reproduction
steps, blast radius.>

### Proposed fix (filled by investigator)

<concrete change. Which files to edit. What the new behavior is. Tests
that must pass. Estimated time.>

### Fix log (filled on /bugs fix)

<SHA after /claw lands it. Notes on what was actually done vs. proposed.>

---
```

**Investigator return format** (parse from agent reply into the sections above):

```text
Repo: <one of the 4 | unknown>
File: <path:line>
Severity: CRIT | HIGH | MED | LOW
Root cause: <1-3 sentences>
Proposed fix:
- <file / change>
Estimated time: <15m | 1h | 4h>
Verification: <how to confirm>
Blast radius: <what else might break>
```

**`/bugs list` row** (one line per bug, machine-friendly):

```text
#N | <title> | <status> | <severity> | <repo>
```

## Definition of done

- **`/bugs add`:** New `## Bug #N` exists with verbatim symptom, `status=new`, stubs elsewhere; user offered investigate; commit policy respected if committing.
- **`/bugs investigate`:** Agent ran read-only; `BUGS.md` updated with Investigation + Proposed fix + Severity + Repo + File:line; `status=diagnosed`; user prompted for `/bugs fix` unless they decline.
- **`/bugs list`:** Sorted listing emitted with N, title, status, severity, repo for every tracked bug.
- **`/bugs fix`:** `CLAW_TODO` scoped to owner repo; `/claw` invoked; terminal state is `fixed` + SHA in Fix log **or** explicit failure path with `investigating` and notes.
- **`/bugs close`:** Status and Fix log reflect closure reason; no entry deletion.
- **Global:** No investigator edits to product code; no auto-fix from `add`; unknown repo is `unknown`, not guessed (see **Invariants**).

## Invariants

- **Never pre-classify.** User pastes; investigator classifies.
- **Never auto-fix from /bugs add.** Investigation is its own step — user reviews before fix.
- **Never delete entries.** Status transitions only.
- **BUGS.md commits are staged with just the file.** No `git add -A`.
- **Investigator is read-only.** Any edits happen only during `/bugs fix` via `/claw`.
- **`/clear`-proof:** BUGS.md is in git. A new session reads it and `/bugs list` shows the landscape.

## Notes

- Complementary skills: `/qa` (heavyweight per-app QA with browser) and `/claw` (parallel-agent fixer given a TODO). `/bugs` is triage + investigation; `/claw` executes the fix.
- If the investigator cannot identify the owner repo, set `Repo: unknown` and surface that to the user — do not guess.
