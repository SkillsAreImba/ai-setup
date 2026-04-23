#!/usr/bin/env python3
"""
check_context.py — Deterministic context audit checks.

Runs all non-AI checks and emits a JSON findings report to stdout.
The SKILL.md layers CLAUDE.md rule analysis (language judgment) on top.

Usage:
    python3 check_context.py [--project-dir PATH]

Output: JSON to stdout with structure:
    {
        "project_dir": "/path/to/project",
        "score": 85,
        "checks": { "category_name": {...}, ... },
        "findings": [ {...}, ... ]  # flat list, sorted by deduction
    }
"""

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

HOME = Path.home()
CLAUDE_DIR = HOME / ".claude"

# MCP servers with CLI alternatives (substring match on server name)
CLI_ALTERNATIVES = {
    "playwright": "npx playwright",
    "github": "gh",
    "google-workspace": "gcloud",
    "aws": "aws",
    "sentry": "sentry-cli",
    "firecrawl": "npx firecrawl",
    "supabase": "npx supabase",
    "vercel": "vercel",
}

# Typed language extensions → (binary name, plugin name)
LSP_LANG_MAP = {
    ".py": ("pyright-langserver", "pyright-lsp"),
    ".ts": ("typescript-language-server", "typescript-lsp"),
    ".tsx": ("typescript-language-server", "typescript-lsp"),
    ".go": ("gopls", "gopls-lsp"),
    ".rs": ("rust-analyzer", "rust-analyzer-lsp"),
    ".java": ("jdtls", "jdtls-lsp"),
    ".cs": ("OmniSharp", "csharp-lsp"),
}

# Project marker files → bloat directories that should be ignored
CLAUDEIGNORE_MAP = {
    "package.json": ["node_modules", "dist", "build", ".next", "coverage"],
    "Cargo.toml": ["target"],
    "go.mod": ["vendor"],
    "pyproject.toml": ["__pycache__", ".venv"],
    "requirements.txt": ["__pycache__", ".venv"],
}


def _safe_load_json(path: Path) -> dict:
    """Load JSON file, return empty dict on any error."""
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def _parse_frontmatter(text: str) -> dict:
    """Minimal YAML frontmatter parser — handles key: value pairs."""
    lines = text.split("\n")
    if not lines or lines[0] != "---":
        return {}
    fm = {}
    for line in lines[1:]:
        if line == "---":
            break
        if ":" in line and not line.startswith(" "):
            key, _, value = line.partition(":")
            fm[key.strip()] = value.strip()
    return fm


def check_mcp_servers(project_dir: Path) -> dict:
    """Detect local MCP servers and flag those with CLI alternatives."""
    servers = []
    for path in [project_dir / ".mcp.json", CLAUDE_DIR / ".mcp.json"]:
        if path.exists():
            data = _safe_load_json(path)
            for name in data.get("mcpServers", {}).keys():
                servers.append({"name": name, "source": str(path)})

    flagged = []
    for server in servers:
        name_lower = server["name"].lower()
        for key, cli in CLI_ALTERNATIVES.items():
            if key in name_lower:
                flagged.append({"server": server["name"], "cli": cli})
                break

    findings = []
    if flagged:
        findings.append({
            "category": "mcp_servers",
            "severity": "warning",
            "issue": f"{len(flagged)} MCP server(s) have CLI alternatives",
            "fix": "Replace with CLI: " + ", ".join(f["cli"] for f in flagged),
            "deduction": len(flagged) * 3,
            "details": flagged,
        })

    return {
        "category": "mcp_servers",
        "total_local": len(servers),
        "servers": servers,
        "with_cli_alternatives": flagged,
        "findings": findings,
    }


def check_skills(project_dir: Path) -> dict:
    """Count skills, check description lengths, archived flag, file size."""
    skills_dir = project_dir / ".claude" / "skills"
    if not skills_dir.exists():
        return {"category": "skills", "total": 0, "findings": []}

    skills = []
    oversized_desc = []
    missing_disable = []
    oversized_files = []

    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue

        content = skill_md.read_text()
        lines = content.split("\n")
        fm = _parse_frontmatter(content)
        name = fm.get("name", skill_dir.name)
        desc = fm.get("description", "")

        skills.append({
            "name": name,
            "lines": len(lines),
            "description_length": len(desc),
        })

        if len(desc) > 250:
            oversized_desc.append(name)

        is_archived = "_archived" in skill_dir.name or "archived" in name.lower()
        if is_archived and "disable-model-invocation" not in content:
            missing_disable.append(name)

        if len(lines) > 500:
            oversized_files.append({"name": name, "lines": len(lines)})

    findings = []
    if oversized_desc:
        findings.append({
            "category": "skills",
            "severity": "info",
            "issue": f"{len(oversized_desc)} skill description(s) over 250 chars (truncated)",
            "fix": "Tighten descriptions to 250 chars or less",
            "deduction": 0,
            "details": oversized_desc,
        })
    if missing_disable:
        findings.append({
            "category": "skills",
            "severity": "warning",
            "issue": f"{len(missing_disable)} archived skill(s) missing disable-model-invocation",
            "fix": "Add `disable-model-invocation: true` to frontmatter",
            "deduction": len(missing_disable) * 2,
            "details": missing_disable,
        })
    if oversized_files:
        findings.append({
            "category": "skills",
            "severity": "info",
            "issue": f"{len(oversized_files)} skill(s) over 500 lines",
            "fix": "Move detail to reference files",
            "deduction": len(oversized_files) * 3,
            "details": oversized_files,
        })

    total_desc_chars = sum(s["description_length"] for s in skills)

    return {
        "category": "skills",
        "total": len(skills),
        "description_budget_used": total_desc_chars,
        "description_budget_max": 8000,
        "findings": findings,
    }


def check_effort_level(project_dir: Path) -> dict:
    """Check for effort level / thinking budget configuration."""
    has_effort = False
    for path in [CLAUDE_DIR / "settings.json", project_dir / ".claude" / "settings.json"]:
        if path.exists():
            data = _safe_load_json(path)
            if "effortLevel" in data:
                has_effort = True
                break

    has_env = bool(os.environ.get("MAX_THINKING_TOKENS"))

    findings = []
    if not has_effort and not has_env:
        findings.append({
            "category": "effort_level",
            "severity": "warning",
            "issue": "No effort level or MAX_THINKING_TOKENS configured (default thinking budget)",
            "fix": 'Set "effortLevel": "medium" in settings.json or MAX_THINKING_TOKENS=8000 env var',
            "deduction": 10,
        })

    return {"category": "effort_level", "has_config": has_effort or has_env, "findings": findings}


def check_lsp(project_dir: Path) -> dict:
    """Check the three-part LSP stack: binary, plugin, enforcement hook."""
    detected_langs = set()
    for ext in LSP_LANG_MAP:
        try:
            next(project_dir.rglob(f"*{ext}"))
            detected_langs.add(ext)
        except StopIteration:
            pass

    if not detected_langs:
        return {"category": "lsp", "typed_language": False, "findings": []}

    server_results = {}
    for ext in detected_langs:
        binary, plugin_name = LSP_LANG_MAP[ext]
        server_results[ext] = {
            "binary": binary,
            "installed": shutil.which(binary) is not None,
            "plugin_name": plugin_name,
        }

    plugins_dir = CLAUDE_DIR / "plugins" / "marketplaces" / "claude-plugins-official" / "plugins"
    installed_plugins = []
    if plugins_dir.exists():
        for p in sorted(plugins_dir.iterdir()):
            if p.is_dir() and p.name.endswith("-lsp"):
                installed_plugins.append(p.name)

    has_hook = False
    settings_path = CLAUDE_DIR / "settings.json"
    if settings_path.exists():
        data = _safe_load_json(settings_path)
        for entry in data.get("hooks", {}).get("PreToolUse", []):
            if entry.get("matcher") == "Grep":
                has_hook = True
                break

    any_server = any(r["installed"] for r in server_results.values())
    any_plugin = bool(installed_plugins)

    findings = []
    if not any_server and not any_plugin:
        findings.append({
            "category": "lsp",
            "severity": "critical",
            "issue": "Typed language detected, no LSP stack installed",
            "fix": "Install language server binary + plugin + enforcement hook",
            "deduction": 10,
        })
    elif not any_server:
        findings.append({
            "category": "lsp",
            "severity": "warning",
            "issue": "LSP plugin installed but language server binary missing from PATH",
            "fix": "Install the language server binary (e.g. `npm install -g pyright`)",
            "deduction": 5,
        })
    elif not any_plugin:
        findings.append({
            "category": "lsp",
            "severity": "warning",
            "issue": "Language server in PATH but no Claude Code plugin installed",
            "fix": "Install the matching plugin (e.g. `/plugins install pyright-lsp`)",
            "deduction": 5,
        })
    elif not has_hook:
        findings.append({
            "category": "lsp",
            "severity": "info",
            "issue": "LSP stack installed but no enforcement hook — Claude may still default to Grep",
            "fix": "Add PreToolUse hook blocking Grep on code symbols",
            "deduction": 3,
        })

    return {
        "category": "lsp",
        "typed_language": True,
        "detected_languages": sorted(detected_langs),
        "language_servers": server_results,
        "installed_plugins": installed_plugins,
        "enforcement_hook": has_hook,
        "findings": findings,
    }


def check_settings(project_dir: Path) -> dict:
    """Check global settings.json for autocompact and bash output overrides."""
    findings = []
    settings_path = CLAUDE_DIR / "settings.json"
    if not settings_path.exists():
        findings.append({
            "category": "settings",
            "severity": "warning",
            "issue": "No global ~/.claude/settings.json",
            "fix": "Create with recommended defaults (autocompact, bash output, effort level)",
            "deduction": 5,
        })
        return {"category": "settings", "findings": findings}

    data = _safe_load_json(settings_path)
    if not data:
        findings.append({
            "category": "settings",
            "severity": "critical",
            "issue": "settings.json is malformed or unreadable",
            "fix": "Fix JSON syntax",
            "deduction": 10,
        })
        return {"category": "settings", "findings": findings}

    autocompact = data.get("autocompact_percentage_override")
    if autocompact is None:
        findings.append({
            "category": "settings",
            "severity": "warning",
            "issue": "autocompact_percentage_override not set",
            "fix": 'Add "autocompact_percentage_override": 75',
            "deduction": 10,
        })
    elif autocompact > 80:
        findings.append({
            "category": "settings",
            "severity": "info",
            "issue": f"autocompact_percentage_override is {autocompact} (recommend 75)",
            "fix": "Lower to 75 for earlier compaction",
            "deduction": 3,
        })

    bash_max = data.get("env", {}).get("BASH_MAX_OUTPUT_LENGTH")
    if not bash_max:
        findings.append({
            "category": "settings",
            "severity": "info",
            "issue": "BASH_MAX_OUTPUT_LENGTH not set (default truncates long outputs)",
            "fix": 'Set "BASH_MAX_OUTPUT_LENGTH": "150000" in env',
            "deduction": 5,
        })

    return {
        "category": "settings",
        "autocompact": autocompact,
        "bash_max_output": bash_max,
        "findings": findings,
    }


def check_claudeignore(project_dir: Path) -> dict:
    """Check for .claudeignore vs presence of bloat directories."""
    claudeignore = project_dir / ".claudeignore"
    has_file = claudeignore.exists()

    bloat_dirs = []
    for marker, dirs in CLAUDEIGNORE_MAP.items():
        if (project_dir / marker).exists():
            for d in dirs:
                if (project_dir / d).exists():
                    bloat_dirs.append(d)
    bloat_dirs = sorted(set(bloat_dirs))

    findings = []
    if bloat_dirs and not has_file:
        findings.append({
            "category": "claudeignore",
            "severity": "warning",
            "issue": f"No .claudeignore but bloat dirs present: {', '.join(bloat_dirs)}",
            "fix": "Create .claudeignore with relevant entries",
            "deduction": 10,
            "details": bloat_dirs,
        })

    return {
        "category": "claudeignore",
        "has_file": has_file,
        "bloat_dirs": bloat_dirs,
        "findings": findings,
    }


def check_hooks(project_dir: Path) -> dict:
    """Scan hook configuration for overly broad matchers."""
    settings_paths = [
        CLAUDE_DIR / "settings.json",
        project_dir / ".claude" / "settings.json",
        project_dir / ".claude" / "settings.local.json",
    ]

    total_hooks = 0
    broad_hooks_list = []

    for path in settings_paths:
        if not path.exists():
            continue
        data = _safe_load_json(path)
        for event_type, entries in data.get("hooks", {}).items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                total_hooks += 1
                matcher = entry.get("matcher", "")
                if not matcher or matcher == ".*":
                    broad_hooks_list.append({
                        "event": event_type,
                        "matcher": matcher or "(none)",
                        "source": str(path),
                    })

    findings = []
    if broad_hooks_list:
        findings.append({
            "category": "hooks",
            "severity": "warning",
            "issue": f"{len(broad_hooks_list)} hook(s) with no matcher or broad matcher (.*)",
            "fix": "Narrow matchers to specific tool names",
            "deduction": len(broad_hooks_list) * 5,
            "details": broad_hooks_list,
        })

    return {
        "category": "hooks",
        "total": total_hooks,
        "broad": len(broad_hooks_list),
        "findings": findings,
    }


def check_subagents(project_dir: Path) -> dict:
    """Check subagent definitions for missing model specification."""
    agents_dirs = [
        project_dir / ".claude" / "agents",
        CLAUDE_DIR / "agents",
    ]

    total = 0
    missing_model = []

    for agents_dir in agents_dirs:
        if not agents_dir.exists():
            continue
        for agent_file in sorted(agents_dir.glob("*.md")):
            total += 1
            content = agent_file.read_text()
            if "model:" not in content:
                missing_model.append(agent_file.name)

    findings = []
    if missing_model:
        findings.append({
            "category": "subagents",
            "severity": "info",
            "issue": f"{len(missing_model)} subagent(s) without explicit model",
            "fix": "Set `model: haiku` for simple lookups/processing tasks",
            "deduction": 0,
            "details": missing_model,
        })

    return {"category": "subagents", "total": total, "findings": findings}


def check_agent_teams(project_dir: Path) -> dict:
    """Check for Agent Teams env var (high token cost)."""
    enabled = False
    settings_path = CLAUDE_DIR / "settings.json"
    if settings_path.exists():
        data = _safe_load_json(settings_path)
        if data.get("env", {}).get("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"):
            enabled = True

    findings = []
    if enabled:
        findings.append({
            "category": "agent_teams",
            "severity": "info",
            "issue": "Agent Teams enabled (~7x more tokens than standard sessions)",
            "fix": "Use Sonnet for teammates, keep teams small, clean up when done",
            "deduction": 5,
        })

    return {"category": "agent_teams", "enabled": enabled, "findings": findings}


def check_status_line(project_dir: Path) -> dict:
    """Check for status line configuration."""
    has_status = False
    settings_path = CLAUDE_DIR / "settings.json"
    if settings_path.exists():
        data = _safe_load_json(settings_path)
        if "statusLine" in data or "status_line" in data:
            has_status = True

    findings = []
    if not has_status:
        findings.append({
            "category": "status_line",
            "severity": "info",
            "issue": "No status line for context monitoring",
            "fix": "Configure status line via /config for context usage visibility",
            "deduction": 3,
        })

    return {"category": "status_line", "has_config": has_status, "findings": findings}


def compute_score(all_findings: list) -> int:
    deductions = sum(f.get("deduction", 0) for f in all_findings)
    return max(0, 100 - deductions)


def main() -> int:
    parser = argparse.ArgumentParser(description="Deterministic context audit checks")
    parser.add_argument("--project-dir", default=".", help="Project directory to audit")
    args = parser.parse_args()

    project_dir = Path(args.project_dir).resolve()
    if not project_dir.exists():
        print(json.dumps({"error": f"Project directory not found: {project_dir}"}))
        return 1

    checks = [
        check_mcp_servers(project_dir),
        check_skills(project_dir),
        check_effort_level(project_dir),
        check_lsp(project_dir),
        check_settings(project_dir),
        check_claudeignore(project_dir),
        check_hooks(project_dir),
        check_subagents(project_dir),
        check_agent_teams(project_dir),
        check_status_line(project_dir),
    ]

    all_findings = []
    for c in checks:
        all_findings.extend(c.get("findings", []))

    all_findings.sort(key=lambda f: f.get("deduction", 0), reverse=True)

    report = {
        "project_dir": str(project_dir),
        "score": compute_score(all_findings),
        "checks": {c["category"]: c for c in checks},
        "findings": all_findings,
    }

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
