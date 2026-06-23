# Session Dialog Body Single Source

## Problem

`SessionDialogHost` renders `dialogStore.session.bodyHtml || '<p class="empty-hint">Loading...</p>'`. The session dialog service already owns the loading, empty, display-empty, and error HTML states. The host fallback creates a second visible body source, hides store initialization failures, and uses a different loading string from the service.

## Recall

- `specs/new-arch/2026-06-19-retire-session-dialog-diff-residue.md` moved the live Session dialog to the shared `Dialog` primitive and store-backed title/body ownership.
- `packages/overlay/src/services/dialog.ts` is the service that opens the session dialog and writes `bodyHtml` states.
- `packages/overlay/src/components/SessionDialogHost.tsx` should render the store state only.

## Impact Search

| Search                                                                                                                                                                                                      | Result                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------- | ----------------------- | ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------ | -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `rg -n "SessionDialogHost                                                                                                                                                                                   | sessionDialog                                 | dialogStore\\.session | bodyHtml                | openSessionDialog      | openBuildSessionDialog | Loading\\.\\.\\." packages/overlay/src packages/overlay/test specs/new-arch -g "_.tsx" -g "_.ts" -g "\*.md"` | Host renders a `bodyHtml |          | Loading...` fallback; service writes the real loading, empty, and error body states. |
| `rg -n "Loading\\.\\.\\.                                                                                                                                                                                    | Loading…                                      | No messages yet       | No displayable messages | Failed to load session | bodyHtml \\            | \\                                                                                                           |                          | title \\ | \\                                                                                   | " packages/overlay/src packages/overlay/test -g "_.ts" -g "_.tsx"` | Session body fallback exists in host and service; loading copy differs between `Loading...` and `Loading…`. |
| `git diff -- packages/overlay/src/components/SessionDialogHost.tsx packages/overlay/src/services/dialog.ts packages/overlay/src/store/dialog.ts packages/overlay/test/dialog-service-single-source.test.ts` | No local dirty changes; this is a HEAD issue. |

## Fix Plan

1. Make `SessionDialogHost` render `dialogStore.session.bodyHtml` directly.
2. Replace the service `html || empty` expression with an explicit `html ? html : empty` branch, so display-empty is an owned state, not a fallback.
3. Extend `dialog-service-single-source.test.ts` so session dialog loading/empty/error HTML is only produced by the service, and the host contains no `bodyHtml ||` or `Loading...`.

## Verification

- `bun test packages/overlay/test/dialog-service-single-source.test.ts packages/overlay/test/dialog-primitive.test.ts packages/overlay/test/dead-dialog-cleanup.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test --test-concurrency=1 packages/overlay/test/browser/session-dialog-residue-browser.test.ts`
