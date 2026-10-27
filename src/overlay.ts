import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { locateTranscript, scrollToRow } from "./adapter.ts";
import { nextTurn, refind, type Stop, type StopKind } from "./stops.ts";

const MARKERS: Record<StopKind, string> = {
	user: "›",
	skill: "✦",
	thinking: "∴",
	text: "◆",
	tool: "⚙",
	bash: "$",
	compaction: "≡",
	branch: "↳",
	custom: "◇",
};

export const HEIGHT_FRACTION = 0.35;
export const MIN_HEIGHT = 6;
/** Lines of context kept above a jumped-to stop. */
export const TOP_PADDING = 1;
/** How often the open list re-reads the transcript to pick up new work. */
export const REFRESH_MS = 250;

function signature(stops: Stop[]): string {
	return stops.map((s) => `${s.kind}\u0000${s.depth}\u0000${s.label}\u0000${s.preview}`).join("\u0001");
}

interface TuiLike {
	terminal?: { rows?: number };
	requestRender(): void;
}

export class JumpOverlay {
	private selected: number;
	private top = 0;
	private cache?: { width: number; lines: string[] };
	private timer: ReturnType<typeof setInterval>;
	private sig: string;

	constructor(
		private readonly tui: TuiLike,
		private readonly theme: Theme,
		private readonly keybindings: KeybindingsManager,
		private stops: Stop[],
		private readonly done: (result: void) => void,
		private readonly notify: (message: string) => void,
	) {
		// Start on the newest stop, but do not jump until the user moves.
		this.selected = Math.max(0, stops.length - 1);
		this.sig = signature(stops);
		this.timer = setInterval(() => this.refresh(), REFRESH_MS);
	}

	dispose(): void {
		clearInterval(this.timer);
	}

	/** Pick up stops added (or previews changed) by background work while the list is open. */
	private refresh(): void {
		const located = locateTranscript(this.tui);
		if (!located.ok) return;
		this.adopt(located.transcript.stops);
	}

	/** Replace the stop list, keeping the highlight on the same stop. */
	private adopt(fresh: Stop[]): void {
		if (fresh.length === 0) return;
		const current = this.stops[this.selected];
		const sig = signature(fresh);
		this.stops = fresh;
		if (current) {
			const i = fresh.findIndex((s) => s.component === current.component && s.blockIndex === current.blockIndex);
			this.selected = i >= 0 ? i : Math.min(this.selected, fresh.length - 1);
		}
		if (sig !== this.sig) {
			this.sig = sig;
			this.invalidate();
			this.tui.requestRender();
		}
	}

	private height(): number {
		const rows = this.tui.terminal?.rows ?? 24;
		return Math.max(MIN_HEIGHT, Math.floor(rows * HEIGHT_FRACTION));
	}

	private listRows(): number {
		return Math.max(1, this.height() - 2);
	}

	handleInput(data: string): void {
		const kb = this.keybindings;
		const last = this.stops.length - 1;
		let next = this.selected;

		if (kb.matches(data, "tui.select.cancel") || kb.matches(data, "tui.select.confirm")) {
			this.done();
			return;
		} else if (kb.matches(data, "tui.select.up")) next--;
		else if (kb.matches(data, "tui.select.down")) next++;
		else if (kb.matches(data, "tui.select.pageUp")) next -= this.listRows();
		else if (kb.matches(data, "tui.select.pageDown")) next += this.listRows();
		else if (matchesKey(data, "left")) next = nextTurn(this.stops, this.selected, -1);
		else if (matchesKey(data, "right")) next = nextTurn(this.stops, this.selected, 1);
		else if (matchesKey(data, "home")) next = 0;
		else if (matchesKey(data, "end")) next = last;
		else return;

		next = Math.max(0, Math.min(last, next));
		if (next === this.selected) return;
		this.selected = next;
		this.jump();
		this.invalidate();
		this.tui.requestRender();
	}

	/** Recompute rows right before jumping so streaming output can't make us land in the wrong place. */
	private jump(): void {
		const target = this.stops[this.selected];
		if (!target) return;
		const located = locateTranscript(this.tui);
		if (!located.ok) {
			this.notify(located.reason);
			return;
		}
		const { scrollView, stops } = located.transcript;
		const fresh = refind(stops, target);
		this.adopt(stops);
		scrollToRow(this.tui, scrollView, Math.max(0, (fresh?.row ?? target.row) - TOP_PADDING));
	}

	invalidate(): void {
		this.cache = undefined;
	}

	render(width: number): string[] {
		if (this.cache && this.cache.width === width) return this.cache.lines;
		const th = this.theme;
		const rows = this.listRows();

		if (this.selected < this.top) this.top = this.selected;
		if (this.selected >= this.top + rows) this.top = this.selected - rows + 1;
		this.top = Math.max(0, Math.min(this.top, Math.max(0, this.stops.length - rows)));

		const title = ` jump · ${this.selected + 1}/${this.stops.length} `;
		const lines: string[] = [th.fg("border", "─") + th.fg("accent", title) + th.fg("border", "─".repeat(Math.max(0, width - visibleWidth(title) - 1)))];

		for (let i = 0; i < rows; i++) {
			const stop = this.stops[this.top + i];
			if (!stop) {
				lines.push("");
				continue;
			}
			const isSel = this.top + i === this.selected;
			const indent = "  ".repeat(stop.depth);
			const marker = MARKERS[stop.kind];
			const label = stop.label.length > 8 ? stop.label.slice(0, 8) : stop.label.padEnd(8);
			const plain = `${isSel ? "▸" : " "}${indent}${marker} ${label} `;
			let line = isSel
				? th.fg("accent", plain) + th.fg("text", stop.preview)
				: th.fg("dim", plain.slice(0, 1 + indent.length)) +
					th.fg("accent", marker) +
					th.fg("muted", ` ${label} `) +
					th.fg("dim", stop.preview);
			line = truncateToWidth(line, width);
			if (isSel) line = th.bg("selectedBg", line + " ".repeat(Math.max(0, width - visibleWidth(line))));
			lines.push(line);
		}

		lines.push(truncateToWidth(th.fg("dim", " ↑↓ step · ←→ user msgs · enter/esc close"), width));
		this.cache = { width, lines };
		return lines;
	}
}
