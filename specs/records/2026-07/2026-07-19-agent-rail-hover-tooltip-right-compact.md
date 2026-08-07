# Agent Rail Hover Tooltip Right Compact

## Recall

| Item | Detail |
| --- | --- |
| User requirement | 对话框左侧 Agent Rail 短线的 hover 弹框参考所附 Codex 截图：弹框放在短线右侧，尺寸不能太大。 |
| Acceptance criteria | Hover and keyboard focus open the existing Kobalte Tooltip to the right of the selected tick; its visible card is compact, remains within the desktop viewport, keeps agent/status/input/output information readable, and preserves tick proximity plus click-to-locate behavior. A real Node-launched desktop browser screenshot is inspected after the change. |
| Hard constraints | Reuse `ConversationAgentRail`, the canonical `Button`, and the shared Kobalte `Tooltip`; do not add a second popover, native `title`, alternate activity source, fallback, gate, mobile/tablet scope, or new worktree. Do not restart or refresh the user's running OpenCorvus/Overlay. Playwright is launched with Node. Commit subjects use `dsw-33987`, and delivery pushes the current branch to `myhexin`. |
| Supplied evidence | The attached Codex crop shows the hover card beginning to the right of the short vertical-rail mark. The card uses a restrained information width and shallow content rhythm rather than a large inspection panel. |
| Sources read | `AGENTS.md`; Browser skill; the supplied screenshot; `2026-07-14-agent-rail-hover-input-context.md`; `2026-07-16-header-toggle-agent-rail-visual-alignment.md`; current `ConversationAgentRail.tsx`, shared `Tooltip.tsx`, `tooltip.css`, `conversation.css`, focused source test, and real browser hover fixture. |
| Whole-repository grep | `ConversationAgentRail.tsx` is the only Agent Rail tooltip producer and currently hard-codes `placement="left"`, `gutter={8}`, and `flip={false}`. `conversation.css` is the only feature-local geometry owner and currently sets a token-scaled 280px width and 280px maximum height. `conversation-agent-rail.test.ts` is the direct source-contract owner. `conversation-agent-rail-hover-context-browser.test.ts` is the direct hover/focus content and geometry owner; `conversation-agent-rail-scroll-browser.test.ts` only guards rail continuity and tooltip count during its broader scroll path. Shared `.oc-tooltip` remains the sole chrome recipe. No backend, schema, store, localization, route, or Software Development Kit change is required. |
| Independent agent feedback | None. The user did not request sub-agents and the current collaboration policy forbids unrequested delegation. |

## Causal chain

1. The visible popup opens on the wrong side and feels oversized.
2. The trigger explicitly requests left placement without flipping, so Kobalte is correctly following the current component contract.
3. The feature stylesheet independently reserves 280px width and up to 280px height, which was chosen for the older left-whitespace design and is no longer appropriate for the requested compact Codex layout.
4. Repair the existing single tooltip contract: anchor it on the right, keep its placement deterministic, and reduce only the feature-owned content bounds while retaining the shared surface chrome and canonical input/output data.

## Call-site disposition

| Owner | Decision |
| --- | --- |
| `packages/overlay/src/components/ConversationAgentRail.tsx` | Change the existing Tooltip root to deterministic right placement. Keep the canonical trigger, content, accessibility, focus, and locate paths unchanged. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Replace the old 280px square bounds with compact token-scaled width and height limits; preserve shared `.oc-tooltip` border, radius, background, and shadow ownership. |
| `packages/overlay/test/conversation-agent-rail.test.ts` | Assert right placement, no left-placement contract, and compact feature geometry. |
| `packages/overlay/test/browser/conversation-agent-rail-hover-context-browser.test.ts` | Replace the obsolete left-of-transcript assertion with right-of-tick, bounded width/height, viewport containment, hover/focus content, and scoped screenshot evidence. |
| `packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts` | Keep its broader rail/scroll assertions unchanged; add the now-required `sessionAgentID` fixture metadata so the real hydrate path reaches those assertions. |
| `packages/overlay/test/acceptance-panel-mount.test.ts` | Repair the stale prop-less `MailboxPanel` source expectation exposed by the expanded focused run; assert the current notification and item-count callbacks without changing production ownership. |

## Implementation and verification plan

1. Update focused source and browser assertions to encode the requested right-side compact contract.
2. Change the existing Kobalte placement and feature-local bounds without changing content projection or shared popup chrome.
3. Run focused Agent Rail tests, Overlay typecheck/i18n, and the Node Playwright hover fixture.
4. Inspect the generated screenshot at original resolution, correct any overlap or density drift, then run documentation health, diff checks, and a second review.
5. Record verified evidence here, commit with `dsw-33987`, and push the current branch to git-cc.

## Verification result

- The existing Kobalte Tooltip now uses deterministic `right` placement with
  the existing 8px gutter and no flip. No secondary popup or data source was
  added.
- The feature-local card is bounded to 240px width and 220px maximum height;
  its internal gap and padding were reduced to an 8/10px compact rhythm while
  shared `.oc-tooltip` chrome remains unchanged.
- PASS: the focused Agent Rail, Tooltip primitive, owner-surface, and mount
  source tests. The expanded run exposed only a stale prop-less `MailboxPanel`
  test string; the repaired guard now asserts its real notification and
  item-count callbacks.
- PASS: Overlay TypeScript and panel localization checks.
- PASS: the Node-launched
  `conversation-agent-rail-hover-context-browser.test.ts` hover and keyboard
  paths. It proves one tooltip, right-of-tick placement, the 8px gutter,
  240/220px bounds, viewport containment, input/output content, and unchanged
  stepped tick geometry.
- PASS: the Node-launched
  `conversation-agent-rail-scroll-browser.test.ts` continuity and locate path.
- The initial browser attempt exposed two stale fixture-contract defects before
  the real checker could remain stable: the generic event stream never emitted
  an opening comment, and conversation message metadata omitted required
  `sessionAgentID`. Both focused and scroll fixtures now follow the current
  stream/hydrate contracts; no error suppression was added.
- Visual review PASS at original 1280x720 resolution for
  `.scratch/conversation-agent-rail-hover-context/input-output-tooltip.png`.
  The card begins to the right of the active short line, renders at about
  240x192px for the supplied content, remains fully visible, and retains clear
  identity/status/input/output hierarchy without reading as a large panel.
