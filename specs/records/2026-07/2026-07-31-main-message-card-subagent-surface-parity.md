# Main Message Card And Sub-agent Surface Parity

## Recall

| Item                       | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request               | “把主消息卡片的渐变色底色改成跟子agent缩略卡片一样的底色” — keep the main message-card gradient, but make its base surface the same as the compact Sub-agent card.                                                                                                                                                                                                                                                                                                                           |
| Acceptance criteria        | Ordinary Agent-authored main Conversation cards and exact-session cards use the compact Sub-agent card's complete static background recipe: the existing five-percent role-color gradient over `--surface`. User cards, compact Sub-agent cards, geometry, content, motion, and interaction remain unchanged. A real desktop Overlay page is opened, screenshotted, and personally reviewed.                                                                                                 |
| Hard constraints           | Keep `--conversation-card-background` as the single main-card and expanded-Tool surface source. Reuse the existing compact-card recipe exactly; do not add a token, alternate renderer, fallback, compatibility branch, gate, state machine, animation, temporary frame, synthetic message, fixture, or query override. Do not add, modify, update, delete, or run User Interface (UI) automated tests. Preserve all unrelated worktree changes.                                             |
| Existing design history    | `2026-07-30-main-message-card-gradient.md` introduced the same gradient layer but deliberately retained `--surface-inset`; this request supersedes only that base-material choice. `2026-07-28-subagent-card-pulse-restraint.md` and the current compact-card CSS remain authoritative for Sub-agent motion and must not be changed.                                                                                                                                                         |
| Sources read               | Root `AGENTS.md`; Browser control skill; memory notes for compact Sub-agent card visual acceptance; `specs/current/architecture/12-overlay-card-system.md`; `2026-07-30-main-message-card-gradient.md`; `2026-07-30-conversation-neutral-surface-colors.md`; current `chat-bubble.css`, `conversation.css`, `messages.css`, `card.css`, and theme surface tokens.                                                                                                                            |
| Whole-repository grep      | Production searches enumerated every `--conversation-card-background`, `.subagent-progress-card`, `--surface`, and `--surface-inset` owner/consumer. `chat-bubble.css` is the sole ordinary Agent-message fill owner. `conversation.css` defines the compact card as the same gradient over `--surface`. `messages.css` inherits the main-card token for expanded Tool material. `ChatBubble` is shared by main and exact-session conversations. User cards retain their independent branch. |
| Independent agent feedback | None. The user did not request multiple independent agents, and the task has one CSS ownership point.                                                                                                                                                                                                                                                                                                                                                                                        |
| Git baseline               | `cd64867bc75a3121de4fdb4664a88357852e1681` on `v0.0.26beta`; `legacy-remote/v0.0.26beta` was `1325db251d5b41c18a788a2c2eb3ff7af6abe28e` after fetch. Existing screenshot deletions are unrelated and must remain unstaged.                                                                                                                                                                                                                                                                         |

## Cause And Ownership

The gradient layer is already identical between the main message card and the
compact Sub-agent card. Their visible difference comes from the final
background layer: the main card uses `--surface-inset`, while the compact card
uses `--surface`. The direct fix is therefore a single-source base-token change
in the Agent-row `--conversation-card-background`, not a new gradient or a
second styling branch.

| Owner / consumer                                                       | Decision                                                                                                                |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/styles/surfaces/chat-bubble.css` Agent-row token | Replace only the gradient's base layer from `--surface-inset` to `--surface`, matching the compact card recipe exactly. |
| `packages/overlay/src/styles/surfaces/conversation.css` compact card   | Preserve unchanged as the canonical reference recipe.                                                                   |
| `packages/overlay/src/styles/surfaces/messages.css`                    | Preserve inherited consumption so expanded Tool material continues to follow the one main-card background source.       |
| User-message branch                                                    | Preserve its independent translucent `--surface-inset` material.                                                        |
| `specs/current/architecture/12-overlay-card-system.md`                 | Update the base-material statement from `--surface-inset` to `--surface`.                                               |
| Existing UI tests and fixtures                                         | Do not modify, update, delete, or run. Validate static contracts plus a real-page screenshot and manual review.         |

## Implementation And Verification Plan

1. Commit and push this Recall and both indexes before product edits.
2. Change the sole Agent-row base layer and the current architecture statement.
3. Run targeted formatting, `git diff --check`, Overlay typecheck/build,
   documentation health, and the required historical-document link test.
4. Open the real desktop Overlay, navigate to a Conversation containing a main
   Agent card and compact Sub-agent card, capture the relevant region, and
   personally compare their resting base surface, gradient, contrast, and
   boundaries.
5. Re-grep all owners, review the exact diff a second time, record evidence,
   commit only task-owned paths with the required `dsw-33987` prefix, and push
   `v0.0.26beta` to `legacy-remote`.

## Verification Evidence

The implementation changes only the Agent-row gradient base from
`--surface-inset` to `--surface`. The compact Sub-agent card remains unchanged
and is now the exact complete resting-background source: both surfaces use the
same `135deg` gradient with a five-percent `--card-stage` wash fading to
transparent at forty-four percent, over `--surface`. Their canonical stage
values remain actor-specific, so identity color differs while the recipe and
neutral base match.

The following non-UI checks passed after the product and architecture changes:

- targeted Prettier write;
- `git diff --check`;
- Overlay TypeScript typecheck;
- production Vite build;
- product documentation health;
- the historical-document link contract.

No UI automated test was added, modified, updated, deleted, or run. For
interactive acceptance, the source Vite Overlay was started with Node and
connected to the existing local OpenCorvus server. The active real Conversation
placed an ordinary Orchestrator message card and a compact `universal-build`
Sub-agent card in the same 1280 by 720 viewport. Computed style inspection
reported `rgb(255, 255, 255)` for both resting base colors in the light theme,
and both background images resolved to the same gradient structure. The
actor-specific gradient color remained distinct as intended.

The viewport is captured in
`specs/artifacts/2026-07-31-main-message-card-subagent-surface-parity.png`.
Personal review at original resolution confirmed that both cards now share the
same white base material, the upper-left stage wash remains restrained, text
contrast and borders remain clear, and the compact card retains its separate
running treatment. The screenshot is one-time delivery evidence, not a fixture
or baseline.

## Progress

- [x] Inspect the current style owners, mature compact-card recipe, architecture,
      history, memory guidance, and dirty Git baseline.
- [x] Record Recall, complete call-site disposition, and verification plan.
- [x] Commit and push the pre-implementation plan.
- [x] Implement the single base-surface correction and architecture update.
- [x] Complete static/build validation and real-page visual acceptance.
- [x] Complete second review, commit the task-owned delivery, and push it.
