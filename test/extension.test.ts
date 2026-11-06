import assert from "node:assert/strict";
import { mock, test } from "node:test";
import extension from "../extensions/pi-jump.ts";
import { REFRESH_MS } from "../src/overlay.ts";
import type { ComponentLike } from "../src/stops.ts";

// A fake pi that records registrations and hosts ctx.ui.custom() like interactive mode does.
function fakePi() {
	const handlers = new Map<string, Array<(...a: unknown[]) => unknown>>();
	const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
	const pi = {
		registerCommand: (name: string, o: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, o),
		registerShortcut: () => {},
		on: (event: string, h: (...a: unknown[]) => unknown) => handlers.set(event, [...(handlers.get(event) ?? []), h]),
	};
	const emit = (event: string) => handlers.get(event)?.forEach((h) => h({}, {}));
	return { pi, commands, emit };
}

function fakeTui() {
	let scans = 0;
	const chatChildren: ComponentLike[] = [{ text: "hello", markdownTransformers: [], render: () => ["hello"] }];
	const chat: ComponentLike = {
		get children() {
			scans++;
			return chatChildren;
		},
		render: () => [],
	};
	const document: ComponentLike = { children: [{ render: () => [] }, { render: () => [] }, chat], render: () => [] };
	const scrollView = { scrollTo() {} };
	return {
		tui: {
			mode: "fullscreen",
			terminal: { rows: 24 },
			requestRender() {},
			getPrimaryScrollView: () => scrollView,
			currentLayout: { root: { scrollView, children: [{ component: document, rect: { width: 80 } }] } },
		},
		scans: () => scans,
	};
}

test("/jump refreshes on agent events and closes on session shutdown", async (t) => {
	mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	t.after(() => mock.timers.reset());
	const { pi, commands, emit } = fakePi();
	extension(pi as never);
	const { tui, scans } = fakeTui();

	let disposed = false;
	const ctx = {
		mode: "tui",
		ui: {
			notify: () => {},
			custom: (factory: (...a: unknown[]) => { dispose?: () => void }) =>
				new Promise<void>((resolve) => {
					let component: { dispose?: () => void } | undefined;
					const done = () => {
						resolve();
						component?.dispose?.();
						disposed = true;
					};
					component = factory(tui, { fg: (_: string, s: string) => s, bg: (_: string, s: string) => s }, { matches: () => false }, done);
				}),
		},
	};

	const opened = commands.get("jump")!.handler("", ctx);
	const afterOpen = scans();

	emit("message_update");
	emit("message_update");
	mock.timers.tick(REFRESH_MS);
	assert.equal(scans(), afterOpen + 1, "a burst of events refreshes once");

	emit("session_shutdown");
	await opened;
	assert.ok(disposed, "shutdown closed and disposed the list");

	emit("message_update"); // no list open: nothing to refresh
	mock.timers.tick(REFRESH_MS * 10);
	assert.equal(scans(), afterOpen + 1);
});
