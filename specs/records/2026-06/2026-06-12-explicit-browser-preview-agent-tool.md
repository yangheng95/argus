# Explicit Browser Preview Agent Tool

## Problem

The browser preview target is task-scoped `browser_preview_target` evidence, but the current runtime also has automatic URL discovery paths that persist preview targets from generic tool output, `bash` streams, and user shell execution. That makes preview state appear as a side effect of unrelated commands.

The requested direction is to remove that automatic preview chain and expose an explicit preview tool to the three agents that need it: orchestrator, visual-qa, and integrity.

## Call Point Audit

| Surface                 | Current call point                                                                                                                                  | Decision                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Generic tool wrapper    | `packages/opencorvus/src/tool/tool.ts` imports `persistBrowserPreviewTargetFromProcessOutput` and scans every tool result unless metadata opts out. | Delete automatic scan.                                                                            |
| Build/general `bash`    | `packages/opencorvus/src/tool/bash.ts` streams stdout/stderr into `createBrowserPreviewProcessOutputMaterializer`.                                  | Delete automatic stream materialization.                                                          |
| Session shell execution | `packages/opencorvus/src/session/shell-exec.ts` streams user shell output into `createBrowserPreviewProcessOutputMaterializer`.                     | Delete automatic stream materialization.                                                          |
| MCP browser result      | `packages/opencorvus/src/session/loop.ts` scans `browser_*` tool output into preview targets.                                                       | Delete automatic scan.                                                                            |
| Explicit preview tool   | `packages/opencorvus/src/tool/browser-preview.ts` starts a background service through `BashTool`.                                                   | Keep and make it the single automatic extraction owner for its own startup output / explicit URL. |
| URL extraction helpers  | `packages/opencorvus/src/browser-preview/extract.ts` extracts loopback URLs and persists reachable targets.                                         | Keep extraction and explicit persistence helper; remove automatic materializer entrypoints.       |
| Orchestrator tools      | `packages/opencorvus/src/orchestrator/tools.ts` custom tool set has no `browser_preview`.                                                           | Add explicit `browser_preview` wrapper.                                                           |
| Visual QA tools         | `packages/opencorvus/src/visual-qa/agent.ts` static tool surface has no `browser_preview`.                                                          | Add explicit `browser_preview`.                                                                   |
| Integrity tools         | `packages/opencorvus/src/integrity/team-agent.ts` only has evidence tools plus submit.                                                              | Add explicit `browser_preview`.                                                                   |
| Agent catalog           | `packages/opencorvus/src/agent/agent.ts` tool include lists do not expose `browser_preview` to orchestrator/visual-qa/integrity metadata.           | Add to those three agents only.                                                                   |
| Prompt docs             | `orchestrator-core.txt`, `visual-qa-core.txt`, `integrity-team-core.txt` mention preview/evidence behavior.                                         | Update prompts to require explicit tool use, not host auto-prep.                                  |

## Design

`browser_preview` remains the only code path that may inspect preview process output and persist a target from it. Ordinary tools, shell commands, and MCP browser output no longer write preview targets. Manual URL selection through the backend route remains a separate explicit operator action that writes the same task-scoped artifact.

The explicit tool is shared through a small adapter pattern already used by visual-qa: initialize `BrowserPreviewTool`, execute it with the current task id, and return its structured result to the agent turn.

## Tests

- Replace the old generic-output materialization test with a negative assertion that generic tool output does not create `browser_preview_target`.
- Keep extraction and explicit persistence helper tests for the explicit preview tool.
- Add/adjust tool-surface tests for visual-qa, integrity, and orchestrator so all three expose `browser_preview`.
