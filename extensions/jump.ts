import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { locateTranscript } from "../src/adapter.ts";
import { HEIGHT_FRACTION, JumpOverlay } from "../src/overlay.ts";

export default function (pi: ExtensionAPI) {
	const open = async (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("/jump requires interactive mode", "error");
			return;
		}
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
				return new JumpOverlay(tui, theme, keybindings, located.transcript.stops, done, (m) =>
					ctx.ui.notify(m, "error"),
				);
			},
			{
				overlay: true,
				overlayOptions: { anchor: "bottom-center", width: "100%", maxHeight: `${HEIGHT_FRACTION * 100}%` },
			},
		);
	};

	pi.registerCommand("jump", {
		description: "Jump through every stop in the conversation (messages, thinking, tool calls)",
		handler: async (_args, ctx) => open(ctx),
	});

	pi.registerShortcut("ctrl+shift+j", {
		description: "Open the /jump conversation index",
		handler: async (ctx) => open(ctx),
	});
}
