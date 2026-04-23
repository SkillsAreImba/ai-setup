# Global — Claude Code overlay

Lean iron rules live in `AGENTS.md` (cross-tool, shared with pi/codex/aider).
This file adds Claude-specific extras: verbose hard rules, local toolchain
detail, and Claude-Code-only imports (RTK hook usage, full disk layout).

@AGENTS.md

## Communication
- No mirroring, no motivation. Facts only.

## Deliverables format (non-negotiable)
- **Reports, summaries, reviews, briefs, plans, presentations, decks: always HTML.** Never `.md` as the final artefact.
- Clickable `file://` link at end of turn. Self-contained single-file HTML (inline CSS, no CDN). Dark theme, readable typography.
- Save to the project's natural output folder (`Inbox/` in ObsiVault, `APC/Clients/{CLIENT}/`, etc.). Never `/tmp`.

## Code
- Primary stack: TypeScript, React 19, Bun, Vite, Firebase/Supabase. ESM only. No fallbacks. One way.
- Cheap tools first (Grep/Glob). Heavy tools (Agent/Explore) only when insufficient.

## Writing
- Content generation: read `System/AI-Context/My Writing Style.md` first. Match the user's voice. Never sound corporate or generic.

## Doc freshness
- Session start: read the project's `docs/INDEX.md`. The SSOT files it lists are source of truth.
- Chat decision differs from SSOT → flag it (interactive: ask; autonomous: track drift).
- SSOT summarises. Don't re-inline code in docs — point to source.

## Hard rules (verbose — short form in AGENTS.md)
- **Destructive ops** (resize, mkfs, dd, parted, rm -rf, force-push, drop table, ALTER, migrations, kill -9): BEFORE running, state (1) interrupt-mid-way state, (2) manual recovery cost, (3) dirty-flags / post-cleanup on other OSes, (4) ask. After-the-fact warnings are useless.
- **Filesystem resize**: never run without dirty-state risk + rollback path. NTFS resize sets chkdsk-required flag if interrupted.
- **Background commands across SSH**: local harness `run_in_background` + remote `nohup setsid ... & disown`. Two mechanisms, both required.
- **Process "stuck"**: check IO bytes delta over real time, then strace, THEN declare hang. Don't declare based on assumed time.
- **`ps etime`** can lie if PIDs recycled. Verify with `stat /proc/PID` inode mtime.
- **Don't make me go physical** when SSH+setup avoids it. If root cause is "I forgot to make this persistent across reboots", fix preemptively (NOPASSWD sudo, autologin, persistent SSH).

## Local toolchain (Fedora 43)
- **Node**: mise (`~/.local/bin/mise`), NOT nvm. nvm dirs kept at `~/.nvm` as offline fallback only, not sourced.
- **Bun**: standalone at `~/.bun/bin/bun`. Globals in `~/.bun/install/global/`.
- **Python/etc.**: via mise.
- **Shell**: atuin (Ctrl-R fuzzy, up-arrow native zsh). Pager: delta. TUI: lazygit.
- **Power**: tuned auto-switches `throughput-performance` (AC) ↔ `powersave` (battery) via `/usr/local/bin/power-profile-switch.sh` + udev. Battery: screen off 5min, suspend 15min, hibernate at 45min total.
- **Terminal**: Ghostty 1.3+ with Catppuccin Mocha. Config: `~/.config/ghostty/config`. Themes: `~/.config/ghostty/themes/`.

## Key Projects
- **DoNotDev**: `/data/ws/dndev/` — React/TS framework, 14+ packages, MCP server, WAI-WAY.
- **ObsiVault**: `/data/obsivault/` — Obsidian vault (Perspectives, IPCRA, Atomic Thinking).
- **pi-harness**: `/data/ws/harness/` — local coding harness (Bun-only).
- **pi-mono**: `/data/ws/pi-mono/` — pi monorepo.

@RTK.md
@rules/disk-layout.md
