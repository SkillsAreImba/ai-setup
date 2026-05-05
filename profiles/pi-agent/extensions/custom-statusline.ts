/**
 * Custom Status Line Extension
 * 
 * Progress bar with numbers inside, colored background based on usage
 * Minimal labels (name and $ only)
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ALL_WIDGETS = {
  "model": { label: "Model", category: "Core", desc: "Current model name" },
  "thinking": { label: "Thinking", category: "Core", desc: "thinking level" },
  "git-branch": { label: "Git Branch", category: "Git", desc: "git branch name" },
  "git-files": { label: "Git Files", category: "Git", desc: "changed files count" },
  "context-pct": { label: "Context %", category: "Context", desc: "context usage percentage" },
  "context-left": { label: "Context Left", category: "Context", desc: "remaining context capacity" },
  "cost": { label: "Cost", category: "Session", desc: "session cumulative cost" },
  "tokens-in": { label: "Tokens In", category: "Tokens", desc: "input token count this session" },
  "tokens-out": { label: "Tokens Out", category: "Tokens", desc: "output token count this session" },
  "tokens-daily": { label: "Daily Tokens", category: "Tokens", desc: "today cumulative token count" },
  "tokens-monthly": { label: "Monthly Tokens", category: "Tokens", desc: "month cumulative token count" },
  "session-clock": { label: "Session Clock", category: "Session", desc: "session runtime duration" },
  "context-bar": { label: "Context Bar", category: "Context", desc: "context progress bar" },
} as const;

export type WidgetId = keyof typeof ALL_WIDGETS;

const DEFAULT_ROWS: WidgetId[][] = [
  ["model", "thinking", "git-branch", "git-files", "context-bar"],
  ["cost", "tokens-in", "tokens-out", "tokens-daily", "tokens-monthly", "session-clock"],
];

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
const CONFIG_PATH = join(AGENT_DIR, "statusline.json");

function loadConfig() {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    if (raw.rows) return { rows: raw.rows };
  } catch {}
  return { rows: DEFAULT_ROWS.map((row) => [...row]) };
}

function saveConfig(cfg: { rows: WidgetId[][] }) {
  try {
    mkdirSync(AGENT_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify({ rows: cfg.rows }, null, 2), "utf8");
  } catch {}
}

function normalizeRows(rows: unknown): WidgetId[][] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => Array.isArray(row) ? row.filter((w): w is WidgetId => typeof w === "string" && w in ALL_WIDGETS) : [])
    .filter((row) => row.length > 0);
}

function formatRows(rows: WidgetId[][]): string {
  return rows.map((row, i) => `row${i + 1}: ${row.join(", ")}`).join(" | ");
}

interface SessionTokenStats {
  input: number;
  output: number;
  cost: number;
  assistantTurns: number;
}

function getSessionTokenStats(ctx: ExtensionContext): SessionTokenStats {
  let input = 0, output = 0, cost = 0, assistantTurns = 0;

  for (const e of ctx.sessionManager.getBranch()) {
    if (e.type === "message" && e.message.role === "assistant") {
      const m = e.message as AssistantMessage;
      assistantTurns += 1;
      input += m.usage.input;
      output += m.usage.output;
      cost += m.usage.cost.total;
    }
  }

  return { input, output, cost, assistantTurns };
}

interface ContextStats {
  tokens: number | null;
  percent: number | null;
  contextWindow: number | null;
  remaining: number | null;
}

function getContextStats(ctx: ExtensionContext): ContextStats {
  const usage = ctx.getContextUsage();
  if (!usage) {
    return { tokens: null, percent: null, contextWindow: null, remaining: null };
  }

  const tokens = usage.tokens ?? null;
  const contextWindow = usage.contextWindow ?? null;

  let percent: number | null = null;
  if (usage.percent != null) {
    percent = usage.percent;
  } else if (tokens != null && contextWindow != null && contextWindow > 0) {
    percent = (tokens / contextWindow) * 100;
  }
  
  const remaining = tokens != null && contextWindow != null ? Math.max(0, contextWindow - tokens) : null;

  return { tokens, percent, contextWindow, remaining };
}

function gitRun(args: string, cwd: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 2000,
    }).toString().trim();
  } catch { return ""; }
}

function isGitRepo(cwd: string): boolean {
  return gitRun("rev-parse --is-inside-work-tree", cwd) === "true";
}

interface GitStats {
  branch: string | null;
  changedFiles: number;
}

function getGitStats(cwd: string): GitStats | null {
  if (!isGitRepo(cwd)) return null;

  const status = gitRun("status --porcelain --untracked-files=all", cwd);
  const changedFiles = status ? status.split("\n").filter(Boolean).length : 0;

  return { branch: gitRun("branch --show-current", cwd) || null, changedFiles };
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.001) return `$${usd.toFixed(5)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 1) return "<1m";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}hr`;
  return `${h}hr ${m}m`;
}

function makeContextProgressBar(
  pct: number,
  width: number,
  theme: ExtensionContext["ui"]["theme"],
  tokens: number,
  contextWindow: number,
): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);

  let bgColorClass: "success" | "warning" | "error";
  if (clamped <= 30) bgColorClass = "success";
  else if (clamped <= 80) bgColorClass = "warning";
  else bgColorClass = "error";

  const barChars = [];
  const numWidth = 5;

  for (let i = 0; i < width; i++) {
    const charIndex = i % (width - numWidth);
    if (charIndex < filled && charIndex < width - numWidth) {
      barChars.push(theme.fg(bgColorClass, "█"));
    } else {
      barChars.push(theme.fg("dim", "░"));
    }
  }

  const usedK = Math.round(tokens / 1000);
  const totalK = Math.round(contextWindow / 1000);
  const numStr = `${usedK}k/${totalK}k`;

  return theme.fg("muted", "Ctx: ") + theme.fg("accent", numStr);
}

interface RenderArgs {
  ctx: ExtensionContext;
  theme: ExtensionContext["ui"]["theme"];
  sessionStart: number;
  tokenStats: SessionTokenStats;
  contextStats: ContextStats;
  gitStats: GitStats | null;
  thinkingLevel: string | null;
}

function renderWidget(id: WidgetId, ra: RenderArgs): string | null {
  const { ctx, theme: t, sessionStart, tokenStats, contextStats, gitStats, thinkingLevel } = ra;
  const cwd = ctx.cwd;

  switch (id) {
    case "model":
      const m = ctx.model?.id ?? "—";
      return t.fg("accent", m);

    case "thinking":
      if (!thinkingLevel || thinkingLevel === "off") return null;
      return t.fg("dim", thinkingLevel);

    case "git-branch":
      if (!gitStats?.branch) return t.fg("dim", "⎇ no git");
      return t.fg("dim", `⎇ ${gitStats.branch}`);

    case "git-files":
      if (!gitStats) return null;
      return t.fg("dim", `Files: ${gitStats.changedFiles}`);

    case "context-pct":
      if (contextStats.percent == null) return null;
      return t.fg("dim", `${contextStats.percent.toFixed(1)}%`);

    case "context-left":
      if (contextStats.remaining == null) return null;
      return t.fg("dim", `Left: ${fmtTokens(contextStats.remaining)}`);

    case "context-bar":
      if (contextStats.tokens == null || contextStats.contextWindow == null) return null;
      const pct = Math.min(100, contextStats.percent ?? 0);
      return makeContextProgressBar(pct, 30, t, contextStats.tokens, contextStats.contextWindow);

    case "cost":
      return t.fg("accent", `Cost: ${fmtCost(tokenStats.cost)}`);

    case "tokens-in":
      return t.fg("dim", `In: ${fmtTokens(tokenStats.input)}`);

    case "tokens-out":
      return t.fg("dim", `Out: ${fmtTokens(tokenStats.output)}`);

    case "tokens-daily": {
      const today = ctx.sessionManager.getToday();
      return t.fg("dim", `Today: ${fmtTokens(today.input + today.output)}`);
    }

    case "tokens-monthly": {
      const month = ctx.sessionManager.getMonth();
      return t.fg("dim", `Month: ${fmtTokens(month.input + month.output)}`);
    }

    case "session-clock":
      return t.fg("dim", `Session: ${fmtDuration(Date.now() - sessionStart)}`);

    default:
      return null;
  }
}

function installFooter(ctx: ExtensionContext) {
  const sessionStart = ctx.sessionStartTime ?? Date.now();
  const tokenStats = getSessionTokenStats(ctx);
  const contextStats = getContextStats(ctx);
  const gitStats = getGitStats(ctx.cwd);
  const config = loadConfig();
  const thinkingLevel = ctx.ai.thinkingLevel ?? "off";

  const render = (widget: string) => renderWidget(widget as WidgetId, { ctx, theme: ctx.ui.theme, sessionStart, tokenStats, contextStats, gitStats, thinkingLevel });

  ctx.ui.setFooter({
    rows: config.rows.map((row) => row.map(render).filter(Boolean).join(" ")),
  });
}

export function init(api: ExtensionAPI, ctx: ExtensionContext): void {
  ctx.ui.setPromptPrompt("⚠️ custom-statusline disabled (use .statusline to enable)");

  api.registerCommand("statusline", {
    desc: "Config and toggle status line widgets",
    options: {
      args: {
        type: "list",
        choices: Object.keys(ALL_WIDGETS),
      },
    },
    handler: async (_ctx, { args }) => {
      const trimmed = (args ?? []).join(" ");

      if (/^(reset|重置|默认|default)$/i.test(trimmed)) {
        const config = { rows: DEFAULT_ROWS.map((row) => [...row]) };
        saveConfig(config);
        installFooter(ctx);
        ctx.ui.notify(`✓ 已重置为默认: ${formatRows(config.rows)}`, "info");
        return;
      }

      if (/^(list|显示|l)$/i.test(trimmed)) {
        ctx.ui.notify(`${formatRows(loadConfig().rows)}`, "info");
        return;
      }

      if (/^(toggle|切换|t)$/i.test(trimmed)) {
        const current = loadConfig();
        const next = {
          rows: current.rows.map((row) =>
            row.length === 1 ? [] : row.length === DEFAULT_ROWS[0].length ? DEFAULT_ROWS[0].filter((w, i) => i > 0) : row.slice(1),
          ),
        };
        saveConfig(next);
        installFooter(ctx);
        ctx.ui.notify(`✓ Status line toggled. Current: ${formatRows(next.rows)}`, "info");
        return;
      }

      if (/^(remove|rm|R)$/i.test(trimmed)) {
        const widget = args?.[0];
        if (!widget || !(widget in ALL_WIDGETS)) {
          ctx.ui.notify("Usage: .statusline remove <widget>", "warn");
          return;
        }
        const current = loadConfig();
        const next = {
          rows: current.rows.map((row) => row.filter((w) => w !== widget)),
        };
        saveConfig(next);
        installFooter(ctx);
        ctx.ui.notify(`✓ 已移除: ${widget}`, "info");
        return;
      }

      if (/^(add|a)$/i.test(trimmed)) {
        const widget = args?.[0];
        if (!widget || !(widget in ALL_WIDGETS)) {
          ctx.ui.notify("Usage: .statusline add <widget>", "warn");
          return;
        }
        const current = loadConfig();
        const next = {
          rows: current.rows.map((row, i) =>
            i === current.rows.length - 1 ? [...row, widget] : row,
          ),
        };
        saveConfig(next);
        installFooter(ctx);
        ctx.ui.notify(`✓ 已添加: ${widget}`, "info");
        return;
      }

      pi.sendUserMessage(trimmed, { deliverAs: "followUp" });
    },
  });

  setInterval(() => installFooter(ctx), 500);
}
