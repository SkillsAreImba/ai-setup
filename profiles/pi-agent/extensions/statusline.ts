/**
 * statusline.ts — auto-enabled custom footer for pi
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { basename } from "node:path";

const fmtN = (n: number): string =>
    n < 1000 ? `${n}` : n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(2)}M`;

const fmtClock = (): string => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const sumUsage = (ctx: ExtensionContext): { input: number; output: number } => {
    let input = 0, output = 0;
    for (const e of ctx.sessionManager.getBranch()) {
        if (e.type === "message" && e.message.role === "assistant") {
            const m = e.message as AssistantMessage;
            input += m.usage?.input || 0;
            output += m.usage?.output || 0;
        }
    }
    return { input, output };
};

export default function (pi: ExtensionAPI) {
    let active = false;

    const enable = (ctx: ExtensionContext) => {
        if (active) return;
        active = true;
        ctx.ui.setFooter((tui, theme, footerData) => {
            const unsub = footerData.onBranchChange(() => tui.requestRender());
            const tick = setInterval(() => tui.requestRender(), 30_000);
            return {
                dispose: () => { unsub(); clearInterval(tick); },
                invalidate() {},
                render(width: number): string[] {
                    const usage = sumUsage(ctx);
                    const ctxInfo = ctx.getContextUsage();
                    
                    // Calculate percentage from whatever data the API provides:
                    let pct: number | null = null;
                    
                    // 1. Direct percent (some APIs)
                    if (ctxInfo?.percent !== undefined) {
                        pct = ctxInfo.percent;
                    }
                    // 2. From tokens + contextWindow
                    else if (ctxInfo?.tokens !== undefined && ctxInfo?.contextWindow && ctxInfo.contextWindow > 0) {
                        pct = (ctxInfo.tokens / ctxInfo.contextWindow) * 100;
                    }
                    // 3. Fallback: use input+output + contextWindow
                    else if (ctxInfo?.contextWindow && ctxInfo.contextWindow > 0) {
                        const total = usage.input + usage.output;
                        if (total > 0) {
                            pct = (total / ctxInfo.contextWindow) * 100;
                        }
                    }
                    
                    const pctTone: "success" | "warning" | "error" | "dim" =
                        pct == null ? "dim" : pct < 60 ? "success" : pct < 85 ? "warning" : "error";
                    const pctStr = pct == null ? "—" : `${Math.round(pct)}%`;

                    const modelId = ctx.model?.id ?? "no-model";
                    const branch = footerData.getGitBranch();
                    const cwdShort = basename(ctx.cwd) || "/";

                    const left = [
                        theme.fg("accent", modelId),
                        theme.fg("dim", "·"),
                        theme.fg("dim", "ctx "),
                        theme.fg(pctTone, pctStr),
                    ].join(" ");

                    const mid = branch
                        ? `${theme.fg("dim", cwdShort)} ${theme.fg("dim", "(" + branch + ")")}`
                        : theme.fg("dim", cwdShort);

                    const right = [
                        theme.fg("dim", `↑${fmtN(usage.input)} ↓${fmtN(usage.output)}`),
                        theme.fg("dim", " "),
                        theme.fg("dim", fmtClock()),
                    ].join("");

                    const lw = visibleWidth(left), mw = visibleWidth(mid), rw = visibleWidth(right);
                    const free = width - lw - mw - rw;
                    if (free < 2) {
                        return [truncateToWidth(left + " " + right, width)];
                    }
                    const lp = Math.floor(free / 2), rp = free - lp;
                    return [truncateToWidth(left + " ".repeat(lp) + mid + " ".repeat(rp) + right, width)];
                },
            };
        });
    };

    const disable = () => { active = false; };

    pi.on("session_start", () => enable);
    pi.on("session_end", () => disable);

    pi.registerCommand("statusline", {
        description: "Toggle statusline",
        handler: (_args: any, ctx: ExtensionContext) => {
            if (active) {
                ctx.ui.setFooter(undefined);
                disable();
                ctx.ui.notify("Statusline off", "info");
            } else {
                enable(ctx);
                ctx.ui.notify("Statusline on", "info");
            }
        },
    });
}
