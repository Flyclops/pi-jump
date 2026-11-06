/**
 * Test-only: resolve `@earendil-works/*` to the installed pi's packages via `.pi-host/`
 * (created by `npm run link-pi`), mirroring the tsconfig `paths` mapping used for types.
 * Inside pi, the host maps these imports itself; this exists only so `node --test` can
 * load modules that import pi-tui at runtime.
 */
import { registerHooks } from "node:module";

const host = new URL("../../.pi-host/", import.meta.url);

registerHooks({
	resolve(specifier, context, next) {
		const m = /^@earendil-works\/([^/]+)$/.exec(specifier);
		if (m) return next(new URL(`${m[1]}/dist/index.js`, host).href, context);
		return next(specifier, context);
	},
});
