# Agent Rail Tooltip Transcript Occlusion

## Recall

| Item | Detail |
| --- | --- |
| User request | The supplied screenshot shows that the Agent Rail hover detail still covers the conversation card beneath it. Remove this overlap. |
| Acceptance criteria | Hover and keyboard focus keep the existing canonical Kobalte Tooltip and bounded input/output preview, but the Tooltip occupies the whitespace on the rail's non-transcript side and never intersects the transcript lane; compact dimensions, viewport containment, pointer proximity, click-to-locate, shared Tooltip chrome, and smooth active-surface enter motion remain intact; a Node-launched real desktop screenshot is inspected. |
| Hard constraints | Fix geometry at the existing Tooltip owner rather than hiding content or adding a gate, delay workaround, second popup, fallback, state machine, handwritten primitive, iframe, transcript offset, mobile/tablet scope, or alternate record source. Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay. Preserve all unrelated shared-worktree changes. Use Node for Playwright. Commit subjects use `dsw-33987` and delivery goes to `myhexin`. |
| Supplied evidence | `codex-clipboard-663a4156-7705-432f-9679-e7b9e5065d38.png` shows the white `chat` hover detail directly above an existing rounded conversation card whose `Compose the bounded interaction...` text and border re-emerge at the Tooltip's lower edge. The red annotation marks the intersecting surfaces. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied original-resolution screenshot; `specs/records/2026-07/2026-07-09-agent-rail-hover-removal.md`; `specs/records/2026-07/2026-07-14-agent-rail-hover-input-context.md`; `specs/records/2026-07/2026-07-19-agent-rail-hover-tooltip-right-compact.md`; `specs/records/2026-07/2026-07-19-agent-rail-bounded-content-preview.md`; `specs/records/2026-07/2026-07-23-agent-rail-three-record-smooth-hover.md`; current `ConversationAgentRail.tsx`, `conversation.css`, shared `Tooltip.tsx`/`tooltip.css`, focused source/browser tests, Git history/blame, and installed Kobalte Tooltip sources. |
| Whole-repository grep | `App.tsx` owns the only `<ConversationAgentRail />` mount. `ConversationAgentRail.tsx` is the only `.conversation-agent-rail-tooltip` producer and hard-codes deterministic `placement="right"`, `gutter={8}`, and `flip={false}`. `conversation.css` is the only feature-local compact geometry/motion owner. `conversation-agent-rail.test.ts` explicitly requires right placement. `conversation-agent-rail-hover-context-browser.test.ts` verifies right-of-tick geometry and viewport containment but no longer checks transcript intersection. `conversation-agent-rail-scroll-browser.test.ts` checks stable Tooltip count and broader continuity without owning placement. Shared Tooltip chrome, projection/store/schema/routes/localization, and Software Development Kit surfaces do not own this defect. |
| Independent agent feedback | None. The user did not request sub-agents and the active collaboration policy forbids unrequested delegation. |
| Baseline evidence | The current real browser fixture passes and its fresh screenshot reproduces a 240px Tooltip drawn on top of the first conversation-card column. An attempted neighboring-root transition assertion also passed and its screenshot contained only one Tooltip, disproving the initial retained-exit-surface hypothesis. |

## Causal chain

1. **Observable symptom:** the white Agent Rail hover detail covers the upper-left region of a conversation card; the underlying card border and text become visible again immediately below the Tooltip.
2. **Direct trigger:** the rail lies on the transcript's leading boundary while its Tooltip explicitly opens to the right, so Kobalte correctly positions the surface inside the transcript lane.
3. **Deep cause:** the July 19 change replaced the earlier non-overlap contract with right-side visual-reference parity and removed the browser assertion against `#chatScroll`. Compacting the card reduced the covered area but could not eliminate intersection because placement and transcript occupy the same side of the rail.
4. **Why the existing path missed it:** the current browser test proves only right-of-tick placement, compact bounds, and viewport containment. It has no transcript rectangle in its geometry result, so a fully in-viewport Tooltip can still cover message content and pass.
5. **Root repair:** preserve the mature Kobalte Tooltip and compact bounded preview, but restore deterministic left placement with flipping disabled so the popup uses the existing sidebar whitespace and cannot enter the transcript lane.

## Historical decision resolution

The July 19 right-side placement was an explicit visual-reference decision at
that time. The current user screenshot is newer direct evidence that the same
geometry still violates the conversation-content requirement first documented
on July 9 and explicitly avoided by the July 14 left-whitespace contract. This
repair supersedes only the side-of-rail decision: compact 240px bounds,
three-line previews, canonical data, and shared Tooltip interaction remain.

## Call-site disposition

| Owner | Decision |
| --- | --- |
| `packages/overlay/src/components/ConversationAgentRail.tsx` | Change the existing Kobalte Tooltip root from deterministic right placement to deterministic left placement. Keep its delays, gutter, no-flip behavior, sources, trigger, focus, and locate behavior unchanged. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Keep compact 240px bounded-preview geometry, canonical surface chrome, and current motion unchanged. |
| `packages/overlay/test/conversation-agent-rail.test.ts` | Replace the obsolete right-placement source contract with deterministic left placement and an explicit absence of the superseded right contract. |
| `packages/overlay/test/browser/conversation-agent-rail-hover-context-browser.test.ts` | Restore transcript geometry to the real hover/focus fixture; prove the Tooltip's right edge stays left of both the active tick and `#chatScroll`, while compact bounds and viewport containment continue to pass; capture a scoped non-occlusion screenshot. |
| `packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts` | Keep unchanged; its broad rail/scroll assertions do not own placement. |
| Shared Tooltip primitive, feature CSS, record projection, stores, schema, routes, localization, Software Development Kit | Keep unchanged because the component placement prop is the sole occlusion trigger. |
| `specs/README.md` and `specs/records/2026-07/README.md` | Index this record while preserving concurrent entries. |

## Implementation and verification plan

1. Replace the transient duplicate-Tooltip experiment with a direct real-browser transcript-intersection assertion so the current right-opening implementation fails.
2. Change only the existing Kobalte root's placement to the whitespace side and update the focused source contract.
3. Run focused Agent Rail/Tooltip tests, Overlay typecheck and production build, then the original Node browser hover fixture.
4. Inspect the new task-scoped screenshot at original resolution, correct any remaining intersection, and rerun the browser path.
5. Run historical/document health, `git diff --check`, and a scoped second review; selectively commit only this repair and push through the normal `myhexin` hook.

## Validation targets

```sh
bun test packages/overlay/test/conversation-agent-rail.test.ts packages/overlay/test/tooltip-primitive.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay build
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-hover-context-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts
git diff --check
```

## Implementation result

- The existing Kobalte Tooltip root now requests deterministic
  `placement="left"` with the existing `gutter={8}` and `flip={false}`. No
  second surface, offset state, content source, or custom positioning logic was
  introduced.
- Compact 240px geometry, three-line input/output clamps, shared Tooltip
  chrome, pointer/focus behavior, tick motion, and click-to-locate remain
  unchanged.
- The browser fixture now measures the active tick, Tooltip, `#chatScroll`, and
  every rendered conversation card. It rejects any right-side transcript
  placement or rectangle intersection rather than accepting viewport
  containment as sufficient.

## Verification evidence

- FAIL before product repair: the new real-browser assertion measured the tick
  at `283–303px`, the transcript beginning at `281px`, and the right-opening
  Tooltip at `312–552px`. This proved the whole Tooltip occupied the transcript
  side even though it remained inside the 1280×720 viewport.
- PASS: `bun test packages/overlay/test/conversation-agent-rail.test.ts
  packages/overlay/test/tooltip-primitive.test.ts` — 12 tests, 321 assertions.
- PASS twice after repair: the original Node-launched
  `conversation-agent-rail-hover-context-browser.test.ts`. Both runs rebuilt
  the current production Vite bundle and passed hover, keyboard focus, bounded
  input/output, compact dimensions, left gutter, transcript exclusion,
  zero-card-intersection, proximity, and viewport assertions.
- The first post-WIP browser attempt reached the real build but exposed a
  missing local `pdfjs-dist` link from concurrent interactive-artifact work.
  `bun install --frozen-lockfile` restored the dependency from the already
  declared package/lock entry; the unchanged browser command then entered and
  passed the real checker.
- Visual review PASS at original 1280×720 resolution for
  `.scratch/conversation-agent-rail-hover-context/non-occluding-bounded-preview.png`.
  The Tooltip occupies approximately `34–274px`, the active tick begins around
  `283px`, and conversation cards begin around `327px`; the Tooltip no longer
  cuts across a card border or body text.
- PASS: all 21 historical-document link checks.
- The full Overlay TypeScript check is currently blocked by concurrent,
  unstaged interactive-artifact and terminal-projection work (for example
  missing `MediaKind`, incomplete new renderer unions, and an
  `artifact_missing` projection). The production Vite build used by this
  browser acceptance still completes. Document health has the same concurrent
  WIP boundary: 77 checks pass and five fail on deleted Mirror package paths,
  a concurrently revised panel sentence, fixture-contract drift, untracked
  concurrent record links, and a deleted architecture file. None of those
  files are part of this staged repair.

## Second review

- The observable overlap is now prevented by geometry at the single Tooltip
  owner. No timing rule, animation suppression, content clipping, transcript
  padding, feature gate, or fallback masks the issue.
- The failed duplicate-Tooltip hypothesis was removed from the implementation
  and replaced with direct transcript/card intersection evidence.
- The staged diff contains only the component placement change, focused source
  and real-browser regression coverage, this record, and its two index entries.
  Concurrent WIP remains unstaged and unmodified by this repair.
