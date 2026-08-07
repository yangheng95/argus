# 2026-07-25 Message Card Native Tooltip Shadow Repair

## Recall

| Item                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request               | Folding and expanding message cards produces an unexplained shadow. The supplied screenshots show a large gray, shadowed duplicate of the collapsed message summary remaining over the expanded card.                                                                                                                                                                                          |
| Acceptance                 | Hovering a collapsed message summary must not create a native long-text tooltip; expanding or collapsing the card must not leave a shadowed duplicate over the conversation; the visible three-line compact summary, one-click disclosure, identity metadata, and canonical fold-state behavior must remain unchanged.                                                                         |
| Hard constraints           | Fix the cause rather than masking the popup with CSS; keep one summary projection and one fold-state source; preserve unrelated dirty-worktree changes; add regression coverage; validate in an isolated real Vite/browser instance without restarting or refreshing the user's running OpenCorvus/Overlay process.                                                                            |
| Sources read               | `AGENTS.md`; Browser skill; both supplied screenshots; `2026-07-24-completed-message-card-auto-collapse.md`; `2026-07-22-card-expansion-ownership-repair.md`; `ChatBubble.tsx`; `CardHeader.tsx`; `Button.tsx`; `chat-bubble.css`; focused unit and browser tests.                                                                                                                             |
| Whole-repository grep      | `.chat-bubble__collapsed-preview` has one production renderer in `ChatBubble.tsx`; `.card__collapsed-preview` has one production renderer in `CardHeader.tsx`. Both place the complete summary in an HTML `title` attribute. The remaining `title` attributes on status, timestamp, short subtitle, controls, and activity counts do not own the collapsed long-text preview and are retained. |
| Independent agent feedback | None requested; no sub-agent was used.                                                                                                                                                                                                                                                                                                                                                         |

## Diagnosis

The screenshot is a native browser/WebView tooltip, not a CSS shadow. Both
collapsed-preview renderers copy the full compact summary into an HTML `title`
attribute. Hovering the preview therefore opens a platform tooltip containing
the whole message. When the same disclosure is clicked, the preview DOM is
removed while the platform tooltip can remain visible briefly over the newly
expanded body, creating the reported shadowed duplicate.

CSS cannot reliably style or dismiss a native `title` tooltip. The summary is
already visible inside the disclosure button, and the button exposes its
expanded state through `aria-expanded`, so duplicating the entire summary into
`title` adds no required interaction or accessibility semantics.

## Call-Site Disposition

| Surface                                                                       | Disposition                                                                                                                               |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/ChatBubble.tsx`                              | Remove the full-summary `title` from the message/Agent bubble collapsed preview; keep the visible preview and disclosure unchanged.       |
| `packages/overlay/src/components/CardHeader.tsx`                              | Apply the same correction to the structured Agent/stage-card collapsed preview so both render paths share the no-native-tooltip contract. |
| `packages/overlay/test/chat-bubble.test.ts`                                   | Assert that the message preview remains rendered but does not own a `title`.                                                              |
| `packages/overlay/test/card-expand-collapse-contract.test.ts`                 | Assert the same contract for `CardHeader`.                                                                                                |
| `packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts` | Verify the real collapsed preview has no `title`, hover it, capture the region, then expand through the same visible summary.             |

## Implementation And Verification Plan

1. Add failing source and browser assertions for the two preview renderers.
2. Remove only the long-text native tooltip attributes; do not change the
   summary text, clamp, card geometry, disclosure primitive, or fold store.
3. Run focused unit tests, Overlay typecheck, formatting, and document-health
   checks.
4. Run the Node-launched isolated Vite browser fixture, hover the collapsed
   preview, expand it, inspect the screenshots, and perform a second diff
   review.
5. Commit only task-owned files with the required `dsw-33987` prefix and push
   the current delivery branch to `myhexin`.

## Validation

### Passing Evidence

- `bun test packages/overlay/test/chat-bubble.test.ts packages/overlay/test/card-expand-collapse-contract.test.ts`
  - `13 pass / 0 fail`; covers both collapsed-preview renderers, shared
    disclosure ownership, conditional body mounting, and the absence of the
    long-text `title`.
- `bun run --cwd packages/overlay typecheck`
  - Pass.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - `21 pass / 0 fail`.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts`
  - `1 pass / 0 fail`, using the repository's Node-launched real browser and
    rebuilt Vite artifact.
  - The real collapsed preview reports `title === null`, remains within the
    existing 70–190px compact-height bound, is hovered for 1.2 seconds, expands
    through the same visible summary, and completes the existing body,
    Tool/Artifact, copy, keyboard, reload-persistence, and light/dark checks.
- Focused Prettier check and `git diff --check`
  - Pass for task-owned files.

### Visual Review

Reviewed the generated task-scoped screenshots:

- `.scratch/overlay-conversation-message-collapsed-hover-no-tooltip.png`
  shows the collapsed card after the native-tooltip dwell interval with no
  gray shadowed duplicate anywhere over the conversation.
- `.scratch/overlay-agent-message-collapsed-default.png` preserves the compact
  card geometry, identity row, disclosure, and visible activity summary.
- `.scratch/overlay-codex-message-expanded-default.png` shows the complete
  message, Tool disclosure, and Artifact after expansion with no residual
  tooltip over the body.

### Codex Review Feedback

The final real-browser replay exposed stale fixture assumptions that predated
this repair: the canonical compact preview now selects the latest Tool activity,
the app loads the project root through `/file`, and Agent bubbles are
intentionally transparent while nested Tool surfaces own their paint. The
fixture was updated to model `/file` and assert the current source-owned
summary/surface contracts. No product CSS or summary-selection logic was
changed. After those test-asset corrections, the original full browser checker
passed rather than stopping after the new tooltip assertion.
