#!/bin/sh
# Symlink the installed pi's packages to .pi-host/ so `npm run typecheck` can resolve
# @earendil-works/* types without installing a second copy into node_modules (which pi warns about).
set -e
dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/install"
version=$(cat "$dir/current-version")
target="$dir/releases/$version/node_modules/@earendil-works"
[ -d "$target" ] || { echo "pi packages not found at $target" >&2; exit 1; }
ln -sfn "$target" .pi-host
echo ".pi-host -> $target"
