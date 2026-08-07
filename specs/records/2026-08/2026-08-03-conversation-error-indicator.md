# Conversation Error Indicator

Date: 2026-08-03

UI means User Interface. JSON means JavaScript Object Notation.

## Recall

| Item                    | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request            | The supplied screenshot shows a failed `CHAT` card with the complete error JSON painted as the first block in the message body and repeated in the overflow menu. The user requires the error to leave that body surface, move to a separate red exclamation-mark icon, reveal the complete reason on hover, and copy it on double-click.                                                                                                                                                                                                                                                   |
| Acceptance              | A failed Conversation card paints no standalone error block in its body. One persistent red alert icon replaces the ordinary error dot, exposes the exact canonical `errorReason` through the shared viewport-constrained Tooltip, and copies that exact value only on double-click. Copy feedback stays inside the Tooltip. The same error-copy action is removed from the overflow menu so one card has one error-detail surface.                                                                                                                                                         |
| Hard constraints        | Reuse the canonical `CardNode.errorReason`, Kobalte Tooltip, shared Button, and Lucide-backed Icon primitives. Do not add another error store, synthetic message, fallback, handwritten icon, UI automated test, fixture, or screenshot baseline. Do not run UI automated tests or interfere with the user's running OpenCorvus/Overlay process. Desktop-only scope.                                                                                                                                                                                                                        |
| Sources read            | `AGENTS.md`; `CLAUDE.md`; supplied screenshot; `specs/current/architecture/12-overlay-card-system.md`; the July error-chip, error-icon, tooltip, and overflow-action records; the August empty-error-card record; `ChatBubble.tsx`; `CardHeader.tsx`; `CardHeaderChrome.tsx`; Button, Icon, StatusIndicator, and Tooltip primitives; `chat-bubble.css`; `card.css`; tooltip/button primitives; and both locale catalogs.                                                                                                                                                                    |
| Whole-repository search | `tree-writer.ts` remains the canonical lifecycle/error projector. `ChatBubble.tsx` is the only body renderer of `.chat-bubble__error-reason`. `CardHeaderChrome.tsx` is the only current error-copy owner and renders it in the overflow menu. It has two production mounts: `ChatBubble.tsx` and `CardHeader.tsx`. `status-failed` is a circle-X rather than the requested exclamation mark; the installed Lucide dependency provides the mature alert-circle glyph required for a semantic `error-reason` icon. The shared Tooltip already owns viewport fitting and long-token wrapping. |
| Historical conflict     | The 2026-08-02 repair intentionally made contentless failed cards non-empty by painting the reason in the body. The current user requirement supersedes that presentation only: the failed card remains visible and its canonical reason remains fully discoverable and copyable through the persistent indicator. The card-tree projection is unchanged.                                                                                                                                                                                                                                   |
| Independent review      | The primary Agent will perform a second scoped diff review and real-page visual review. No child Agent is needed for this small, single-owner change.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Git baseline            | The current `work-v0.0.29beta-yr-0803` baseline and its concurrent committed work were pushed to `myhexin` before product edits. Unrelated parallel changes remain untouched.                                                                                                                                                                                                                                                                                                                                                                                                               |

## Causal Chain

1. `tree-writer.ts` correctly projects one canonical `errorReason` onto a failed
   `CardNode`.
2. `ChatBubble.tsx` paints that value as a body paragraph, so diagnostic JSON
   occupies the conversation reading surface.
3. `CardHeaderChrome.tsx` repeats the same value in the overflow menu and owns
   click-to-copy state there.
4. `ChatBubbleIdentity` independently paints the generic error status as a red
   dot, which has no detail or copy semantics.
5. The root correction is presentation convergence: replace the generic failed
   dot with one persistent semantic alert trigger, move Tooltip and clipboard
   behavior to that trigger, and delete the body and menu duplicates.

## Call-Site Disposition

| Owner / call site                           | Decision                                                                                                                                                                                                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tree-writer.ts` and `CardNode.errorReason` | Keep unchanged as the single canonical diagnostic source.                                                                                                                                                                                                            |
| `ChatBubbleIdentity`                        | Suppress the ordinary status dot only when a canonical failed reason exists.                                                                                                                                                                                         |
| `ChatBubble.tsx` identity row               | Mount the shared error indicator as a sibling of the disclosure Button so the trigger is valid interactive markup and remains visible at rest. Delete the body paragraph.                                                                                            |
| `CardHeaderChrome.tsx`                      | Own the reusable alert Tooltip and double-click copy behavior; delete the overflow-menu error item and its duplicate state. Keep the indicator mounted for structured cards and allow the Conversation row to position the same component outside hover-only chrome. |
| `CardHeader.tsx`                            | Continue delegating to `CardHeaderChrome`; structured cards receive the same persistent indicator without a second implementation.                                                                                                                                   |
| `Icon.lucide.ts`                            | Register one semantic `error-reason` name backed by Lucide's alert-circle primitive.                                                                                                                                                                                 |
| `chat-bubble.css`                           | Delete the retired body-error recipe and size the persistent indicator on the identity scan line.                                                                                                                                                                    |
| `card.css`                                  | Add only shared indicator and Tooltip content arrangement; keep shared primitive chrome authoritative.                                                                                                                                                               |
| Locale catalogs                             | Add accessible title and double-click hint; reuse `common.copied` for feedback.                                                                                                                                                                                      |
| UI tests                                    | Do not add, modify, update, or run.                                                                                                                                                                                                                                  |

## Implementation And Verification Plan

1. Commit and push this plan and current architecture update before product edits.
2. Implement the shared persistent alert indicator, hover/focus Tooltip, exact
   double-click clipboard copy, and in-Tooltip copied feedback.
3. Delete the Conversation body error paragraph and overflow-menu duplicate.
4. Run Overlay typecheck, localization validation, Vite build, document health,
   historical-link health, and `git diff --check`; do not run UI tests.
5. Start an isolated current-source Vite page without touching the running
   Overlay. Reach a real failed Conversation card, hover the alert icon,
   double-click it, capture the resting and Tooltip/copied states, and personally
   inspect the desktop screenshots.
6. Re-read the scoped diff and rendered evidence, commit only task-owned files
   with the `dsw-33987` prefix, fetch/reconcile git-cc, push the current branch,
   and verify remote equality.

## Verification Evidence

- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay check:i18n` passed after deleting the retired
  overflow-menu copy key from both locale catalogs.
- `bun run --cwd packages/overlay build:vite` passed after transforming 7,061
  modules. Existing third-party module-directive and large-chunk warnings
  remained warnings.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  passed both contracts.
- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`
  passed all 68 contracts after the concurrent branch-menu task committed its
  own previously untracked README target.
- A headed Node-driven Playwright session operated the isolated current-source
  Vite page at 1440 × 900 without adding or running a UI test. It opened a real
  historical failed Chat with two canonical `AI_InvalidPromptError` cards.
- The failed cards paint no body error block. Their persistent alert-circle
  triggers remain `rgb(216, 86, 102)` at rest and on hover; hover adds the
  twelve-percent danger background without replacing the red glyph.
- The Tooltip displayed the complete canonical reason and the localized
  double-click instruction. Double-click placed the exact 91-character reason
  on the real clipboard, changed the Tooltip feedback to `Copied`, and left no
  browser text selection.
- Keyboard-opening the same failed card's overflow menu showed only AgentTrace,
  operator guidance, and disabled rewind. It contained no error-reason item.
- Personally reviewed `.scratch/conversation-error-indicator-tooltip-red-final.png`,
  `.scratch/conversation-error-indicator-copied-red-final.png`, and
  `.scratch/conversation-error-indicator-menu-final.png` at their original
  desktop resolution.
- Every isolated Vite child process was terminated by its exact PID. Port 5193
  had no listening process after review, and the temporary preview Task was
  explicitly cancelled.
