import assert from "node:assert/strict";
import { test } from "node:test";
import { locateTranscript } from "../src/adapter.ts";
import { assistantBlocks, collectStops, type ComponentLike, firstLine, nextTurn, refind, type Stop } from "../src/stops.ts";

// ---- fakes shaped like pi 7.x transcript components ----

const lines = (n: number, text = "x"): string[] => Array.from({ length: n }, () => text);

function box(children: ComponentLike[], extra: Record<string, unknown> = {}): ComponentLike {
	return { children, render: (w) => children.flatMap((c) => c.render(w)), ...extra };
}
function leaf(rendered: string[]): ComponentLike {
	return { render: () => rendered };
}
const spacer = (n = 1) => leaf(lines(n, ""));

function user(text: string, height = 3): ComponentLike {
	return { text, markdownTransformers: [], rebuild() {}, render: () => ["\x1b]133;A\x07 ", ...lines(height - 1)] };
}
function tool(name: string, args: unknown, height = 4): ComponentLike {
	// pi: Spacer(1) then a padded box
	return { toolName: name, toolCallId: `id-${name}`, args, render: () => ["", ...lines(height - 1)] };
}
function assistant(content: unknown[], parts: ComponentLike[]): ComponentLike {
	const contentContainer = box(parts);
	return box([contentContainer], { contentContainer, hasToolCalls: false, lastMessage: { content } });
}

// ---- tests ----

test("firstLine collapses whitespace and skips blank lines", () => {
	assert.equal(firstLine("\n\n  hello   world \nnext"), "hello world");
	assert.equal(firstLine(""), "");
});

test("assistantBlocks merges consecutive thinking and drops empties", () => {
	const blocks = assistantBlocks({
		content: [
			{ type: "thinking", thinking: "a" },
			{ type: "thinking", thinking: "  " },
			{ type: "thinking", thinking: "b" },
			{ type: "text", text: "  " },
			{ type: "text", text: "answer" },
			{ type: "toolCall" },
			{ type: "thinking", thinking: "" },
		],
	});
	assert.deepEqual(blocks, [
		{ kind: "thinking", text: "a\n\nb" },
		{ kind: "text", text: "answer" },
	]);
});

test("collectStops maps each stop to its row and nests turn content", () => {
	const chat = box([
		leaf(["startup", "border"]), // rows 0-1: ignored
		spacer(), // row 2
		user("fix the test\nplease"), // rows 3-5
		assistant(
			[
				{ type: "thinking", thinking: "Mock is wrong" },
				{ type: "text", text: "Running tests" },
				{ type: "toolCall" },
			],
			[spacer(), leaf(lines(2, "think")), spacer(), leaf(lines(3, "text"))],
		), // rows 6-12: spacer@6, thinking@7-8, spacer@9, text@10-12
		tool("bash", { command: "npm test\n--watch" }), // rows 13-16, content at 14
		tool("edit", { path: "src/auth.ts" }), // rows 17-20, content at 18
	]);

	const stops = collectStops(chat, 80, 100);
	assert.deepEqual(
		stops.map((s) => [s.kind, s.label, s.preview, s.depth, s.row]),
		[
			["user", "user", "fix the test", 0, 103],
			["thinking", "think", "Mock is wrong", 1, 107],
			["text", "text", "Running tests", 1, 110],
			["tool", "bash", "npm test", 1, 114],
			["tool", "edit", "src/auth.ts", 1, 118],
		],
	);
});

test("collectStops handles bash, compaction, skill, custom, branch, hidden and unknown components", () => {
	const chat = box([
		{ message: { role: "compactionSummary", tokensBefore: 12345, summary: "s" }, render: () => lines(3) },
		{ skillBlock: { name: "tdd" }, render: () => lines(2) },
		{ command: "ls -la", outputLines: [], render: () => lines(2) },
		{ toolName: "read", toolCallId: "x", args: {}, render: () => [] }, // hidden tool: no stop
		{ customType: "note", render: () => lines(5) }, // unrecognised component: skipped
		{ message: { role: "custom", customType: "subagent", content: [{ type: "image" }, { type: "text", text: "\nReview done\nmore" }] }, render: () => lines(2) },
		{ message: { role: "custom", customType: "note", content: "plain string" }, render: () => lines(1) },
		{ message: { role: "branchSummary", summary: "Tried approach A\n..." }, render: () => lines(3) },
		tool("grep", { pattern: "foo" }),
	]);
	const stops = collectStops(chat, 80, 0);
	assert.deepEqual(
		stops.map((s) => [s.kind, s.preview, s.depth, s.row]),
		[
			["compaction", (12345).toLocaleString() + " tokens", 0, 0],
			["skill", "tdd", 0, 3],
			["bash", "ls -la", 0, 5],
			["custom", "Review done", 0, 12],
			["custom", "plain string", 0, 14],
			["branch", "Tried approach A", 0, 15],
			["tool", "foo", 0, 19], // branch summary ends the turn
		],
	);
});

test("nextTurn moves between user-level stops, skipping nested entries", () => {
	const kinds = ["user", "thinking", "tool", "user", "text", "skill", "tool"] as const;
	const stops = kinds.map((kind) => ({ kind }) as Stop);
	assert.equal(nextTurn(stops, 0, 1), 3);
	assert.equal(nextTurn(stops, 3, 1), 5);
	assert.equal(nextTurn(stops, 6, 1), 6); // no later user stop: stay
	assert.equal(nextTurn(stops, 4, -1), 3); // from inside a turn: back to its user message
	assert.equal(nextTurn(stops, 3, -1), 0);
	assert.equal(nextTurn(stops, 0, -1), 0);
});

test("refind locates the same stop after rows shift", () => {
	const a = assistant([{ type: "text", text: "hi" }], [spacer(), leaf(["hi"])]);
	const before = collectStops(box([user("q"), a]), 80, 0);
	const after = collectStops(box([leaf(lines(10)), user("q"), a]), 80, 0);
	const target = before.find((s) => s.kind === "text")!;
	assert.equal(target.row, 4);
	assert.equal(refind(after, target)?.row, 14);
});

test("locateTranscript finds the chat container through the layout frame", () => {
	const scrollView = { scrollTop: 0, scrollTo() {}, scrollToEnd() {} };
	const chat = box([user("hello")]);
	const document = box([leaf(lines(4)), leaf(lines(2)), chat]);
	const tui = {
		mode: "fullscreen",
		getPrimaryScrollView: () => scrollView,
		currentLayout: { root: { children: [{ scrollView, children: [{ component: document, rect: { width: 80 } }] }] } },
	};
	const result = locateTranscript(tui);
	assert.ok(result.ok);
	assert.equal(result.transcript.scrollView, scrollView);
	assert.deepEqual(
		result.transcript.stops.map((s) => [s.kind, s.row]),
		[["user", 6]],
	);
});

test("locateTranscript reports regular mode and missing internals", () => {
	const regular = locateTranscript({ mode: "regular" });
	assert.ok(!regular.ok && /fullscreen/.test(regular.reason));
	const changed = locateTranscript({ mode: "fullscreen" });
	assert.ok(!changed.ok && /internals changed/.test(changed.reason));
});
