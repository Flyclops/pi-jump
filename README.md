# pi-jump

A `/tree`-style index of every stop in the current pi conversation, in a bottom overlay. Moving the highlight scrolls pi's main transcript to that stop, so you can skim a long session without reading every line.

```
─ jump · 4/5 ───────────────────────────────────────────
 › user     fix the failing test in auth.ts
   ∴ think  The test fails because the mock…
   ◆ text   Running the tests first.
▸  ⚙ bash   npm test -- auth
   ◆ text   Fixed. The mock was returning…
 ↑↓ step · ←→ user msgs · enter/esc close
```

## Use

| Key | Action |
|---|---|
| `/jump` or `ctrl+shift+j` | Open the index (the transcript doesn't move until you do) |
| `↑` / `↓`, `pgup` / `pgdn`, `home` / `end` | Move and jump: the stop is placed near the top of the transcript, with 1 line of context above |
| `←` / `→` | Jump to the previous / next user message, skipping the entries under it |
| `enter` / `esc` | Close, leaving the transcript where it is |

Stops: user messages `›`, skill invocations `✦`, thinking `∴` (one per run of consecutive thinking blocks), assistant text `◆`, tool calls `⚙` (scroll down from a call to see its result), `!bash` executions `$`, compaction summaries `≡`, branch summaries `↳` (from `/tree` branch switches), and visible extension messages `◇` (labelled with their message type, e.g. `◇ subagent`). The startup header is skipped.

The list updates live (every 250 ms) as background work adds stops. The highlight stays on the same stop. Each jump also recalculates the target row first, so it stays accurate while the agent streams.

Tuning constants live at the top of `src/overlay.ts`: `HEIGHT_FRACTION` (0.35), `TOP_PADDING` (1), `REFRESH_MS` (250).

Note: in terminals without the kitty keyboard protocol, `ctrl+shift+j` may be indistinguishable from `ctrl+j` (newline). Use `/jump` there.

## Requirements

- Pi's **fullscreen** mode (`tuiMode: "fullscreen"`, the default). In regular mode the terminal owns scrollback, so nothing can scroll it; `/jump` reports this.
- Relies on pi internals, read-only (see below). If they change, `/jump` reports `pi internals changed; /jump unavailable` and pi itself is unaffected.

## Install

Not published to npm; install from GitHub or a local clone.

**From GitHub** (pi clones it and keeps it updated):

```bash
pi install git:github.com/Flyclops/pi-jump            # track main
pi install git:github.com/Flyclops/pi-jump@<tag|sha>  # pin a version
pi install https://github.com/Flyclops/pi-jump        # same as git:, by URL
```

**From a local clone** (loaded in place, not copied; edits apply after `/reload` or a new session):

```bash
git clone https://github.com/Flyclops/pi-jump.git
pi install ./pi-jump
```

**For one project only:** add `-l` / `--local` to any `pi install` above. It's then recorded in that project's `.pi/settings.json` instead of `~/.pi/agent/settings.json`, and loads only after you trust the project.

**Try without installing** (one session only):

```bash
pi -e git:github.com/Flyclops/pi-jump
pi -e ./pi-jump/extensions/jump.ts
```

Don't combine `-e` with an installed copy, or `/jump` registers twice.

**Manage:**

```bash
pi list                                           # show installed packages
pi update git:github.com/Flyclops/pi-jump         # pull the latest (unpinned installs)
pi remove git:github.com/Flyclops/pi-jump         # uninstall
```

Then run `/reload` in open sessions, or start a new one.

## Develop

```bash
npm install          # typescript only; pi packages are NOT installed (pi supplies them)
npm run link-pi      # symlink the installed pi's packages to .pi-host/ for types
npm run typecheck
npm test             # node --test; Node ≥ 23 runs the .ts files directly
```

Layout:

- `extensions/jump.ts`: entry; registers `/jump` and `ctrl+shift+j`.
- `src/stops.ts`: pure logic. Recognises pi's transcript components by shape and turns them into stops with rows. Unit-tested with fake components.
- `src/adapter.ts`: **the only file that touches pi internals.**
- `src/overlay.ts`: the bottom-overlay list component.

## Pi internals relied on

Read-only, all in `src/adapter.ts` and `src/stops.ts` (verified against pi 1.4.0):

- `TuiAltScreen.getPrimaryScrollView()` and `TuiAltScreen.currentLayout`: TypeScript-`private`, reachable at runtime.
- Layout frame: the box whose `scrollView` is the primary scroll view; its first child's `component` is pi's document container, and its `rect.width` is the transcript content width.
- Document container children: `[header, loadedResources, chatContainer]`.
- Component shapes: tool executions (`toolCallId`, `toolName`, `args`), assistant messages (`contentContainer`, `lastMessage`, `hasToolCalls`), user messages (`text`, `markdownTransformers`), skill invocations (`skillBlock`), bash executions (`command`, `outputLines`), compaction summaries, branch summaries and extension messages (`message.role` of `"compactionSummary"`, `"branchSummary"`, `"custom"`).
- Scrolling uses the scroll view's own `scrollTo(row, { disableFollow: true })`, as pi's transcript search does.

## Proposed public API

Two `ctx.ui` methods would remove every internals dependency:

```ts
interface TranscriptStop {
  kind: "user" | "skill" | "thinking" | "text" | "tool" | "bash" | "compaction" | "branch" | "custom";
  label: string;       // e.g. tool name
  preview: string;     // first line of content
  depth: number;       // 0 = turn level, 1 = within an assistant turn
  row: number;         // row in the transcript scroll content
  entryId?: string;    // session entry id, when the stop maps to one
  blockIndex?: number; // content block within the entry
}

/** Stops in the rendered transcript, in order. Undefined outside fullscreen mode. */
ctx.ui.getTranscriptStops(): TranscriptStop[] | undefined;

/** Scroll the transcript so `row` is at the top; "end" scrolls to the bottom and resumes following. */
ctx.ui.scrollTranscriptTo(row: number | "end"): void;
```
