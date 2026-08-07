# Agent Rail Bounded Content Preview

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Agent Rail 浮层不需要展示全部信息，参考 Codex 的实现。 |
| Acceptance criteria | Hover and keyboard focus keep the existing right-opening Kobalte Tooltip; agent identity and status remain immediately visible; user input and agent output remain recognizable but each body is limited to a three-line preview; long content cannot create an internal scrollbar or push the other preview out of view; tick proximity and click-to-locate remain unchanged; a real desktop screenshot is inspected. |
| Hard constraints | Reuse the canonical `Button` and shared Kobalte `Tooltip`; keep `inputPreview` and `displaySummary` as the single data sources; do not add a second popup, full-detail toggle, native `title`, fallback, gate, mobile/tablet scope, new worktree, or refresh/restart the user's running OpenCorvus/Overlay. Playwright must be launched with Node. Commit subjects use `dsw-33987`, and the current branch is pushed to `myhexin`. Preserve the unrelated in-progress Codex button primitive edits already present in the shared worktree. |
| Sources read | `AGENTS.md`; Browser skill; supplied screenshot; `2026-07-14-agent-rail-hover-input-context.md`; `2026-07-19-agent-rail-hover-tooltip-right-compact.md`; current `ConversationAgentRail.tsx`, `conversation.css`, focused source/browser tests, shared Tooltip primitive guards, and the locally installed Codex 26.715.4045.0 user-message navigation rail bundle. |
| Codex evidence | Codex's `thread-user-message-navigation-rail` tooltip truncates its heading, applies a three-line clamp to the message preview, limits additional output items, and avoids a scrollable full-content inspector. This establishes preview density, not a requirement to copy Codex's data model or brand tokens. |
| Whole-repository grep | `ConversationAgentRail.tsx` is the only producer of `.conversation-agent-rail-tooltip` and the only renderer of the localized input/output labels. `conversation.css` is the only feature-local content geometry owner. `conversation-agent-rail.test.ts` owns the direct source/CSS contract. `conversation-agent-rail-hover-context-browser.test.ts` owns real hover/focus content, geometry, and screenshot evidence. `conversation-agent-rail-scroll-browser.test.ts` checks only tooltip count during broader continuity coverage. Tooltip primitive and architecture guards require the existing canonical surface but do not own preview density. Server projection, Overlay store, schemas, localization values, routes, and Software Development Kit surfaces require no change. |
| Independent agent feedback | None. The user did not request sub-agents and the active collaboration policy forbids unrequested delegation. |

## Causal chain

1. A long mission prompt fills the tooltip until its 220px maximum height is reached.
2. The feature stylesheet uses `overflow: auto`, while both paragraphs render their complete strings with `white-space: pre-wrap`; the height bound therefore creates an inspector with a scrollbar instead of a preview.
3. The input appears first, so it can consume the visible area and hide the output even though both fields are present.
4. Keep the authoritative fields and existing tooltip primitive, but change the content contract from full scrollable text to the same bounded three-line preview rhythm used by Codex.

## Call-site disposition

| Owner | Decision |
| --- | --- |
| `packages/overlay/src/components/ConversationAgentRail.tsx` | Keep the existing identity, status, input/output sources, right placement, focus, accessibility, and locate behavior unchanged. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Remove the scrollable full-content contract; clamp every preview paragraph to three lines through the shared section rule and hide excess content. |
| `packages/overlay/test/conversation-agent-rail.test.ts` | Replace the obsolete maximum-height/scroll expectation with explicit bounded-preview CSS assertions. |
| `packages/overlay/test/browser/conversation-agent-rail-hover-context-browser.test.ts` | Use long input and output fixtures; prove both remain present, both are visually clamped, the tooltip has no internal scroll, right-side placement and viewport containment remain correct, and capture the scoped screenshot. |
| `packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts` | Keep unchanged because it does not inspect tooltip content density. |
| Tooltip primitive, architecture guards, i18n, projection/store/schema/routes | Keep unchanged; their existing contracts remain authoritative and are outside the content-density defect. |
| `specs/README.md` and `specs/records/2026-07/README.md` | Add this record without altering the unrelated in-progress index entries. |

## Implementation and verification plan

1. Update the focused source and browser assertions first so long content must be visibly bounded without an outer scrollbar.
2. Replace only the feature-local paragraph/overflow rules; retain the shared Tooltip chrome and all data/interaction paths.
3. Run focused Agent Rail and Tooltip/architecture tests, Overlay typecheck and localization checks, then the Node-launched Playwright hover fixture.
4. Inspect the generated desktop screenshot at original resolution, correct visual drift, rerun the rendered fixture, and complete diff/document-health review.
5. Record the evidence here, selectively commit only this task's files/hunks, and push the current branch to git-cc.

## Verification result

- The Agent Rail tooltip keeps its existing 240px width, right placement,
  identity/status header, canonical Kobalte surface, and input/output data
  sources. Its outer `overflow` is now hidden instead of scrollable, and the
  shared preview paragraph rule clamps every body to three lines.
- PASS: 139 focused Agent Rail, Tooltip primitive, and Overlay architecture
  guard tests (8,229 assertions).
- PASS: Overlay TypeScript and panel localization checks.
- PASS: the Node-launched
  `conversation-agent-rail-hover-context-browser.test.ts` real hover and
  keyboard-focus paths. The long input and output bodies both report a
  three-line clamp, both have hidden overflow with undisplayed text, the outer
  tooltip has no scrollable overflow, and right-side placement, viewport
  containment, tick proximity, and focus behavior remain intact.
- The first rendered run reached the real page but exposed one stale fixture
  assertion that still expected the previous short output sentence. Updating
  that assertion to the new long canonical fixture made the unchanged original
  browser command pass; no error suppression or product bypass was added.
- Visual review PASS at original 1280x720 resolution for
  `packages/overlay/.scratch/conversation-agent-rail-hover-context/bounded-input-output-preview.png`.
  Both previews are simultaneously visible, each ends with an ellipsis after
  three lines, the card has no scrollbar, and the surface reads as a quick
  preview rather than a detail inspector.
- PASS: historical docs links and consolidated spec-tree health; PASS:
  `git diff --check`.

## Second review

- The defect was resolved in the existing feature-local CSS contract. No
  backend projection, Overlay store, schema, route, localization, or alternate
  content source was introduced.
- Long input can no longer consume the tooltip viewport and hide the output;
  both fields use the same reusable preview rule.
- Click-to-locate, accessible labeling, hover/focus ownership, shared Tooltip
  chrome, and Rail geometry were not changed.
- The unrelated Codex button primitive files and their in-progress spec/index
  hunks were preserved and are excluded from this task's commit.
