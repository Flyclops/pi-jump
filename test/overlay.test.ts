import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { JumpOverlay } from "../src/overlay.ts";
import type { Stop, StopKind } from "../src/stops.ts";

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

test("a height-only resize re-sizes the list instead of reusing the cached frame", () => {
	const tui = fakeTui(60);
	const o = overlay(tui);
	const tall = o.render(80).length;
	tui.terminal.rows = 8;
	const short = o.render(80).length;
	assert.ok(short < tall, `expected fewer lines after shrinking (${tall} -> ${short})`);
	assert.ok(short <= 8);
});
