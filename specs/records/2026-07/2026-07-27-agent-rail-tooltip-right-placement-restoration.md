# Agent Rail Tooltip Right Placement Restoration

## Recall

| Item | Detail |
| --- | --- |
| User request | “这个 hover 的弹框不要放在左侧，调整到右侧展示。” The supplied 1041×600 screenshot marks the Agent Rail hover detail currently opening over the left-side conversation list. |
| Acceptance criteria | Hover and keyboard focus open the existing Agent Rail detail to the right of the active tick with the existing gutter; the card stays within the desktop viewport, preserves the compact bounded input preview, and keeps tick proximity plus click-to-locate behavior. A real Node-launched desktop browser screenshot must be inspected after the change. |
| Hard constraints | Reuse the canonical Kobalte Tooltip and Button; replace the old side contract directly without a fallback, custom positioning code, gate, second popup, alternate activity source, mobile/tablet scope, or worktree. Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay. Preserve unrelated dirty-worktree changes. Use Node for Playwright. Commit subjects use `dsw-33987`; delivery pushes the current branch to `myhexin`. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-adde1a9f-cff7-49df-a2a4-a21fe9a61bb1.png`, inspected at original resolution. The red box shows the compact `multica-agent-*` detail occupying the left side of the Agent Rail tick; the requested destination is the tick's right side. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; current `ConversationAgentRail.tsx`, shared `Tooltip.tsx`, feature `conversation.css`, focused source and Node-browser tests; `2026-07-14-agent-rail-hover-input-context.md`; `2026-07-19-agent-rail-hover-tooltip-right-compact.md`; `2026-07-24-agent-rail-tooltip-transcript-occlusion.md`; current panel architecture and spec indexes. |
| Whole-repository grep | `App.tsx` owns the sole `<ConversationAgentRail />` mount. `ConversationAgentRail.tsx` is the only `.conversation-agent-rail-tooltip` producer and currently hard-codes `placement="left"`, `gutter={8}`, and `flip={false}`. `conversation-agent-rail.test.ts` is the only source-contract test that requires left placement. `conversation-agent-rail-hover-context-browser.test.ts` is the only real-browser owner of the left-of-tick, transcript-exclusion, card-intersection, compact-bounds, viewport, focus, proximity, and screenshot assertions. `conversation.css` owns compact geometry and side-sensitive horizontal enter/exit motion. The scroll fixture observes Tooltip count but does not own side placement. Shared Tooltip chrome, projection/store/schema/routes/localization, and Software Development Kit surfaces do not require changes. Historical records remain immutable evidence of the superseded decisions. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |

## Causal chain

1. The visible hover detail opens on the left of the Agent Rail tick.
2. The sole Tooltip root explicitly requests `placement="left"` and disables
   flipping, so Kobalte is correctly following the current component contract.
3. The focused source test and real-browser geometry assertions encode the same
   left-side decision, making the behavior deliberate rather than incidental.
4. The new user instruction supersedes that side decision. The root repair is
   to change the existing root to deterministic right placement, update the
   side-sensitive motion direction, and replace the obsolete geometry
   assertions with right-of-tick plus viewport containment evidence.

## Call-site disposition

| Owner | Decision |
| --- | --- |
| `packages/overlay/src/components/ConversationAgentRail.tsx` | Change the sole Kobalte Tooltip root from deterministic left placement to deterministic right placement. Preserve delays, gutter, no-flip behavior, trigger, content, focus, and locate paths. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Reverse only the Tooltip's horizontal enter/exit offset so motion originates from its new right-side anchor; preserve compact bounds and shared Tooltip chrome. |
| `packages/overlay/test/conversation-agent-rail.test.ts` | Require right placement, reject the superseded left placement, and retain all existing primitive/content/motion contracts. |
| `packages/overlay/test/browser/conversation-agent-rail-hover-context-browser.test.ts` | Prove the Tooltip starts to the right of the active tick with the requested gutter and remains in the viewport. Retire the contradictory transcript-exclusion and zero-card-intersection assertions because the requested side is the transcript side. Keep content, focus, proximity, compact-bounds, and screenshot coverage. |
| `packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts` | Keep unchanged because it does not own Tooltip placement. |
| `specs/current/architecture/07-panel.md` | Record the current right-opening canonical Tooltip contract after implementation. |
| Historical records | Keep unchanged as dated evidence; this record explicitly supersedes only the side-placement decision from July 24. |

## Implementation and verification plan

1. Update the focused source and browser tests so the requested right-side
   contract fails against the current implementation.
2. Change the existing Kobalte placement and side-sensitive motion without
   altering the activity data, content hierarchy, compact dimensions, or
   interaction primitive.
3. Run focused Agent Rail and Tooltip tests, Overlay typecheck/build, and the
   original Node browser hover fixture.
4. Inspect the new task-scoped screenshot at original resolution, correct any
   clipping or visual drift, and rerun the browser path.
5. Update current architecture and this record with evidence, run document
   health plus diff checks, perform a second review, selectively commit this
   repair, and push the current branch to git-cc.

## Implementation result

- The sole Agent Rail Kobalte Tooltip root now requests deterministic
  `placement="right"` with its existing `gutter={8}` and `flip={false}`.
- The feature-local enter and exit keyframes now translate from the positive
  inline direction, so the existing motion originates from the Tooltip's new
  right-side anchor.
- Compact 240-pixel geometry, three-line input clamping, the single-line
  ellipsized Agent identity, shared Tooltip chrome, pointer/focus behavior,
  stepped tick proximity, and click-to-locate ownership remain unchanged.
- The real-browser regression now measures the Tooltip against the active
  tick's right edge and retains desktop-viewport containment. The superseded
  left-whitespace, transcript-exclusion, and card-intersection assertions were
  removed because they directly contradicted the requested side.
- The task-scoped screenshot is now captured from the settled hover state
  before the separate keyboard-focus path runs. This keeps visual evidence
  bound to the exact geometry already checked by the test.

## Verification evidence

- Expected FAIL before product repair:
  `bun test packages/overlay/test/conversation-agent-rail.test.ts` — the new
  right-placement contract rejected the existing `placement="left"`.
- PASS after repair:
  `bun test packages/overlay/test/conversation-agent-rail.test.ts
  packages/overlay/test/tooltip-primitive.test.ts` — 12 tests, 338 assertions.
- PASS:
  `node packages/overlay/test/browser-runner.mjs
  packages/overlay/test/browser/conversation-agent-rail-hover-context-browser.test.ts`.
  Its first run rebuilt the real Vite production bundle in 1 minute 33 seconds
  and passed the hover/focus checker; two subsequent runs passed after
  tightening screenshot timing.
- Visual review PASS at original 1280×720 resolution for
  `.scratch/conversation-agent-rail-hover-context/right-side-bounded-preview.png`.
  The settled card begins to the right of the active tick, is fully opaque,
  retains compact bounds and readable hierarchy, and stays inside the desktop
  viewport.
- The initial post-placement screenshot exposed that the old fixture captured
  the short focus transition rather than the stable hover state, producing a
  partially transparent frame; waiting after focus then captured the closed
  state. Moving screenshot capture to the already-asserted settled hover
  state fixed the evidence defect without changing production opacity.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS:
  `bun test packages/opencorvus/test/script/historical-docs-links.test.ts
  packages/opencorvus/test/script/document-health.test.ts
  packages/opencorvus/test/script/product-docs-single-source.test.ts` — 93 tests,
  1,446 assertions. The first document run correctly rejected the new record
  while it was absent from the Git index; tracking the record and rerunning the
  same command passed.

## Second review

- The side change is owned at the sole Tooltip producer; no custom geometry,
  second surface, timing workaround, alternate record source, fallback, gate,
  or state machine was introduced.
- Side-sensitive source, motion, real-browser geometry, current architecture,
  and dated evidence now agree on right placement.
- Historical left/right decisions remain unchanged as dated evidence, while
  this record explicitly supersedes the July 24 side-placement decision.
- Unrelated dirty-worktree changes remain outside this repair's selective
  staging and commit.
