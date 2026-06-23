# Mission Ledger Connection Boundary

Date: 2026-06-22
Status: Verified

## Problem

The Mission ledger can render its shared loading skeleton before the managed
server connection is ready. A recent run logged:

- `window.unhandledrejection Failed to fetch`
- stack location in the Mission resource loader
- later `GET /mission` requests completed with status 200 in a few
  milliseconds

That means the route itself is not permanently slow. The first Mission list
request can race the sidecar startup and then the resource has no connection
state in its key, so a later healthy connection does not by itself retry the
Mission list.

## Existing Contract Recall

- `specs/new-arch/2026-06-09-mission-global-row-action-directory.md` keeps
  `GET /mission` as the global Mission ledger source.
- `specs/new-arch/2026-06-12-mission-row-directory-action-fix.md` keeps row
  actions scoped by each row's `directory`.
- Therefore this fix must not change `/mission` into a project-scoped route.

## Call Sites

| Surface                                                       | Current behavior                                                            | Decision                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/overlay/src/components/Mission.tsx` resource source | Runs when the Mission activity is active, independent of server connection. | Add `appStore.connected` as a hard precondition for list loading. |
| Mission ledger error prop                                     | Shows request errors only.                                                  | Show an explicit offline error while disconnected.                |
| `packages/overlay/src/i18n/{en-US,zh-CN}.json`                | No Mission-specific offline ledger text.                                    | Add a localized Mission ledger offline error.                     |
| `packages/overlay/test/mission-launcher-component.test.ts`    | Locks active/search/refresh list loading.                                   | Lock the connection precondition and offline error wiring.        |

## Acceptance

- Mission does not request `/mission` while the overlay is disconnected or
  still connecting.
- When the server is offline, the Mission ledger shows an explicit error state
  instead of an indefinite loading skeleton.
- When the connection becomes online, the Mission resource source changes and
  reloads the Mission list.
- The global Mission ledger and row-directory action contracts are unchanged.

## Verification

- `bun test packages/overlay/test/mission-launcher-component.test.ts packages/overlay/test/mission-i18n.test.ts --timeout 30000`
- `bun run --cwd packages/overlay check:i18n`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/ledger-loading-status-browser.test.ts`

## Visual Review

- `.scratch/mission-ledger-offline-boundary.png`: Mission ledger renders the
  offline connection boundary as an in-panel error state, with no loading
  skeleton and no mission rows while disconnected.

## Self Review

- `Mission.tsx` now includes `appStore.connected` in the `createResource`
  source precondition, so `/mission` is not requested while offline.
- `MissionList` still receives all data through the existing Mission resource;
  no alternate ledger source or project-scoped `/mission` route was added.
- The offline error string is localized in both overlay locale files and
  covered by the panel i18n checker.
- The browser test drives the real `/global/health` failure path, proves
  `/mission` request count stays zero, and captures the visible error state.
