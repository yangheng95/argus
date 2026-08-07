# Browser MCP Concurrency And Preview Stability

- Date: 2026-06-07
- Status: Implementing

## Problem

G2 in task `tsk_e9dcd2bff0013DD3zO3lRj1vS5` looked like a browser MCP startup failure, but the task evidence shows a different failure mode:

- `/mcp` reported `browser: connected`.
- `browser_session_create` returned a real session/profile.
- `browser_navigate` returned `about:blank` with `loadStatus: failed`.
- The surrounding transcript showed Vite preview port `4173` in use, an attempted `4174` target that did not respond, and a later working dev server on `5180`.

There are two stability defects:

1. Browser MCP serializes browser launch and profile create/destroy, but not tool calls against the same `sessionId`/Playwright page.
2. Browser preview targets can be persisted from process output before the URL is reachable, leaving later browser navigation pointed at a dead or wrong port.

## Callpoint Audit

`rg -n "profileLocks|withProfileLock|destroySession|createSession|recordToolCall|sessionId" packages/opencorvus/src/mcp/browser`

| Surface                                                          | Evidence                                                                                             | Decision                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/opencorvus/src/mcp/browser/sessions.ts`                | `profileLocks` protects profile reuse/destroy, while `getSession` returns the mutable page directly. | Add a per-session operation lock as resource integrity, not LLM routing.    |
| `packages/opencorvus/src/mcp/browser/tools.ts`                   | `traced()` wraps every registered tool and already sees `args.sessionId`.                            | Wrap session-scoped handlers in the per-session lock at the common wrapper. |
| `packages/opencorvus/test/mcp/browser-session-lifecycle.test.ts` | Existing tests cover browser launch coalescing and profile create/destroy races.                     | Add lock ordering and throw-release tests.                                  |

`rg -n "browserPreview|browser-preview|persistBrowserPreviewTarget|extractBrowserPreviewUrlFromText|captureTaskTarget|verifyBrowserPreview" packages/opencorvus/src packages/opencorvus/test packages/overlay/test`

| Surface                                                   | Evidence                                                               | Decision                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| `packages/opencorvus/src/browser-preview/extract.ts`      | Persists the first loopback URL extracted from process output.         | Verify the extracted URL is reachable before persisting.        |
| `packages/opencorvus/src/browser-preview/target.ts`       | Resolver intentionally reads only saved task artifacts.                | Keep this single source. Do not scan package metadata or ports. |
| `packages/opencorvus/src/browser-preview/verification.ts` | Capture already fails visibly when target is missing or capture fails. | No separate fallback target.                                    |
| `packages/opencorvus/test/tool/bash.test.ts`              | Background process output persists task preview targets.               | Add positive and negative reachability coverage.                |
| `packages/opencorvus/test/browser-preview/target.test.ts` | Covers extraction and target resolution.                               | Keep URL parsing behavior unchanged.                            |

## Design

### Same-session Browser MCP serialization

Add `withSessionOperationLock(sessionId, fn)` in `sessions.ts`. The common `traced()` wrapper in `tools.ts` runs every handler with `args.sessionId` through that lock.

This does not block parallel browser work globally. Different sessions and different profiles still run concurrently. It only prevents two operations from mutating or inspecting the same Playwright page at the same time.

### Reachable preview target persistence

Before `persistBrowserPreviewTargetFromProcessOutput()` writes a task artifact, probe the extracted URL with a short HTTP request. Persist only a reachable URL. If the URL is not reachable yet, log and skip persistence; subsequent output from the actual running server can persist the real target.

This is not a fallback. The saved preview target remains the single source for overlay and capture.

## Tests

- `browser-session-lifecycle`: same-session operations run in insertion order and release the lock after errors.
- `bash`: background output persists a reachable URL and does not persist an unreachable URL.
