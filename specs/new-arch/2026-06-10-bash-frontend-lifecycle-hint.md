# Bash frontend lifecycle hint scope

## Problem

`bash` foreground results always append the process lifecycle hint:

- `packages/opencorvus/src/tool/bash.ts` builds the hint with `foregroundLifecycleHint`.
- The same file appends it for every non-background command after supervisor disposal.
- `packages/opencorvus/test/tool/bash.test.ts` currently asserts the hint for generic `echo` commands.

This wastes model context for short terminal commands where the background-server guidance is irrelevant.

## Decision

Keep the hint single-sourced in `bash.ts`, but only append it for foreground commands that look like frontend server launch commands. The command is already parsed once with tree-sitter for permission metadata, so the same parsed command tokens are reused to classify package-manager and frontend CLI launches.

Covered foreground commands:

- package-manager scripts using `npm`, `pnpm`, `bun`, or `yarn` with `dev`, `start`, `serve`, or `preview`
- package-manager exec/dlx forms that launch known frontend server CLIs
- direct frontend server CLIs such as `vite`, `next`, `nuxt`, and `astro`

Generic commands, including `echo` and package-manager commands that are not server launches, should not receive the foreground lifecycle hint.

## Validation

- Update `packages/opencorvus/test/tool/bash.test.ts` to assert:
  - generic foreground cleanup still disposes the process tree but does not append the lifecycle hint
  - frontend foreground commands append the hint
  - package-manager non-server commands do not append the hint
