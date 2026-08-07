# Browser Preview Selected Target Probe

Date: 2026-06-22
Status: Implemented

## Acronyms

- GUI: Graphical User Interface, the browser-rendered overlay surface.
- URL: Uniform Resource Locator, the persisted browser preview target address.
- UI: User Interface, the visible overlay surface.

## Task Definition

Reduce Browser Preview open latency by probing only the selected persisted target
instead of probing every recent candidate, while preserving selected-target
authority and candidate display.

## Recall

| Source                                                           | Constraint carried forward                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                                      | No fallback, no gate, no hidden second target source, test every behavior change.                                        |
| `2026-06-14-browser-preview-target-diagnostics-and-selection.md` | Saved targets remain the only source; unreachable saved selected target reports `failed`, not `missing`.                 |
| `2026-06-17-browser-preview-selected-target-authority.md`        | The newest/promoted persisted target is the selected authority; resolver must not switch to another reachable candidate. |
| `2026-06-15-gui-benchmark-quality-audit.md`                      | Reachability only marks the selected target ready/failed.                                                                |

## Call Point Inventory

| Surface        | Evidence                                                                                                | Decision                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Resolver       | `resolveBrowserPreviewTarget()` currently calls `assessBrowserPreviewTargets()` for all recent targets. | Probe only `persistedTargets[0]`, the selected target.                                  |
| Candidate list | `browserPreviewCandidates()` maps all recent targets for the overlay selector.                          | Keep all candidates visible without probing their liveness.                             |
| Liveness       | `isBrowserPreviewTargetVisible()` is the single reachability probe.                                     | Keep this source; call it once for the selected target.                                 |
| Routes         | `GET /task/:taskID/browser-preview` returns resolver output.                                            | Update route expectations that previously depended on unselected-candidate diagnostics. |
| Tests          | `target.test.ts` already protects selected-target authority.                                            | Add a regression proving only selected target URL is probed.                            |

## Root Cause

Browser Preview panel open calls the backend resolver. The resolver previously
probed up to 12 recent target candidates in batches of four, even though only
the selected target can affect the returned status. Those unselected probes add
latency and network work to toolbar open while producing diagnostics that are
not required for selected-target authority.

## Fix Plan

1. Replace all-candidate assessment with `isSelectedBrowserPreviewTargetVisible()`.
2. Return `failed` only when the selected target is unreachable.
3. Keep candidate metadata unchanged and do not pick a fallback reachable target.
4. Update resolver and route tests to remove unselected-target liveness
   diagnostics and require only one probe.
5. Run browser-preview target/route tests, typecheck, and Browser Preview UI
   browser evidence coverage.

## Acceptance

- `resolveBrowserPreviewTarget()` probes exactly one URL: the selected persisted target.
- Older candidates remain visible but do not trigger liveness probes on panel open.
- Selected unreachable target still returns `failed`.
- Selected reachable target still returns `ready`.
- No package metadata, local URL, iframe, fallback target, or alternate source is introduced.

## Verification

- `bun test packages/opencorvus/test/browser-preview/target.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/server/browser-preview-routes.test.ts --timeout 60000`
- `bun run --cwd packages/opencorvus typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-evidence.test.ts`
- Visual QA: viewed `.scratch/browser-preview-evidence-previewable-image.png` and `.scratch/browser-preview-candidate-trigger-focus-visible.png`; Browser Preview evidence and candidate controls remain aligned and readable.

## Self Review

- Rechecked `resolveBrowserPreviewTarget()`; the only liveness call is now `isSelectedBrowserPreviewTargetVisible(selected, input.isVisible)`.
- Rechecked candidates; `browserPreviewCandidates(persistedTargets, selected.id)` still exposes older saved targets without probing them.
- Rechecked route behavior; selected unreachable targets still report `Saved browser preview target is unreachable: <selected URL>`, while unselected candidates no longer emit liveness diagnostics.
