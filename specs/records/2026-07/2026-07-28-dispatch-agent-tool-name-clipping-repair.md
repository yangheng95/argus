# Dispatch Agent Tool Name Clipping Repair

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | The supplied Overlay screenshot shows a running Tool row as `disp…`; after the read-only diagnosis, the user explicitly requested “修复”. |
| Acceptance criteria | A persisted `dispatch_agent` part with the canonical nested input renders the complete `dispatch_agent` label and `target=<agent-id>` detail in the collapsed execution disclosure; the compact row remains one line and only genuinely overlong content ellipsizes; ordinary Agent and exact-session Sub-agent conversations inherit the same shared repair; focused unit, typecheck, document-health, and real desktop Vite browser checks pass; the browser screenshot is personally reviewed. |
| Hard constraints | Preserve `CardParts` as the single execution-disclosure renderer and `tool.ts` as the single Tool display projection. Do not add fallback input shapes, a second renderer, local UI state, query overrides, iframe fixtures, or gates. Do not restart, refresh, or otherwise operate the user’s running OpenCorvus/Overlay. Use Node for Playwright/browser execution. Preserve every unrelated dirty-worktree change and stage only task-owned files/hunks. Commit subjects use `dsw-33987` and delivery pushes to the current `legacy-remote/v0.0.22beta` branch. |
| Supplied evidence | `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-25a324de-9858-4f74-8ad2-b0adf51a6567.png` was inspected at original resolution. It shows the Tool glyph followed by an ellipsized `disp…` label while the surrounding transcript has ample width. |
| Persisted runtime evidence | Read-only inspection of `/Users/yangheng/.local/share/opencorvus/opencorvus.db` found the complete Tool identity `dispatch_agent` and the canonical input shape `state.input.dispatch.target`; the backend did not truncate the name. |
| Sources read | `AGENTS.md`; Browser skill; the supplied screenshot; `specs/records/2026-07/2026-07-15-tool-call-single-line-authority.md`; `specs/records/2026-07/2026-07-16-overlay-codex-tool-disclosure-visual-repair.md`; `specs/records/2026-07/2026-07-26-agent-card-live-tool-activity.md`; `packages/opencorvus/src/orchestrator/dispatch-agent-tool.ts`; `packages/opencorvus/src/orchestrator/tools.ts`; `packages/overlay/src/utils/tool.ts`; `packages/overlay/src/components/CardParts.tsx`; `packages/overlay/src/styles/surfaces/messages.css`; focused Tool and browser tests. |
| External specification | The current World Wide Web Consortium (W3C) Flexbox specification confirms that auto-sized flex containers use intrinsic sizing and that cyclic percentage constraints participate in intrinsic contribution rules. The repair removes the cyclic parent-percentage cap instead of adding a browser-specific workaround. |
| Whole-repository grep | `displayToolDetail()` is the shared projection consumed by tool cards, collapsed activity previews, dialog export, Inline Tool rendering, Sub-agent presentation, and cached card stats. `CardParts.tsx` is the only production owner of `work-details-toggle`, `msg-work-details__tool-name`, and `msg-work-details__tool-detail`; `messages.css` is their only style owner. Browser consumers include message chronology, Agent-card separation, chat-bubble disclosure, inline interactive artifacts, exact-session Sub-agent Dock, and other transcript fixtures. `dispatch_agent` construction and provider-materialization tests uniformly prove the strict nested `{ dispatch: { target, ... } }` public input; the Overlay unit test alone still uses a stale flat `{ target }` fixture. `manage_task` remains a distinct flat `{ action, ... }` contract and must stay unchanged. |
| Independent Agent feedback | None. The user did not request delegation, and the active collaboration policy forbids unrequested sub-agents. |
| Workspace preservation | At task start, the shared worktree contains unrelated Sub-agent, conversation-scrollport, architecture, test, and spec-index changes. Their content must remain intact; this task adds only its own index lines and record. |

## Root cause

The failure has two coupled causes:

1. `dispatch_agent` persists the strict public Tool input as
   `state.input.dispatch.target`, but `displayToolDetail()` reads the retired
   flat `state.input.target` shape. The shared projection therefore returns no
   dispatch detail, so `CardParts` omits the detail span.
2. The remaining icon-and-name disclosure is content-width (`width: auto`),
   while the name is capped at `36%` of that same auto-sized parent. This cyclic
   intrinsic-size constraint collapses the name’s used width and its existing
   ellipsis paints `disp…`.

The complete Tool name in persisted data disproves backend truncation, partial
streaming identity, and screenshot cropping as causes.

The current Overlay unit fixture encodes the stale flat dispatch input, while
the browser fixture always supplies a non-empty generic detail. Neither test
exercises the canonical persisted dispatch shape or measures whether the Tool
name itself is clipped.

## Call-point disposition

| Surface | Disposition |
| --- | --- |
| `packages/overlay/src/utils/tool.ts` | Replace the stale flat `dispatch_agent` detail read with the strict canonical `input.dispatch.target` read. Return no dispatch detail for malformed/noncanonical input; do not keep a compatibility branch. Preserve the distinct flat `manage_task.action` contract. |
| `packages/overlay/src/components/CardParts.tsx` | Keep unchanged as the sole disclosure renderer; its existing conditional detail span will render once the shared projection returns canonical detail. |
| `packages/overlay/src/styles/surfaces/messages.css` | Remove the parent-percentage name cap. Keep a bounded absolute Tool-name cap and the existing flexible one-line detail so ordinary names remain complete and genuinely long names/details still ellipsize. |
| `packages/overlay/test/tool-display.test.ts` | Replace the stale flat dispatch fixture with the exact persisted nested shape and assert the retired flat shape is not accepted as dispatch detail. |
| Message chronology fixture/test | Add one isolated running `dispatch_agent` execution disclosure using the real nested input, assert exact label/detail and rendered `clientWidth === scrollWidth` for the name, save a task-scoped screenshot, then remove that fixture before the existing chronology assertions. |
| `packages/overlay/test/tool-call-generation-stream.test.ts` | The expanded focused run exposed a stale `message.part.updated` fixture that omitted the current top-level Agent identity fields. Add the exact `agentID` and `sessionAgentID` already present on its owning `message.updated` event; keep the production integrity rejection unchanged. |
| Other Tool display consumers | No local changes. Tool cards, activity previews, dialog export, Inline Tool rendering, Sub-agent presentation, and cached card stats inherit the single shared projection repair. |
| `manage_task` | Keep unchanged because its production schema remains flat `action`, not nested dispatch input. |

## Implementation plan

1. Add the canonical nested-input unit regression and the rendered
   `dispatch_agent` disclosure fixture/geometry assertion.
2. Correct the shared dispatch detail projection and remove the cyclic
   percentage name cap without changing renderer ownership.
3. Run focused unit coverage, Overlay typecheck/i18n, and the Node-started real
   Vite browser fixture; inspect the screenshot and correct any remaining
   clipping.
4. Run required spec/document-health checks, review the complete diff and
   staged paths, commit only task-owned files/hunks, and push
   `v0.0.22beta` to `legacy-remote`.

## Codex review feedback

The expanded Tool regression run reached the real selected-task conversation
projection and found that `tool-call-generation-stream.test.ts` still emitted a
pre-current-protocol `message.part.updated` event without top-level `agentID`
and `sessionAgentID`. The production route correctly rejected the incomplete
event before the Tool-delta assertion. The plan is therefore revised to repair
that test-owned event with the exact identity already declared by its owning
message, then rerun the original focused command. No production integrity rule
is relaxed.

## Verification

- Focused Tool regressions:
  `bun test packages/overlay/test/tool-display.test.ts packages/overlay/test/message-overflow.test.ts packages/overlay/test/card-collapsed-preview.test.ts packages/overlay/test/tree-writer-stats-cache.test.ts packages/overlay/test/running-tool-wave.test.ts packages/overlay/test/tool-call-generation-stream.test.ts`
  passed with 63 tests, 270 assertions, and zero failures.
- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay i18n:check` passed.
- `bun run --cwd packages/overlay build` passed. Vite retained its existing
  Radix `"use client"` and large-chunk warnings; no build error occurred.
- Node-started real Vite browser acceptance:
  `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/message-part-chronology-browser.test.ts`
  passed after formatting. It asserts the exact `dispatch_agent` name,
  canonical `target=requirement-engineer` detail, collapsed accessible label,
  fixed 220px computed cap, and `clientWidth === scrollWidth` in both Light and
  Dark themes.
- The task-scoped screenshots
  `.scratch/dispatch-agent-tool-name-intact.png` and
  `.scratch/dispatch-agent-tool-name-intact-dark.png` were personally inspected.
  Both show the complete `dispatch_agent` name and target detail on one compact
  row; the reported `disp…` clipping is absent.
- `git diff --check` passed.
- Historical-link and product-document single-source suites passed. The first
  pre-commit document-health run had 92 passes and one repository-state failure
  because its monthly-index assertion requires the newly referenced record to
  be Git-tracked. With all task-owned files present in the isolated commit
  index, the combined historical-link, document-health, and product-document
  command passed with 93 tests, 1,448 assertions, and zero failures.
