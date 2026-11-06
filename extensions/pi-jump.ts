import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { locateTranscript } from "../src/adapter.ts";
import { JumpOverlay, OVERLAY_OPTIONS } from "../src/overlay.ts";

export default function (pi: ExtensionAPI) {
	/** The open list, if any. Only one can be open: it holds input focus while visible. */
	let active: JumpOverlay | undefined;

	const open = async (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("/jump requires interactive mode", "error");
			return;
		}
		let overlay: JumpOverlay | undefined;
		await ctx.ui.custom<void>(
			(tui, theme, keybindings, done) => {
				// Snapshot the stops when the list opens.
				const located = locateTranscript(tui);
				if (!located.ok) {
					ctx.ui.notify(located.reason, "error");
					done(); // pi ignores the returned component once closed
					return { render: () => [], invalidate: () => {} };
				}
				if (located.transcript.stops.length === 0) {
					ctx.ui.notify("/jump: nothing to jump to yet", "info");
					done();
					return { render: () => [], invalidate: () => {} };
				}
				overlay = new JumpOverlay(tui, theme, keybindings, located.transcript.stops, done, (m) => ctx.ui.notify(m, "error"));
				active = overlay;
				return overlay;
			},
			{ overlay: true, overlayOptions: OVERLAY_OPTIONS },
		);
		if (active === overlay) active = undefined;
	};

	pi.registerCommand("jump", {
		description: "Jump through every stop in the conversation (messages, thinking, tool calls)",
		handler: async (_args, ctx) => open(ctx),
	});

	pi.registerShortcut("ctrl+shift+j", {
		description: "Open the /jump conversation index",
		handler: async (ctx) => open(ctx),
	});

	// Transcript changes while the list is open: refresh it (coalesced). A slow backup poll in
	// the overlay catches anything these miss.
	const changed = () => active?.scheduleRefresh();
	pi.on("message_start", changed);
	pi.on("message_update", changed);
	pi.on("message_end", changed);
	pi.on("tool_execution_start", changed);
	pi.on("tool_execution_update", changed);
	pi.on("tool_execution_end", changed);
	pi.on("session_compact", changed);
	pi.on("session_tree", changed);

	// Never outlive the session: the list holds that session's ctx and transcript.
	pi.on("session_shutdown", () => active?.close());
}
