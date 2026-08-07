# Main Message Card Gradient

## Recall

| Item                    | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request            | “把主消息卡片也做成渐变色，看看效果” — make the main message card use a gradient as well and inspect the result.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Acceptance criteria     | Ordinary Agent-authored main Conversation cards and exact-session cards rendered by the same `ChatBubble` owner keep their existing neutral inset base while gaining a restrained static role-color gradient; User cards, compact Agent progress cards, geometry, content, motion, and interaction remain unchanged; the real desktop Overlay is opened, screenshotted, and personally reviewed.                                                                                                                                                                                                    |
| Hard constraints        | Reuse the existing `--card-stage` projection and the mature compact Agent-card gradient recipe. Keep `--conversation-card-background` as the single message/expanded-Tool surface source. Do not add raw colors, theme tokens, a second renderer, animation, fallback, compatibility branch, gate, state machine, temporary frame, synthetic message, or query override. Do not add, modify, update, delete, or run User Interface (UI) automated tests. Desktop-only visual acceptance.                                                                                                            |
| Supplied evidence       | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-1bc59db2-05f9-42ac-89ff-fda13f2cb43c.png` was inspected at original resolution. The main `ORCHESTRATOR` message card is a flat neutral gray while the compact `universal-build` Agent card below it already carries a restrained role-aware gradient.                                                                                                                                                                                                                                                                                            |
| Existing design history | `2026-07-30-conversation-neutral-surface-colors.md` made ordinary Agent message cards neutral and preserved stage identity outside the whole surface. The current request supersedes only its “no complete-surface tint” decision: the neutral base remains, but a low-opacity directional stage wash is now requested. `2026-07-30-work-card-static-wave-scope.md` remains authoritative that ordinary message surfaces are static and do not own the running wave.                                                                                                                                |
| Sources read            | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/12-overlay-card-system.md`; the two July records above; current `ChatBubble.tsx`, `SubagentProgressGrid.tsx`, `card-color.ts`, `chat-bubble.css`, `conversation.css`, `messages.css`, `card.css`, and light/dark theme palettes.                                                                                                                                                                                                                                                                          |
| Whole-repository grep   | Production searches enumerated all `--conversation-card-background`, `--card-stage`, `linear-gradient`, `.chat-bubble`, `.subagent-progress-card`, and exact-session consumers. `chat-bubble.css` is the sole ordinary Agent-message fill owner. `ChatBubble.tsx` is the shared main and exact-session renderer and already injects canonical `--card-stage`. `messages.css` inherits the message background for expanded Tool tone. `conversation.css` owns the sole mature compact Agent-card gradient and the separate running-wave pseudo-element. User cards have an independent token branch. |
| Git baseline            | Before this task, the related card-identity/activity changes were verified, committed as `16a0030300`, and pushed to `myhexin/work-v0.0.24beta-yr-0729`. Unrelated concurrent Composer, Right Dock, Progressive List, workspace, token, utility, spec, and screenshot changes remain unstaged and must not be altered or committed by this task.                                                                                                                                                                                                                                                    |

## Cause And Ownership

The main card is flat because the Agent-row branch in `chat-bubble.css` assigns
plain `var(--surface-inset)` to `--conversation-card-background`. This is the
single background consumed by the top-level `.chat-bubble` and by restrained
expanded Tool surfaces. The role color is already present as `--card-stage`;
there is no missing data path or component behavior.

The compact Agent card below it already uses the intended mature recipe: a
`135deg` linear gradient that mixes five percent of `--card-stage` into
transparency and fades out by forty-four percent. Reusing that formula on the
ordinary Agent branch, over its existing `--surface-inset` base, gives the main
card the requested direction without introducing a second palette or restoring
the earlier uniform stage-tinted fill.

| Owner / consumer                                       | Decision                                                                                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatBubble.tsx`                                       | Preserve canonical role normalization and inline `--card-stage`; no markup, state, or data attribute change is needed.                                                          |
| `chat-bubble.css` Agent-row token                      | Replace the flat Agent background value with the existing compact-card static gradient recipe layered over `--surface-inset`.                                                   |
| `chat-bubble.css` User-row token                       | Preserve the independent translucent neutral User-card material unchanged.                                                                                                      |
| `messages.css`                                         | Preserve its inherited `--conversation-card-background` consumption so expanded Tool material follows the one canonical card surface.                                           |
| `SubagentProgressGrid.tsx` / `conversation.css`        | Preserve the existing compact card gradient and its independently scoped running-wave behavior unchanged; it is the reusable design source, not a second implementation target. |
| `specs/current/architecture/12-overlay-card-system.md` | Replace the superseded flat-neutral statement with the neutral-base, restrained-static-stage-gradient contract while retaining the ordinary-card no-wave boundary.              |
| Existing UI tests / fixtures                           | Do not add, modify, delete, update, or run. Use type/build checks and real-page screenshot review only.                                                                         |

## Implementation And Verification Plan

1. Commit and push this Recall and its two indexes before product edits.
2. Change only the Agent-row `--conversation-card-background` owner and the
   current architecture statement.
3. Run formatting, Overlay TypeScript typecheck, the production Vite build,
   document health, the required historical-document link check, and
   `git diff --check`. Do not run UI tests.
4. Start the real Overlay through its supported runtime, open a real
   Agent-authored main message, capture the card region, and personally inspect
   gradient visibility, text contrast, card boundary, nested Tool material, and
   the unchanged static behavior.
5. Iterate from the screenshot if needed, then re-grep all owners, review the
   exact diff a second time, record evidence here, commit only task-owned files
   with the required `dsw-33987` prefix, push to `myhexin`, and confirm remote
   convergence.

## Verification Evidence

The final implementation keeps `chat-bubble.css` as the sole ordinary
Agent-card fill owner and layers the compact Agent card's existing `135deg`,
five-percent stage wash over the unchanged `--surface-inset` base. The
second whole-repository grep confirmed that `ChatBubble.tsx` remains the shared
main/exact-session role projection, the User branch remains independent,
`messages.css` still derives expanded Tool material from the inherited
conversation background, and only compact progress cards own the running-wave
pseudo-element.

The following non-UI checks passed after the product and architecture changes:

- targeted Prettier write and check;
- `git diff --check`;
- `bun run --cwd packages/overlay typecheck`;
- `bun run --cwd packages/overlay build`;
- `bun run docs:check`;
- `bun test --timeout 30000 packages/opencorvus/test/script/historical-docs-links.test.ts`
  with all 22 tests passing.

No UI automated test was added, modified, updated, deleted, or run. For
interactive acceptance, the source-built Tauri Overlay was connected to the
existing local OpenCorvus server and an existing Mission-authored conversation
was opened in the registered `test-E10-0730` project. The complete main message
card was scrolled into view and captured at 2900 by 1700 pixels in
`specs/artifacts/2026-07-30-main-message-card-gradient.png`.

Personal visual review confirmed a visible but restrained light-blue wash at
the Mission card's upper-left that resolves into the neutral inset surface
toward the lower-right. Text contrast, card boundary, nested scheduling
surface, layout, and interaction remained intact. The ordinary card stayed
static, while the separately scoped compact-card activity wave was not copied
onto it. The screenshot is one-time delivery evidence, not a UI test fixture or
baseline.

## Progress

- [x] Inspect the supplied screenshot, implementation owners, mature gradient,
      current architecture, historical decisions, and dirty Git baseline.
- [x] Record Recall, full call-site disposition, and validation plan.
- [x] Commit and push the pre-implementation plan.
- [x] Implement the single-owner gradient and architecture correction.
- [x] Complete static/build verification and real-page visual acceptance.
- [x] Complete second review and prepare the task-owned delivery commit.
