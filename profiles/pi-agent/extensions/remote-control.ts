/**
 * remote-control.ts — bridge this pi session to a remote viewer over WebSocket.
 *
 * Generic. Not gontrand-specific. Any compatible server that speaks the wire
 * protocol below can attach.
 *
 * Usage:
 *   /remote-control                        → connect using PI_REMOTE_URL env
 *   /remote-control wss://host/api/path    → connect to an explicit URL
 *   /remote-control                        → second invocation disconnects
 *   /remote-control off                    → also disconnects
 *
 * Env:
 *   PI_REMOTE_URL    WebSocket URL (used when no slash-arg is given)
 *   PI_REMOTE_TOKEN  bearer token sent in the Authorization header (required)
 *
 * Wire protocol (JSON-per-frame):
 *   ext  → server: { kind:"attach", cwd }
 *   ext  → server: { kind:"snapshot", entries: SessionEntry[] }
 *   ext  → server: { kind:"event", event: ExtensionEvent }
 *   ext  → server: { kind:"hitl_request", id, toolName, input }
 *   ext  → server: { kind:"hitl_resolved", id }
 *   ext  ← server: { kind:"user_message", text }
 *   ext  ← server: { kind:"hitl_response", id, decision:"allow"|"deny" }
 *   ext  ← server: { kind:"replaced" }
 *
 * Reference server: /data/ws/gontrand/server/routes/pi-remote.ts
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const STATUS_KEY = "remote";

/** Tools that require remote approval. Read-style tools auto-allow. */
const APPROVE_TOOLS = new Set(["bash", "edit", "write"]);

/** Ms to coalesce streaming text deltas before forwarding. */
const COALESCE_MS = 50;

interface PendingDeltas {
	delta: string;
	partial: unknown;
}

export default function (pi: ExtensionAPI) {
	let socket: WebSocket | null = null;
	let activeCtx: ExtensionContext | null = null;
	let pendingDeltas: PendingDeltas | null = null;
	let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
	const pendingHitl = new Map<string, (decision: "allow" | "deny") => void>();

	const send = (frame: unknown): void => {
		if (socket && socket.readyState === WebSocket.OPEN) {
			try {
				socket.send(JSON.stringify(frame));
			} catch {
				/* swallow */
			}
		}
	};

	const flushDeltas = (): void => {
		if (pendingDeltas) {
			send({
				kind: "event",
				event: {
					type: "message_update",
					message: pendingDeltas.partial,
					assistantMessageEvent: { type: "text_delta", delta: pendingDeltas.delta },
				},
			});
			pendingDeltas = null;
		}
		if (coalesceTimer) {
			clearTimeout(coalesceTimer);
			coalesceTimer = null;
		}
	};

	const setStatus = (text: string | undefined): void => {
		activeCtx?.ui.setStatus(STATUS_KEY, text);
	};

	const teardown = (notice?: string): void => {
		flushDeltas();
		if (socket && socket.readyState <= 1) {
			try {
				socket.close(1000, "client disconnect");
			} catch {
				/* swallow */
			}
		}
		socket = null;
		setStatus(undefined);
		if (notice) activeCtx?.ui.notify(notice, "info");
		for (const resolver of pendingHitl.values()) resolver("deny");
		pendingHitl.clear();
	};

	// -- Forwarders ---------------------------------------------------------

	pi.on("agent_start", async () => send({ kind: "event", event: { type: "agent_start" } }));
	pi.on("agent_end", async () => {
		flushDeltas();
		send({ kind: "event", event: { type: "agent_end" } });
	});
	pi.on("turn_end", async (e) => {
		flushDeltas();
		send({ kind: "event", event: e });
	});
	pi.on("message_start", async (e) => {
		flushDeltas();
		send({ kind: "event", event: e });
	});
	pi.on("message_end", async (e) => {
		flushDeltas();
		send({ kind: "event", event: e });
	});

	pi.on("message_update", async (e) => {
		const inner = e.assistantMessageEvent;
		if (inner.type === "text_delta") {
			const delta = (inner as { delta: string }).delta;
			pendingDeltas = pendingDeltas
				? { delta: pendingDeltas.delta + delta, partial: e.message }
				: { delta, partial: e.message };
			coalesceTimer ??= setTimeout(flushDeltas, COALESCE_MS);
			return;
		}
		flushDeltas();
		send({ kind: "event", event: e });
	});

	pi.on("tool_execution_start", async (e) => send({ kind: "event", event: e }));
	pi.on("tool_execution_update", async (e) => send({ kind: "event", event: e }));
	pi.on("tool_execution_end", async (e) => send({ kind: "event", event: e }));

	// -- HITL ---------------------------------------------------------------

	pi.on("tool_call", async (event, ctx) => {
		if (!socket || socket.readyState !== WebSocket.OPEN) return; // not bridged → pass through
		if (!APPROVE_TOOLS.has(event.toolName)) return; // policy: read tools auto-allow

		const id = crypto.randomUUID();
		send({ kind: "hitl_request", id, toolName: event.toolName, input: event.input });

		// Local AbortController so whichever side wins the race can dismiss the
		// other. Without this, the TUI confirm sticks visible after a remote
		// decision (and a TUI keypress is silently dropped after a remote one).
		const localAbort = new AbortController();
		const combinedSignal: AbortSignal =
			typeof (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any === "function"
				? (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([
					ctx.signal,
					localAbort.signal,
				])
				: localAbort.signal;

		let remoteResolver: ((d: "allow" | "deny") => void) | null = null;
		const remotePromise = new Promise<"allow" | "deny">((resolve) => {
			remoteResolver = resolve;
			pendingHitl.set(id, resolve);
		});

		const tuiPromise = ctx.ui
			.confirm(`Allow ${event.toolName}?`, JSON.stringify(event.input).slice(0, 240), {
				signal: combinedSignal,
			})
			.then((ok) => (ok ? ("allow" as const) : ("deny" as const)))
			.catch(() => "deny" as const);

		try {
			const decision = await Promise.race([remotePromise, tuiPromise]);
			// Dismiss whichever side hadn't completed yet.
			localAbort.abort();
			if (remoteResolver && pendingHitl.has(id)) {
				// TUI won — propagate the local decision to the PWA so its modal closes.
				remoteResolver(decision);
			}
			pendingHitl.delete(id);
			send({ kind: "hitl_resolved", id });

			if (decision === "deny") return { block: true, reason: "Denied via remote-control" };
			// allow → return undefined (pass through)
		} catch {
			pendingHitl.delete(id);
			send({ kind: "hitl_resolved", id });
			return { block: true, reason: "Denied via remote-control" };
		}
	});

	// -- Slash command ------------------------------------------------------

	pi.registerCommand("remote-control", {
		description: "Bridge this pi session to a remote viewer over WebSocket",
		handler: async (args, ctx) => {
			activeCtx = ctx;

			const arg = args.trim();
			if (socket || arg === "off") {
				teardown("remote-control: stopped");
				return;
			}

			const url = arg || process.env.PI_REMOTE_URL;
			if (!url) {
				ctx.ui.notify(
					"remote-control: pass a URL or set PI_REMOTE_URL (e.g. wss://host/api/pi/control)",
					"error",
				);
				return;
			}

			const token = process.env.PI_REMOTE_TOKEN;
			if (!token) {
				ctx.ui.notify("remote-control: PI_REMOTE_TOKEN not set", "error");
				return;
			}

			// Node 22+ / Bun expose WebSocket globally. The non-standard 2nd-arg
			// `{ headers }` is honoured by undici (Node) and Bun.
			const ws = new (WebSocket as unknown as new (
				u: string,
				opts?: { headers?: Record<string, string> },
			) => WebSocket)(url, {
				headers: { authorization: `Bearer ${token}` },
			});

			socket = ws;
			setStatus("📱 connecting…");

			ws.addEventListener("open", () => {
				setStatus("📱 remote attached");
				send({ kind: "attach", cwd: process.cwd() });
				try {
					const entries = ctx.sessionManager.getEntries().slice(-200);
					send({ kind: "snapshot", entries });
				} catch {
					/* getEntries may be unavailable in some modes */
				}
			});

			ws.addEventListener("close", () => {
				if (socket === ws) socket = null;
				setStatus(undefined);
			});

			ws.addEventListener("error", () => {
				ctx.ui.notify("remote-control: connection error", "error");
			});

			ws.addEventListener("message", (ev: MessageEvent) => {
				let frame: { kind?: string;[k: string]: unknown };
				try {
					frame = JSON.parse(typeof ev.data === "string" ? ev.data : "");
				} catch {
					return;
				}
				switch (frame.kind) {
					case "replaced":
						ctx.ui.notify("remote-control: replaced by another session", "warning");
						teardown();
						return;
					case "user_message": {
						const text = String(frame.text ?? "");
						if (text) pi.sendUserMessage(text, { deliverAs: "steer" });
						return;
					}
					case "hitl_response": {
						const id = String(frame.id ?? "");
						const decision = frame.decision === "allow" ? "allow" : "deny";
						const resolver = pendingHitl.get(id);
						if (resolver) {
							resolver(decision);
							pendingHitl.delete(id);
						}
						return;
					}
				}
			});
		},
	});

	pi.on("session_shutdown", async () => teardown());
}
