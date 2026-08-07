# Sub-agent Thumbnail Height Boundary

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | The supplied Overlay screenshot shows child-Agent cards occupying full transcript-height rows. The user requires a child-Agent thumbnail card to remain a thumbnail instead of being stretched open by its content. |
| Acceptance | Every compact Sub-agent card keeps one stable desktop block size; expanding Delegated context does not change that block size; the expanded Markdown and subsequent activity remain reachable through one native card-local scroll viewport; the TODO footer stays fixed; the exact full conversation remains owned by the existing Right Dock. |
| Hard constraints | Preserve the canonical `sessionID` projection, task/session routes, Agent Rail behavior, UI primitives, and current running Overlay process. Do not add a second transcript source, fallback, state machine, mobile scope, temporary iframe, local signal override, or synthetic preview evidence. Use the existing Node-launched Vite fixture and inspect goal-bound screenshots. Preserve unrelated work and stage only task-owned files. |
| Sources read | Root `AGENTS.md`; Browser control skill; memory note and rollout summary for `SubagentProgressGrid`; `specs/current/architecture/12-overlay-card-system.md`; the July progress-grid, refresh-projection, delegated-context, TODO-footer, dynamic-split, Tool-status, and pulse records; `SubagentProgressGrid.tsx`; `DelegatedContextDisclosure.tsx`; `subagent-presentation.ts`; `conversation.css`; `messages.css`; focused unit and Node/Vite browser fixtures. |
| Whole-repository grep | `SubagentProgressGrid.tsx` is the only compact-card renderer and the only compact consumer of `DelegatedContextDisclosure`. `conversation.css` is the only compact-card geometry owner. `DelegatedContextDisclosure.tsx` and `messages.css` remain the shared disclosure primitive and chrome owners. `subagent-progress-dock-browser.test.ts` is the only real Vite test that expands the compact card's Delegated context and already captures collapsed/expanded screenshots. The standalone disclosure tests own shared primitive styling and do not own compact-card geometry. |
| Independent Agent feedback | None. The user did not request independent or parallel Agent review, so the active multi-Agent boundary keeps this task single-Agent. |

## Causal chain

1. Observable symptom: expanding content can make a child-Agent progress card
   read as a full transcript card rather than a stable thumbnail.
2. Direct trigger: `SubagentProgressGrid` renders `DelegatedContextDisclosure`
   before `.subagent-progress-card__events`.
3. Structural cause: only `.subagent-progress-card__events` owns a maximum
   height and native scrolling, while `.subagent-progress-card` owns only a
   minimum height. The disclosure body therefore sits outside the bounded
   activity viewport and contributes unrestricted block size to the card.
4. Why the previous path did not root-correct it: the real browser test proved
   Markdown semantics after expansion but did not assert invariant card
   geometry or verify that the expanded body remained inside the same scroll
   owner.

## Single-source repair

| Owner / call site | Disposition |
| --- | --- |
| `SubagentProgressGrid.tsx` | Move the existing shared Delegated-context disclosure into the existing `.subagent-progress-card__events` viewport. Keep the same canonical input and activity projection. |
| `conversation.css` | Make one shared compact-card block-size token authoritative, give the card that fixed block size, and let the existing activity viewport consume the remaining flexible space with native vertical scrolling. |
| `DelegatedContextDisclosure.tsx` / `messages.css` | Keep unchanged; they continue to own shared disclosure semantics and chrome, not compact-card geometry. |
| `subagent-presentation.ts` / conversation-agent store | Keep unchanged; the bug is layout containment, not activity identity or message projection. |
| `SubagentConversationPanel` / Right Dock / Agent Rail | Keep unchanged; complete transcript and navigation ownership already match the architecture. |
| `ChatBubble.tsx` | Restore the existing static-header branch for callers that explicitly pass `collapsible={false}`. The original Vite acceptance exposed that an earlier concurrent commit had removed the branch while source and browser contracts still required it; this is a prerequisite repair, not a second child-card design. |
| `subagent-progress-input-markdown.test.ts` | Add the structural regression contract that the disclosure is nested inside the bounded activity viewport. |
| `subagent-progress-dock-browser.test.ts` | Assert equal fixed card heights before and after disclosure expansion, prove the expanded context is inside the scroll viewport and reachable by scrolling, prove the footer stays fixed, and capture the repaired expanded state. |
| Architecture and record indexes | Clarify the compact card's single bounded viewport and index this repair. |

## Verification plan

1. Run the focused source tests for compact delegated-context ownership and
   shared disclosure alignment.
2. Run the existing Node-launched Vite progress/Dock test, including collapsed
   and expanded card geometry, native scrolling, footer placement, exact-session
   Dock behavior, and screenshots.
3. Inspect the repaired expanded screenshot at original resolution. If it no
   longer reads as a thumbnail or content/footer is clipped, iterate and rerun.
4. Run Overlay typecheck plus document link/health checks required by the
   architecture and index changes.
5. Re-read the complete diff and task-owned file list, commit with the
   git-cc-required `dsw-33987` prefix, fetch, and push through normal hooks.

## Result

Implemented:

- the compact card now uses the existing 188-pixel logical thumbnail size as
  one CSS custom-property source instead of an unbounded minimum height;
- Delegated context and live activity now share
  `.subagent-progress-card__events`, so disclosure expansion increases the
  viewport's scroll range rather than the card's block size;
- the TODO footer remains outside that viewport and fixed to the card bottom;
- the stale non-collapsible `ChatBubble` header regression exposed by the
  original browser test was restored to the existing static-header contract.

Verified:

- `bun test packages/overlay/test/subagent-progress-input-markdown.test.ts packages/overlay/test/delegated-context-disclosure-alignment.test.ts packages/overlay/test/running-tool-wave.test.ts`
  — 8 passed, 0 failed;
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/subagent-progress-dock-browser.test.ts`
  — 1 passed, 0 failed through the required Node runner and real Vite page;
- the browser asserts three equal 188-pixel cards, invariant height before and
  after disclosure expansion, native activity overflow, reachable last
  activity, unchanged 12-pixel footer inset, exact-session Dock navigation,
  keyboard focus, Agent Rail location, and canonical refresh behavior;
- original-resolution review of
  `.scratch/subagent-delegated-context-collapsed.png` and
  `.scratch/subagent-delegated-context-expanded.png` confirms that the first
  full-width card and the following two-column cards stay visibly thumbnail
  sized while expanded Markdown remains inside the card;
- `bun run --cwd packages/overlay typecheck` and `git diff --check` passed;
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
  passed all historical-link checks and 84 of 85 document-health checks. The
  remaining tracked-file check was blocked only by two concurrent untracked
  July records already linked from the shared month index; this task's record
  is committed below, and the unrelated concurrent record remains owned by its
  parallel work.
