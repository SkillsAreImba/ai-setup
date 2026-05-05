/**
 * vi extension — open the last-touched file in vim for quick editing.
 *
 * Usage:
 *   /vi            — open the last file the model read/edited/wrote
 *   /last          — same as /vi
 *   /vi <path>     — open a specific file
 *   /last <path>   — same as /vi <path>
 *
 * After you save and quit, pi tells you whether the file changed.
 * The model will see the updated file on its next read.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function restoreTerminal(): void {
	try {
		spawnSync("sh", ["-lc", "stty sane 2>/dev/null; printf '\\033[0m\\033[?25h\\033[?1049l\\033[?2004l\\r' 2>/dev/null"], {
			stdio: "inherit",
		});
	} catch {
		// Ignore terminal restore failures; best effort only.
	}
}

function launchEditor(editor: string, file: string, cwd: string) {
	const shell = process.env.SHELL || "/bin/sh";
	return spawnSync(shell, ["-lc", `${editor} "$1"`, "pi-vi", file], {
		stdio: "inherit",
		cwd,
		env: process.env,
	});
}

const ENTRY_TYPE = "vi-last-file";

export default function (pi: ExtensionAPI) {
	let lastFile: string | null = null;

	// Restore lastFile from session on startup/reload
	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		// Find the most recent vi-last-file entry
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "custom" && (entry as any).customType === ENTRY_TYPE) {
				lastFile = (entry as any).data?.path ?? null;
				break;
			}
		}
	});

	// Track the last file the model touched
	pi.on("tool_execution_start", async (event) => {
		const p = event.args?.path ?? event.args?.pattern;
		if (typeof p === "string" && ["read", "edit", "write"].includes(event.toolName)) {
			lastFile = p;
			pi.appendEntry(ENTRY_TYPE, { path: p });
		}
	});

	const openTouchedFile = async (args: string | undefined, ctx: ExtensionCommandContext) => {
		const file = args?.trim()
			? resolve(ctx.cwd, args.trim())
			: lastFile
				? resolve(ctx.cwd, lastFile)
				: null;

		if (!file) {
			ctx.ui.notify("No file yet. Model hasn't touched a file, and no path given.", "warning");
			return;
		}

		let before: string | null = null;
		try { before = readFileSync(file, "utf-8"); } catch { /* new file */ }

		const editor = process.env.VISUAL || process.env.EDITOR || "vim";
		const result = ctx.hasUI
			? await ctx.ui.custom<{ status: number | null; error?: Error }>((tui, _theme, _kb, done) => {
				tui.stop();
				process.stdout.write("\x1b[2J\x1b[H");

				const launched = launchEditor(editor, file, ctx.cwd);
				restoreTerminal();
				tui.start();
				tui.requestRender(true);
				done({ status: launched.status, error: launched.error });

				return { render: () => [], invalidate: () => {} };
			})
			: (() => {
				const launched = launchEditor(editor, file, ctx.cwd);
				restoreTerminal();
				return { status: launched.status, error: launched.error };
			})();

		if (result?.error) {
			ctx.ui.notify(`Failed to launch ${editor}: ${result.error.message}`, "error");
			return;
		}

		let after: string | null = null;
		try { after = readFileSync(file, "utf-8"); } catch { /* deleted? */ }

		if (after !== before) {
			ctx.ui.notify(`✓ ${file} — saved`, "info");
		} else {
			ctx.ui.notify(`${file} — no changes`, "info");
		}
	};

	pi.registerCommand("vi", {
		description: "Open last-touched file in $EDITOR/$VISUAL. /vi <path> for a specific file.",
		handler: openTouchedFile,
	});

	pi.registerCommand("last", {
		description: "Open last-touched file in $EDITOR/$VISUAL. Same as /vi.",
		handler: openTouchedFile,
	});
	}
