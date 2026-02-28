#!/bin/bash
# Patch follow-redirects to work with Bun's stricter Error.captureStackTrace
# Bun throws "TypeError: First argument must be an Error object" when
# Error.captureStackTrace is called on a prototype object during
# follow-redirects module initialization.

FOLLOW_REDIRECTS="node_modules/.bun/follow-redirects@*/node_modules/follow-redirects/index.js"

for f in $FOLLOW_REDIRECTS; do
  if [ -f "$f" ]; then
    if ! grep -q "Bun compat" "$f"; then
      sed -i 's/Error.captureStackTrace(this, this.constructor);/try { Error.captureStackTrace(this, this.constructor); } catch (_) { \/* Bun compat *\/ }/' "$f"
      echo "Patched: $f"
    else
      echo "Already patched: $f"
    fi
  fi
done
