/**
 * Pure logic: turn pi's rendered transcript component tree into a list of jump stops.
 *
 * Pi's transcript components are internal, so they are recognised by shape (duck typing),
 * never by class identity. Everything here is plain data in, plain data out, so it can be
 * unit-tested with fake components.
 */

export interface ComponentLike {
	render(width: number): string[];
	children?: ComponentLike[];
	[key: string]: unknown;
}

export type StopKind = "user" | "skill" | "thinking" | "text" | "tool" | "bash" | "compaction" | "branch" | "custom";

export interface Stop {
	kind: StopKind;
	/** Short label shown after the marker, e.g. the tool name. */
	label: string;
	/** First line of content, whitespace-collapsed. */
	preview: string;
	/** 0 = turn level, 1 = nested under the preceding user message. */
	depth: number;
	/** Row in the transcript scroll content where this stop starts. */
	row: number;
	/** Identity used to re-find the stop after the transcript re-renders. */
	component: ComponentLike;
	blockIndex: number;
}

type Block = { kind: "text" | "thinking"; text: string };

interface AssistantMessageLike {
	content: Array<{ type: string; text?: string; thinking?: string }>;
}

/** Collapse whitespace and take the first non-empty line. */
export function firstLine(text: string): string {
	for (const line of text.split("\n")) {
		const trimmed = line.replace(/\s+/g, " ").trim();
		if (trimmed) return trimmed;
	}
	return "";
}

/**
 * Visible blocks of an assistant message, in the same order and grouping that pi's
 * AssistantMessageComponent renders them: non-empty text blocks individually, and each run
 * of consecutive thinking blocks as one block (empty ones dropped).
 */
export function assistantBlocks(message: AssistantMessageLike): Block[] {
	const blocks: Block[] = [];
	const content = message.content ?? [];
	for (let i = 0; i < content.length; i++) {
		const c = content[i]!;
		if (c.type === "text" && c.text?.trim()) {
			blocks.push({ kind: "text", text: c.text.trim() });
		} else if (c.type === "thinking") {
			const parts: string[] = [];
			for (; i < content.length && content[i]!.type === "thinking"; i++) {
				const t = content[i]!.thinking?.trim();
				if (t) parts.push(t);
			}
			i--;
			if (parts.length) blocks.push({ kind: "thinking", text: parts.join("\n\n") });
		}
	}
	return blocks;
}

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

function isBlankLine(line: string): boolean {
	return line.replace(ANSI, "").trim() === "";
}

/** Number of literally empty leading lines (Spacer output), so a stop lands on real content. */
function leadingEmpty(lines: string[]): number {
	let n = 0;
	while (n < lines.length && lines[n] === "") n++;
	return n;
}

function str(v: unknown): string | undefined {
	return typeof v === "string" ? v : undefined;
}

/** Text of a message's content: a string, or an array of blocks of which only text blocks count. */
function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((c) => (c && typeof c === "object" && (c as { type?: unknown }).type === "text" ? (str((c as { text?: unknown }).text) ?? "") : ""))
		.join("\n");
}

function toolPreview(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const a = args as Record<string, unknown>;
	for (const key of ["command", "path", "file_path", "pattern", "query", "url"]) {
		const v = str(a[key]);
		if (v) return firstLine(v);
	}
	try {
		return firstLine(JSON.stringify(a));
	} catch {
		return "";
	}
}

type Shape =
	| { type: "tool" }
	| { type: "assistant" }
	| { type: "skill" }
	| { type: "user" }
	| { type: "bash" }
	| { type: "compaction" }
	| { type: "branch" }
	| { type: "custom" }
	| { type: "other" };

export function classify(c: ComponentLike): Shape {
	if (typeof c.toolCallId === "string" && typeof c.toolName === "string") return { type: "tool" };
	if (c.contentContainer && "hasToolCalls" in c && "lastMessage" in c) return { type: "assistant" };
	if (c.skillBlock && typeof c.skillBlock === "object") return { type: "skill" };
	if (typeof c.text === "string" && "markdownTransformers" in c) return { type: "user" };
	if (typeof c.command === "string" && "outputLines" in c) return { type: "bash" };
	const msg = c.message as { role?: unknown } | undefined;
	if (msg && typeof msg === "object") {
		if (msg.role === "compactionSummary") return { type: "compaction" };
		if (msg.role === "branchSummary") return { type: "branch" };
		if (msg.role === "custom") return { type: "custom" };
	}
	return { type: "other" };
}

/**
 * Walk the chat container's children and produce stops.
 * @param chat    pi's chatContainer
 * @param width   content width the transcript is rendered at
 * @param baseRow row of the chat container's first line within the scroll content
 */
export function collectStops(chat: ComponentLike, width: number, baseRow: number): Stop[] {
	const stops: Stop[] = [];
	let row = baseRow;
	let inTurn = false;

	for (const child of chat.children ?? []) {
		const lines = child.render(width);
		const height = lines.length;
		if (height === 0) continue;
		const at = row + Math.min(leadingEmpty(lines), height - 1);
		const shape = classify(child);
		const push = (kind: StopKind, label: string, preview: string, depth: number, r = at, blockIndex = 0) =>
			stops.push({ kind, label, preview, depth, row: r, component: child, blockIndex });

		switch (shape.type) {
			case "user":
				inTurn = true;
				push("user", "user", firstLine(str(child.text) ?? ""), 0);
				break;
			case "skill": {
				inTurn = true;
				const sb = child.skillBlock as { name?: unknown };
				push("skill", "skill", str(sb.name) ?? "", 0);
				break;
			}
			case "bash":
				push("bash", "!bash", firstLine(str(child.command) ?? ""), 0);
				break;
			case "compaction": {
				const msg = child.message as { summary?: unknown; tokensBefore?: unknown };
				const tokens = typeof msg.tokensBefore === "number" ? `${msg.tokensBefore.toLocaleString()} tokens` : "";
				push("compaction", "compact", tokens || firstLine(str(msg.summary) ?? ""), 0);
				inTurn = false;
				break;
			}
			case "branch": {
				const msg = child.message as { summary?: unknown };
				push("branch", "branch", firstLine(str(msg.summary) ?? ""), 0);
				inTurn = false;
				break;
			}
			case "custom": {
				const msg = child.message as { customType?: unknown; content?: unknown };
				push("custom", str(msg.customType) || "custom", firstLine(contentText(msg.content)), 0);
				break;
			}
			case "tool":
				push("tool", str(child.toolName) ?? "tool", toolPreview(child.args), inTurn ? 1 : 0);
				break;
			case "assistant":
				collectAssistant(child, width, row, inTurn ? 1 : 0, stops);
				break;
			default:
				break;
		}
		row += height;
	}
	return stops;
}

function collectAssistant(child: ComponentLike, width: number, row: number, depth: number, stops: Stop[]): void {
	const message = child.lastMessage as AssistantMessageLike | undefined;
	const content = child.contentContainer as ComponentLike | undefined;
	if (!message || !content) return;
	const blocks = assistantBlocks(message);
	// The assistant component may render content above contentContainer; locate it among its children.
	let offset = row;
	for (const c of child.children ?? []) {
		if (c === content) break;
		offset += c.render(width).length;
	}
	let next = 0;
	for (const part of content.children ?? []) {
		const lines = part.render(width);
		if (next < blocks.length && lines.length > 0 && !lines.every(isBlankLine)) {
			const block = blocks[next]!;
			stops.push({
				kind: block.kind,
				label: block.kind === "thinking" ? "think" : "text",
				preview: firstLine(block.text),
				depth,
				row: offset,
				component: child,
				blockIndex: next,
			});
			next++;
		}
		offset += lines.length;
	}
}

const TURN_KINDS: ReadonlySet<StopKind> = new Set(["user", "skill"]);

/**
 * Index of the next (dir 1) or previous (dir -1) user-level stop from `from`, skipping the
 * entries nested under each user message. Returns `from` when there is none in that direction.
 */
export function nextTurn(stops: Stop[], from: number, dir: 1 | -1): number {
	for (let i = from + dir; i >= 0 && i < stops.length; i += dir) {
		if (TURN_KINDS.has(stops[i]!.kind)) return i;
	}
	return from;
}

/** Find the current row of a previously collected stop in a fresh list. */
export function refind(stops: Stop[], target: Pick<Stop, "component" | "blockIndex">): Stop | undefined {
	return stops.find((s) => s.component === target.component && s.blockIndex === target.blockIndex);
}
