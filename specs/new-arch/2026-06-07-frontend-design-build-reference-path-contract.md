# Frontend Design Build Reference Path Contract

## Problem

`frontend_design` and `frontend_research` correctly materialize webpage clone visual evidence as `reference.png` under the task runtime frontend-design package:

- `.opencorvus/runtime/tasks/<taskID>/frontend-design/web-clone-source/reference.png`
- `.opencorvus/runtime/tasks/<taskID>/frontend-design/webpage-evidence/reference.png`

The build prompt overlay also repeats compact source-package refs such as `web-clone-source/reference.png`. Build agents sometimes resolve that bare package-local path against the acceptance root or goal worktree current working directory, where the file intentionally does not exist. The resulting build blocker says `reference.png` / `reference.pn` is missing even though the canonical task runtime artifact exists.

## Call-Site Review

`rg "renderBuildPromptOverlays\\(|buildUserPrompt\\(|buildRetryFeedbackPrompt\\(" packages/opencorvus/src packages/opencorvus/test -S`

| Symbol | Call site | Decision |
| --- | --- | --- |
| `renderBuildPromptOverlays` | `packages/opencorvus/src/build/agent.ts` goal user prompt | Pass the active `taskID` so webpage-clone overlay can render concrete task-runtime paths. |
| `renderBuildPromptOverlays` | `packages/opencorvus/src/build/agent.ts` direct request prompt | Pass the active `taskID` for the same reason. |
| `renderBuildPromptOverlays` | `packages/opencorvus/src/build/agent.ts` retry prompt | Extend retry prompt signature with optional `taskID` and pass it from `BuildAgent.run`. |
| `renderBuildPromptOverlays` | acceptance-feedback-only overlays | No path resolution needed; leave taskID optional. |
| `buildUserPrompt` tests | `packages/opencorvus/test/build-agent/prompt-context.test.ts` | Add assertion for resolved task-runtime reference path. |
| `buildRetryFeedbackPrompt` tests | `packages/opencorvus/test/build-agent/prompt-context.test.ts` | Existing calls remain valid because taskID is optional. |

## Design

Keep the canonical evidence location unchanged. Do not copy `reference.png` into the acceptance root and do not add a fallback lookup. The build overlay must teach the resolver contract precisely:

- Package-local refs `web-clone-source/...` resolve under `.opencorvus/runtime/tasks/<taskID>/frontend-design/web-clone-source/...`.
- Skeleton refs `frontend-design-skeleton/...` resolve under `.opencorvus/runtime/tasks/<taskID>/frontend-design/frontend-design-skeleton/...`.
- Top-level `reference.png` is not an app-owned deliverable path.

When `taskID` is absent in unit-level prompt rendering, keep the existing template placeholder.
