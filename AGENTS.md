# AGENTS.md

## Before working on the extension

This repo is a pi extension. Before you change extension code, read:

1. [`extensions.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md): the extension API, lifecycle, and conventions. Read it in full.
2. The rest of the [pi coding-agent docs](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs): follow every cross-reference from `extensions.md` that touches your change (e.g. `tui.md` for UI components, `keybindings.md` for key handling).

You're done with this step when you can name the API surface your change touches and the doc section that defines it.

## Repo map

`/jump` opens an overlay listing every stop in the transcript and scrolls the fullscreen view to the selected one.

- `extensions/pi-jump.ts`: entry. Registers `/jump` and `ctrl+shift+j`, forwards agent events to the open list, closes it on `session_shutdown`.
- `src/adapter.ts`: reaches into pi's TUI internals (private `getPrimaryScrollView`, `currentLayout`) to find the transcript and scroll it.
- `src/stops.ts`: turns transcript components into stops by duck-typing pi's private component fields.
- `src/overlay.ts`: the list component (rendering, keys, refresh timers).
- `README.md`: user docs, plus the full list of pi internals relied on. Keep that list current.

## Setup and checks

Run `npm run link-pi` first. It symlinks the installed pi's packages to `.pi-host/` (git-ignored), which supplies the types and lets the tests load `@earendil-works/pi-tui`. Re-run it after a pi upgrade.

Before committing, run `npm run typecheck` and `npm test`. Both must pass.

## Working on pi internals

The docs do not cover pi's private internals. When a change touches `adapter.ts` or `stops.ts`, verify the behaviour in the installed pi's source under `.pi-host/` (`pi-tui/dist`, `pi-coding-agent/dist/modes/interactive`), not from memory. Then update the version in the comments and in the README's internals list.

## Constraints

- Use erasable TypeScript only (no parameter properties or enums). `node --test` runs the `.ts` sources directly, and `erasableSyntaxOnly` enforces this.
- List pi packages only as optional `*` peer dependencies. Never add them to `dependencies` or `devDependencies`.
- Write tests against fakes shaped like pi's components (see `test/`); there is no real pi at test time.
