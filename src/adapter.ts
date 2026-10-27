/**
 * The ONLY file that touches pi internals. Everything here is read-only, except calling the
 * transcript ScrollView's own scroll methods (the same ones pi's transcript search uses).
 *
 * Internals relied on (pi 7.x):
 *   - tui.getPrimaryScrollView()            (TS-private on TuiAltScreen)
 *   - tui.currentLayout                     (TS-private; last rendered layout frame)
 *   - layout box { scrollView, children[0] = { component: documentContainer, rect } }
 *   - documentContainer.children = [header, loadedResources, chatContainer]
 *
 * Proposed public replacement: see README "Proposed public API".
 */
import { collectStops, type ComponentLike, type Stop } from "./stops.ts";

export interface ScrollViewLike {
	scrollTop: number;
	scrollTo(row: number, options?: { disableFollow?: boolean }): void;
}

interface LayoutBox {
	component?: unknown;
	rect?: { width: number };
	children?: LayoutBox[];
	scrollView?: unknown;
	scrollContentLines?: string[];
}

export interface Transcript {
	scrollView: ScrollViewLike;
	stops: Stop[];
}

export type LocateResult = { ok: true; transcript: Transcript } | { ok: false; reason: string };

const INTERNALS_CHANGED = "pi internals changed; /jump unavailable";

function findScrollBox(box: LayoutBox | undefined, scrollView: unknown): LayoutBox | undefined {
	if (!box) return undefined;
	if (box.scrollView === scrollView) return box;
	for (const child of box.children ?? []) {
		const found = findScrollBox(child, scrollView);
		if (found) return found;
	}
	return undefined;
}

function isComponent(v: unknown): v is ComponentLike {
	return !!v && typeof (v as ComponentLike).render === "function";
}

/** Pick pi's chatContainer out of the document container's children. */
function findChat(document: ComponentLike): { chat: ComponentLike; index: number } | undefined {
	const kids = document.children ?? [];
	// pi 7.x: [header, loadedResources, chat]. Fall back to the child with the most children.
	if (kids.length === 3 && isComponent(kids[2])) return { chat: kids[2], index: 2 };
	let best = -1;
	for (let i = 0; i < kids.length; i++) {
		if (best < 0 || (kids[i]!.children?.length ?? 0) > (kids[best]!.children?.length ?? 0)) best = i;
	}
	return best >= 0 ? { chat: kids[best]!, index: best } : undefined;
}

/** Locate pi's transcript and compute the current stops. Call right before every jump. */
export function locateTranscript(tui: unknown): LocateResult {
	const t = tui as { mode?: unknown; getPrimaryScrollView?: unknown; currentLayout?: { root?: LayoutBox } };
	if (t.mode !== "fullscreen") return { ok: false, reason: "/jump requires pi's fullscreen mode (tuiMode: \"fullscreen\")" };
	if (typeof t.getPrimaryScrollView !== "function") return { ok: false, reason: INTERNALS_CHANGED };

	let scrollView: ScrollViewLike;
	try {
		scrollView = (t.getPrimaryScrollView as () => ScrollViewLike).call(tui);
	} catch {
		return { ok: false, reason: INTERNALS_CHANGED };
	}
	if (!scrollView || typeof scrollView.scrollTo !== "function") {
		return { ok: false, reason: INTERNALS_CHANGED };
	}

	const layout = t.currentLayout;
	const root = (layout?.root ?? layout) as LayoutBox | undefined;
	const box = findScrollBox(root, scrollView);
	const contentBox = box?.children?.[0];
	const document = contentBox?.component;
	const width = contentBox?.rect?.width;
	if (!isComponent(document) || typeof width !== "number") return { ok: false, reason: INTERNALS_CHANGED };

	const found = findChat(document);
	if (!found) return { ok: false, reason: INTERNALS_CHANGED };

	let baseRow = 0;
	const kids = document.children ?? [];
	for (let i = 0; i < found.index; i++) baseRow += kids[i]!.render(width).length;

	return { ok: true, transcript: { scrollView, stops: collectStops(found.chat, width, baseRow) } };
}

/** Put `row` at the top of the transcript without re-enabling follow-latest. */
export function scrollToRow(tui: unknown, scrollView: ScrollViewLike, row: number): void {
	scrollView.scrollTo(row, { disableFollow: true });
	(tui as { requestRender?: () => void }).requestRender?.();
}
