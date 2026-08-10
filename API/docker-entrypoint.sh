#!/bin/sh
set -e
cd /server

NEEDS_INSTALL=0
if [ ! -d node_modules ] || [ ! -f node_modules/.bun-install-marker ]; then
  NEEDS_INSTALL=1
elif [ package.json -nt node_modules/.bun-install-marker ]; then
  NEEDS_INSTALL=1
fi

# Build the vendored @hot-updater/bsdiff fork when dist/ is missing or stale.
# The wasm is committed, so build-wasm.mjs falls back to it — no Rust needed.
BSDIFF_DIR=vendor/bsdiff
BSDIFF_ENTRY="$BSDIFF_DIR/dist/node.js"
NEED_BUILD=0
if [ ! -f "$BSDIFF_ENTRY" ]; then
  NEED_BUILD=1
elif [ -n "$(find "$BSDIFF_DIR/src" "$BSDIFF_DIR/rust" "$BSDIFF_DIR/assets" "$BSDIFF_DIR/scripts" "$BSDIFF_DIR/package.json" "$BSDIFF_DIR/bun.lock" "$BSDIFF_DIR/tsconfig.json" "$BSDIFF_DIR/tsconfig.build.json" "$BSDIFF_DIR/tsdown.config.ts" -newer "$BSDIFF_ENTRY" 2>/dev/null || true)" ]; then
  NEED_BUILD=1
fi
if [ "$NEED_BUILD" = "1" ]; then
  echo "[entrypoint] building @hot-updater/bsdiff fork..."
  ( cd "$BSDIFF_DIR" && bun install --frozen-lockfile && bun run build )
  NEEDS_INSTALL=1
fi

if [ "$NEEDS_INSTALL" = "1" ]; then
  echo "[entrypoint] running bun install..."
  if [ -f bun.lock ] || [ -f bun.lockb ]; then
    bun install --frozen-lockfile
  else
    bun install
  fi
  touch node_modules/.bun-install-marker
fi

exec bun --watch --inspect=0.0.0.0:9229 run src/index.ts
