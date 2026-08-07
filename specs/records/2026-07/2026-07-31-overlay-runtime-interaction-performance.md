# Overlay Runtime Interaction Performance

Date: 2026-07-31
Status: Approved for implementation

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | Investigate and optimize visible client stutter: delayed hover, scroll, and click responses. |
| Acceptance criteria | During a streaming conversation, pointer feedback and scrolling remain responsive; no event is lost; the view remains at the tail only while follow mode is active; the real desktop window passes visual review. |
| Hard constraints | Desktop-only; retain the existing WebView, Solid store, `virtua` virtualizer, and one scroll owner. Do not introduce fallback paths, state machines, synthetic events, custom scrolling, or UI automated tests. Non-UI behavior receives positive contract tests. |
| Read records | `specs/current/architecture/07-panel-reactivity.md`; `specs/records/2026-07/2026-07-31-overlay-startup-and-overscroll-containment.md`. |
| Whole-repository grep | Enumerated all `publishedCardTreeVersion`, `markCardTreeVisibleChanged`, `setupAutoScroll`, `contentChanged`, and `backdrop-filter` call sites. `Conversation.tsx` is the sole visible projection consumer; `dom-utils.ts` is the sole follow-scroll owner; `light.css` defines the active task-bar blur. |
| Independent agent feedback | None; the user did not request delegation. |

## Observed Cause Chain

The running desktop process is idle when no interaction arrives, so persistent process saturation is not the cause. Under streamed updates, `tree-writer.ts` publishes every visible change immediately. `Conversation.tsx` derives a new complete virtualizer data projection (`items`, `order`, map, and agent boundaries) from every publication, then calls `setupAutoScroll(...).contentChanged()`. That controller writes `scrollTop` in a frame and may write it again in a follow-up frame. Concurrent layout measurement and translucent blur surfaces make these updates expensive for the WebView renderer/GPU, delaying input feedback.

## Design And Call-site Disposition

| Surface | Decision |
| --- | --- |
| `src/store/card-tree.ts` | Keep the existing synchronous data store and event correctness. Add a single request-animation-frame publication scheduler so many writes in one frame produce one visible-version increment. |
| `src/services/tree-writer.ts` | Keep all precise card writes unchanged. Its existing visible-publication calls use the store scheduler. |
| `src/components/Conversation.tsx` | Keep `virtua` and current item identities. It reacts once per coalesced version, so projection and follow-scroll work run at most once per frame. |
| `src/utils/dom-utils.ts` | Preserve current user-follow semantics and late-paint correction. Do not add a second scroll owner or observer. |
| `src/styles/cascade/light.css` | Replace the task-bar live backdrop blur with the existing opaque surface token. Preserve layout and task-bar content. |
| `test/store-card-tree-*.test.ts` | Add positive non-UI contract coverage for coalesced visible publication and synchronous whole-tree replacement. |
| Existing browser UI tests | Do not run, update, or use them for acceptance. This change is accepted through a real desktop window, manual interaction, and screenshots. |

## Verification Plan

1. Write and run positive store publication tests before the production change.
2. Run the focused non-UI test file, Overlay typecheck, and production Vite build using Node.
3. Start the real desktop client; manually exercise hover, scroll, click, and streamed content, then inspect screenshots bound to the conversation region.
4. Review the final diff, update the specs index, commit with `dsw-33987`, and push the current delivery branch to `myhexin` through hooks.

## Result

`markCardTreeVisibleChanged()` now coalesces same-frame store publications behind one browser animation-frame callback. The tree writer still applies every event and every exact store write synchronously; only the renderer-facing version token is scheduled, so `Conversation.tsx` rebuilds its virtualizer projection and requests follow-scroll at most once per painted frame.

The light theme task bar no longer applies a live backdrop blur over the changing transcript. It retains its existing background, border, geometry, and task content while removing the GPU backdrop re-raster work that occurred during scrolling.

## Verification

- The new positive non-UI contract in `packages/overlay/test/card-tree-visible-version.test.ts` first failed against the immediate-publication implementation, then passed with 3 tests and 5 expectations after the scheduler was added.
- With `NODE_OPTIONS=--max-old-space-size=4096`, root `bun run typecheck` passed across all 8 packages. The higher heap is required by the existing `opencorvus` TypeScript program; the default 2 GB Node heap exhausted during the first run.
- Node-driven Overlay Vite production build passed after transforming 7,062 modules. Existing Radix `use client` and large chunk notices remain build warnings.
- `bun test ./packages/opencorvus/test/script/historical-docs-links.test.ts` passed with 2 tests and 2 expectations.
- A freshly launched Tauri debug client was manually reviewed: the initial home page, a populated conversation after task hydration, Composer, and visible hover preview rendered normally. No UI automated test was run.
- `git diff --check` passed.
