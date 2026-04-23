---
name: skill-ssot-audit
description: Scan SKILL.md for SSOT layout; Output must include skill-specific deliverable templates (or N/A). Use in any repo or on ~/.claude/skills.
argument-hint: [path-to-skills-dir|default .claude/skills]
---

## Persona

**Policy / consistency reviewer.** You do not rewrite skills unless the user asks. You run a **read-only** audit, list gaps, and suggest one-line fixes. You are neutral on content quality; you only check **structure** against the contract below.

## Input

| Input | Required | Notes |
|--------|----------|--------|
| **Target tree** | No (default) | If `$ARGUMENTS` is empty: audit **this repo’s** `.claude/skills/**/*.SKILL.md` (and `SKILL.md` at `.claude/` if present). If the user names a path, use that as the **root** to search recursively for `SKILL.md`. They may pass `~/.claude/skills` to audit the **global** install (no `gstack` pruning unless they ask). |
| **SSOT version** | Implicit | The checklist in **Steps** is the single source of truth for this audit. Project-specific content belongs in the skill, not here. |

## Steps (tools & methods)

1. **Resolve scope**  
   - Default: `find <repo>/.claude -name 'SKILL.md' -print` (or the platform equivalent).  
   - If a path is given, `find <that-path> -name 'SKILL.md'`.  
   - Sort paths for a stable report.

2. **Required top-level sections** (markdown `##` heading, case and wording flexible only as noted):  
   - `Persona` — who acts when this skill runs.  
   - `Input` — triggers, args, preconditions, tables or bullets allowed.  
   - `Steps (tools & methods)` **or** `## Steps` — the procedure (numbered subsections ok).  
   - `Output` — **artifacts and skill-specific deliverable expectations** (see item 2b).  
   - `Definition of done` **or** `## Definition of Done` — checkable exit criteria.  

2b. **Output must include deliverable templates (skill-specific)**  
   Under `## Output` (or a subheading like `### Deliverable templates`), each skill should make clear **what the user gets** in a **copy-pasteable or repeatable** form. Templates are **not** one global shape: they **depend on the skill** (e.g. orchestration → session report + SHAs; ship/release → release checklist or comms draft; bugs → entry format; QA → before/after table). **Pass** if *any* of:  
   - a fenced **template** (markdown or plain) for the main deliverable(s);  
   - a small **table of deliverable → path or filename** the run produces;  
   - a **link** to a template file in-repo (e.g. `docs/templates/…`);  
   - explicit **“N/A — read-only / policy only”** with one line on what is produced instead (e.g. “advice in chat only”).  
   **Partial** if `Output` lists bullets but no template shape; **Fail** if there is no notion of what to hand off.

3. **Optional sections** (do **not** fail; flag as “nice to have” or “use when needed”):  
   - `Quality bar`, `Persistence (AFK)`, `Invariants`, `Config` (if the skill is config-driven), project pointers (“see `CLAUDE.md`”).

4. **Per-file checks**  
   - **Frontmatter:** YAML with at least `name:` and `description:`. (Warn if `argument-hint` is missing and the skill takes args.)  
   - **Unreadable `SKILL.md`:** if `ls` shows only a **symlink** to `~/.claude/skills/gstack/<name>/SKILL.md` but that target path does not exist (gstack is often a **monorepo** without per-skill subfolders), report **install / stub** — do not treat as “missing skill body” inside a real file. Suggest removing the stub dir, re-running upstream `setup`, or re-pointing the symlink.  
   - **Deliverable templates in Output:** apply **2b**; if the skill name implies heavy artifacts (`ship`, `land-and-deploy`, `claw`, `document-release`, `qa`, `bugs`, …) and templates are missing, mark **High** priority.  
   - **No duplicate competing SSOTs:** e.g. two different “do not stop” essays — suggest consolidating to one **Persistence** or **Operating mode** block.  
   - **Skim length:** if a file is huge with no `##` structure, note “consider splitting or SSOT headings.”

5. **Emit a report (markdown)**  
   - **Summary:** N files, M compliant, P gaps.  
   - **Table or list per file:** path → Pass / Partial → **Missing:** …, **Optional recommended:** …  
   - **Priority:** sort gaps: missing required section > frontmatter > optional polish.

## Output

### Deliverable (default)

- One **markdown audit** in the conversation, suitable for a PR or follow-up edits.  
- **No** edits to `SKILL.md` on disk unless the user explicitly asks to apply fixes.

### Deliverable template (this skill)

Use or adapt for each run; fill in the bracketed parts.

```markdown
# Skill SSOT audit — <scope or root path> — <date or session>

## Summary
- Scanned: **&lt;N&gt;** `SKILL.md` files
- Compliant: **&lt;M&gt;** — Partial: **&lt;P&gt;** — Failed: **&lt;F&gt;**

## Per file

| Path | SSOT sections | Output / templates (2b) | Notes / priority |
|------|---------------|---------------------------|------------------|
| `…/foo/SKILL.md` | Pass / Partial | Pass / Partial / N/A | … |

## Top fixes (ordered)
1. …
2. …
```

If the user asked for a file on disk, write the same structure to the path they gave.

## Definition of done

- [ ] Every `SKILL.md` under the chosen root was listed or the reason it was skipped (e.g. permission).  
- [ ] Each file was scored for **SSOT sections**, **2b (Output / deliverable templates)**, and **Optional** in **Steps**.  
- [ ] The report is ordered and actionable; gaps name **concrete** additions (e.g. “add a fenced report template under Output”).  
- [ ] The auditor’s own **Deliverable template** (above) was used or an equivalent was produced.  
- [ ] The auditor did not change disk unless asked.

## Invariants

- This skill **does not** change the global SSOT for other skills; it only **reflects** what is written in this file’s **Steps** until a human updates them.  
- Gstack- or plugin-owned skills: audit only if included in the user’s path; the report may label `gstack/**` or `plugins/**` as *upstream* in prose if the user asked for that distinction.
