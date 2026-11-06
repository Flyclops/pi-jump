import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { IDLE_REFRESH_MS, JumpOverlay, REFRESH_MS } from "../src/overlay.ts";
import type { ComponentLike, Stop, StopKind } from "../src/stops.ts";

// ---- fakes ----

const theme = { fg: (_c: string, t: string) => t, bg: (_c: string, t: string) => t };
const keybindings = { matches: () => false };

function fakeTui(rows: number) {
	return { terminal: { rows }, requestRender() {} };
}

function stop(kind: StopKind, label: string, preview: string, depth = 0): Stop {
	return { kind, label, preview, depth, row: 0, component: { render: () => [] }, blockIndex: 0 };
}

const STOPS = [
	stop("user", "user", "fix the failing test in auth.ts"),
	stop("thinking", "think", "The test fails because the mock is wrong", 1),
	stop("tool", "bash", "npm test -- auth", 1),
	stop("text", "text", "Fixed. The mock was returning the wrong shape", 1),
];

function overlay(tui: ReturnType<typeof fakeTui>, stops = STOPS): JumpOverlay {
	const o = new JumpOverlay(tui as never, theme as never, keybindings as never, stops, () => {}, () => {});
	o.dispose(); // no background refresh in tests
	return o;
}

// ---- tests ----

test("every rendered line fits the width, even on very narrow terminals", () => {
	const o = overlay(fakeTui(40));
	for (let width = 1; width <= 60; width++) {
		o.invalidate();
		for (const line of o.render(width)) {
			assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)} is ${visibleWidth(line)} wide`);
		}
	}
});

test("on short terminals the list shrinks so the key hint stays visible and nothing exceeds the screen", () => {
	for (const rows of [3, 5, 8, 12, 24, 60]) {
		const lines = overlay(fakeTui(rows)).render(80);
		assert.ok(lines.length <= rows, `rows ${rows}: rendered ${lines.length} lines`);
		assert.match(lines.at(-1)!, /close/, `rows ${rows}: last line is the key hint`);
	}
});

test("labels are cut and padded by display width, so previews stay aligned", () => {
	const stops = [stop("custom", "サブエージェント", "wide"), stop("custom", "ノート", "mid"), stop("custom", "note", "narrow")];
	const lines = overlay(fakeTui(40), stops).render(80);
	const column = (preview: string) => {
		const line = lines.find((l) => l.endsWith(preview) || l.trimEnd().endsWith(preview))!;
		return visibleWidth(line.slice(0, line.lastIndexOf(preview)));
	};
	assert.equal(column("wide"), column("narrow"));
	assert.equal(column("mid"), column("narrow"));
});

test("close() ends the interaction once", () => {
	let closed = 0;
	const o = new JumpOverlay(fakeTui(24) as never, theme as never, keybindings as never, STOPS, () => closed++, () => {});
	o.close();
	o.close();
	o.dispose();
	assert.equal(closed, 1);
});

// A fake fullscreen TUI whose transcript we can grow, counting full transcript scans.
function liveTui() {
	let scans = 0;
	const userMsg = (text: string): ComponentLike => ({ text, markdownTransformers: [], render: () => [text] });
	const chatChildren: ComponentLike[] = [userMsg("first")];
	const chat: ComponentLike = {
		get children() {
			scans++;
			return chatChildren;
		},
		render: () => [],
	};
	const document: ComponentLike = { children: [{ render: () => [] }, { render: () => [] }, chat], render: () => [] };
	const scrollView = { scrollTop: 0, scrollTo() {} };
	return {
		tui: {
			mode: "fullscreen",
			terminal: { rows: 24 },
			requestRender() {},
			getPrimaryScrollView: () => scrollView,
			currentLayout: { root: { scrollView, children: [{ component: document, rect: { width: 80 } }] } },
		},
		add: (text: string) => chatChildren.push(userMsg(text)),
		scans: () => scans,
	};
}

test("activity refreshes are coalesced; idle refresh is a slow backup poll", (t) => {
	mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	t.after(() => mock.timers.reset());
	const live = liveTui();
	const o = new JumpOverlay(live.tui as never, theme as never, keybindings as never, [], () => {}, () => {});
	t.after(() => o.dispose());

	// Idle: nothing scans the transcript until the backup poll.
	mock.timers.tick(IDLE_REFRESH_MS - 1);
	assert.equal(live.scans(), 0);
	mock.timers.tick(1);
	assert.equal(live.scans(), 1);
	assert.match(o.render(80)[0]!, /1\/1/);

	// Activity: a burst of events triggers one scan, REFRESH_MS later.
	live.add("second");
	for (let i = 0; i < 20; i++) o.scheduleRefresh();
	mock.timers.tick(REFRESH_MS - 1);
	assert.equal(live.scans(), 1);
	mock.timers.tick(1);
	assert.equal(live.scans(), 2);
	assert.match(o.render(80)[0]!, /\/2/);

	// After dispose, scheduled and backup refreshes stop.
	o.scheduleRefresh();
	o.dispose();
	mock.timers.tick(IDLE_REFRESH_MS * 3);
	assert.equal(live.scans(), 2);
});

test("a height-only resize re-sizes the list instead of reusing the cached frame", () => {
	const tui = fakeTui(60);
	const o = overlay(tui);
	const tall = o.render(80).length;
	tui.terminal.rows = 8;
	const short = o.render(80).length;
	assert.ok(short < tall, `expected fewer lines after shrinking (${tall} -> ${short})`);
	assert.ok(short <= 8);
});
