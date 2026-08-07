# GUI coordinate smoke workflow

## Problem

The `gui-coordinate-smoke` job in `.github/workflows/test.yml` runs `bun run ./packages/opencorvus/script/gui-coordinate-smoke.ts`, but that script was deleted in commit `2a7fdaf4f6dff7de8a5df11b3fe04f2d879dc520`. The job is part of the required aggregate, so the test workflow fails before it can validate GUI behavior.

## Call sites

| Surface                                                   | Current state                                                                        | Decision                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `.github/workflows/test.yml` `gui-coordinate-smoke`       | Calls a missing opencorvus script                                                    | Run an overlay unit smoke that verifies the current browser preview coordinate mapper           |
| `packages/overlay/src/components/BrowserPreviewPanel.tsx` | Owns inline live screenshot coordinate mapping                                       | Extract mapping into `browser-preview-live-point.ts` and call it from the component             |
| `packages/overlay/test`                                   | Has browser preview structure tests, but no pure coordinate smoke                    | Add a focused test for center, clamp, zero-size, and workflow command coverage                  |
| Old `packages/opencorvus/script/gui-coordinate-smoke.ts`  | Referenced deleted `src/opencorvus/gui/coordinates` and `perception/capture` modules | Do not restore old deleted modules; current GUI coordinate source is browser preview live input |

## Validation

- `bun test --cwd packages/overlay test/browser-preview-live-point.test.ts`
- Overlay typecheck.
- Root routes/docs checks before push.
