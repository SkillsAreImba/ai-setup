# PR: Project setting to ignore global context

## Problem

Small/local-model projects need Pi's global tooling but not global prompt context. Today the only built-in options are too broad:

- `--no-context-files` disables all `AGENTS.md` / `CLAUDE.md`, including project-local context.
- `--no-skills` disables all skills, including project-local skills.
- Extensions can strip prompt text late, but resources are already loaded, shown in startup, and available as slash skill commands.

Use case: a standalone local product repo wants to run plain `pi` with only repo-local instructions/skills while keeping global extensions/tools/auth/model config.

## Proposed setting

Add a project-only setting:

```json
{
  "ignoreGlobalContext": true
}
```

Location:

```text
<project>/.pi/settings.json
```

This setting should be honored only from project settings, not from `~/.pi/agent/settings.json`, to avoid accidentally changing all repositories.

## Semantics

When `ignoreGlobalContext` is absent or false:

- Existing behavior unchanged.

When `ignoreGlobalContext` is true:

Keep:

- Global extensions and their tools/commands/flags.
- Global auth/model/runtime settings needed to run Pi.
- Project-local `.pi` config/resources.
- Context files inside the current git repo.
- Skills inside the current git repo.

Ignore:

- `~/.pi/agent/AGENTS.md`
- `~/.pi/agent/CLAUDE.md`
- ancestor `AGENTS.md` / `CLAUDE.md` outside the current git repo
- global/user skills from `~/.pi/agent/skills`
- configured skill paths outside the current git repo
- global `SYSTEM.md`
- global `APPEND_SYSTEM.md`

Optional but consistent:

- Global prompt templates can remain available as commands, because they are explicit user actions, not automatic prompt context.
- Global themes can remain loaded, because they are UI-only.

## Implementation sketch

Files likely involved:

- `packages/coding-agent/src/core/settings-manager.ts`
- `packages/coding-agent/src/core/resource-loader.ts`
- `packages/coding-agent/docs/settings.md`
- `packages/coding-agent/docs/usage.md`
- `packages/coding-agent/test/resource-loader.test.ts`

### 1. Settings type

Add to `Settings`:

```ts
ignoreGlobalContext?: boolean;
```

Use project settings only:

```ts
const ignoreGlobalContext = this.settingsManager.getProjectSettings().ignoreGlobalContext === true;
```

### 2. Context discovery

Extend context loading to support repo-bounded discovery:

```ts
loadProjectContextFiles({ cwd, agentDir, ignoreGlobalContext })
```

If false: current behavior.

If true:

- do not load from `agentDir`
- find git root from `cwd`
- walk from `cwd` up to git root only
- do not walk above git root
- if no git root, use `cwd` only or cwd ancestry until filesystem root? Safer: cwd only.

### 3. Skills

During resource loading, filter skills when `ignoreGlobalContext` is true:

```ts
skills = skills.filter(skill => isUnderRepoRoot(skill.filePath, cwd));
```

This should apply before:

- system prompt construction
- `/skill:name` command registration
- startup resource listing

### 4. System prompt files

When `ignoreGlobalContext` is true:

- `discoverSystemPromptFile()` should only check project `.pi/SYSTEM.md`
- `discoverAppendSystemPromptFile()` should only check project `.pi/APPEND_SYSTEM.md`

Do not fall back to global `~/.pi/agent/SYSTEM.md` or `APPEND_SYSTEM.md`.

### 5. Extensions unaffected

Do not alter extension discovery/loading.

Rationale: this setting is about automatic LLM-facing context, not user tooling.

## Tests

Add/extend resource loader tests:

1. Default behavior unchanged:
   - global context loads
   - parent context loads
   - project context loads
   - global skills load

2. `ignoreGlobalContext: true`:
   - global `AGENTS.md` is ignored
   - global `CLAUDE.md` is ignored
   - parent context outside git root is ignored
   - project/repo context is kept
   - global skills are ignored
   - project/repo skills are kept
   - global extensions still load
   - project extensions still load
   - global `SYSTEM.md` / `APPEND_SYSTEM.md` ignored
   - project `SYSTEM.md` / `APPEND_SYSTEM.md` kept

3. Project-only behavior:
   - setting in global `~/.pi/agent/settings.json` is ignored or produces no global opt-out
   - setting in `.pi/settings.json` activates behavior

## Documentation

Add to settings docs under resources/context:

```json
{
  "ignoreGlobalContext": true
}
```

Description:

> Project-only. When true, Pi keeps global extensions/tools/auth/model settings but ignores global and parent LLM-facing context outside the current git repo, including global AGENTS/CLAUDE files, global SYSTEM/APPEND_SYSTEM files, and nonlocal skills.

## Backward compatibility

No behavior change unless a project explicitly sets:

```json
{
  "ignoreGlobalContext": true
}
```

## Why not `--no-context-files`

`--no-context-files` disables all context files, including local project context. The requested behavior is narrower: remove global/root context rot while preserving the current repo's instructions and skills.

## Why not extension-only

An extension can mutate the final prompt in `before_agent_start`, but that is too late for clean behavior:

- startup can still display global context/skills
- `/skill:*` can still expose global skills
- resource state remains polluted internally

This belongs in resource discovery/loading.
