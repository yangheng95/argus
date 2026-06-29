# Browser Preview Selected Target Authority - 2026-06-17

## Acronyms

- API: Application Programming Interface, the backend route contract consumed by the overlay.
- GUI: Graphical User Interface, the visible overlay preview surface.
- ID: Identifier, the persisted task or artifact key.
- URL: Uniform Resource Locator, the address saved in a browser preview target.

## Problem

`resolveBrowserPreviewTarget` assesses all persisted preview targets, filters to
reachable targets, and returns the first reachable candidate. When the most
recently selected task target is unreachable but an older saved target is
reachable, the backend silently substitutes the older target.

That is a hidden fallback. The persisted selected target artifact is the single
authority; reachability can only mark that selected target `ready` or `failed`.
Other saved targets may remain visible as candidates, but they must not replace
the selected target.

## Evidence Sweep

Command:

```powershell
rg -n "resolveBrowserPreviewTarget\(|assessBrowserPreviewTargets|reachableTargets\[0\]|findRecentBrowserPreviewTargets|does not replace the selected preview target|/task/:taskID/browser-preview" packages/opencorvus/src/browser-preview packages/opencorvus/src/server packages/opencorvus/test/browser-preview packages/opencorvus/test/server specs/new-arch -g "*.ts" -g "*.md"
```

Findings:

| Surface             | Evidence                                                                                                                           | Decision                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Resolver            | `target.ts` assigns `const persisted = reachableTargets[0]`.                                                                       | Replace with `selectedTarget = persistedTargets[0]`; visibility decides status only for that ID. |
| Resolver unit test  | `target.test.ts` already has a failing test named `does not replace the selected preview target with another reachable candidate`. | Keep the test and make it pass without weakening assertions.                                     |
| Server route        | `GET /task/:taskID/browser-preview` calls `resolveBrowserPreviewTarget`.                                                           | Add route coverage for selected unreachable target plus older reachable target.                  |
| Existing specs      | `2026-06-15-browser-preview-live-target-boundary.md` says the selected target artifact is the single authority.                    | Follow that constraint; no new source or target promotion path.                                  |
| Tool/capture routes | Capture/live/compare routes resolve explicit `targetID` via `findBrowserPreviewTargetByID`.                                        | No change needed; they already use explicit target IDs.                                          |

## Fix

1. Keep `findRecentBrowserPreviewTargets(taskID)[0]` as the selected target.
2. Probe persisted candidates only to determine whether the selected target is
   visible and to report diagnostics for unreachable candidates.
3. Return `failed` for the selected target when it is unreachable, even if an
   older candidate is reachable.
4. Mark candidates selected by the selected target ID, never by the first
   reachable target ID.
5. Add route-level regression coverage so the overlay route cannot reintroduce
   candidate substitution.

## Acceptance

- `bun test packages/opencorvus/test/browser-preview/target.test.ts` passes.
- `GET /task/:taskID/browser-preview` returns `failed` for a selected
  unreachable target even when an older target is reachable.
- Candidate selection points at the selected target ID.
- No package metadata, URL guessing, or alternate target source is introduced.
