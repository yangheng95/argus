# Tool Disclosure Text Alignment And Hierarchy

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | In the expanded `Tools` transcript disclosure, keep the Tool identity icons on their current axis but align every revealed Tool name with the title-row Tool name; remove the visible large/small typography mismatch; make revealed content text slightly lighter than the title. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-ca7fa0d9-4388-4cbe-9f2e-b6cc2eba4628.png` was inspected at original resolution. The crop shows the aggregate/current Tool summary followed by multiple revealed Tool rows: wrench icons share one left axis, while the child names begin farther right and the text hierarchy is visually inconsistent. |
| Acceptance criteria | The summary Tool name and every revealed Tool name begin on the same horizontal axis when their icons are aligned; title, child Tool name, and child Tool detail use one explicit font size and line height; the title remains the stronger level and revealed names/details use one slightly lighter semantic foreground; one-line ellipsis, trailing disclosure state icon, chronology, keyboard behavior, expansion ownership, light/dark themes, and running-Tool text motion remain intact. |
| Hard constraints | Keep `CardParts.tsx` as the sole execution-disclosure renderer, generic `Card`/`CardHeader` as the sole revealed Tool-row renderer, and `messages.css` as the transcript-local presentation owner. Reuse existing Button, Card, Icon, typography, and theme primitives. Do not add a renderer, state source, fallback, compatibility selector, gate, mobile/responsive scope, User Interface (UI) automated test, fixture, assertion script, or screenshot baseline. Do not run existing UI automated tests. Use a real desktop page plus Browser interaction and personally reviewed screenshots. Preserve unrelated dirty-worktree changes and do not restart, refresh, close, or reuse the user's running OpenCorvus/Overlay process. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/12-overlay-card-system.md`; `2026-07-28-tool-disclosure-size-parity.md`; `2026-07-29-tool-call-tone-and-rhythm-convergence.md`; `2026-07-29-agent-wave-and-trailing-tool-disclosure.md`; `CardParts.tsx`; `Card.tsx`; `CardHeader.tsx`; `InlineToolPart.tsx`; `card.css`; `messages.css`; Button/Icon primitives and transcript typography tokens. |
| Whole-repository grep | Searches covered `ExecutionDisclosureRun`, `ExecutionEventRun`, `work-details-toggle`, `msg-work-details__tool-*`, `msg-transcript-disclosure__*`, nested Tool cards, `.card__head-main`, `.card__title`, `.card__subtitle`, `transcript-activity-*`, and every production consumer. `ExecutionDisclosureRun` is the only summary renderer. `ExecutionEventRun` reuses the canonical Tool `Card`. `messages.css` is the only transcript-local bridge between those two structures; no backend, store, route, message ordering, or disclosure-state owner participates in this visual defect. |
| Independent Agent feedback | None. The user did not request delegation, and current collaboration policy prohibits unrequested sub-agents. |
| Workspace preservation | Goal/Requirement disclosure, Right Dock tab, workspace, and panel-spec edits already present in the worktree are unrelated and must remain unchanged, unstaged, and uncommitted by this task. |

## Cause Chain

1. The summary Button and revealed Tool Card both render the same standard-size
   icon, which is why the icon axis already matches.
2. The summary Button uses `--oc-button-gap: var(--ui-gap-sm)`, while the
   revealed Card header and its inner Button retain separate `8px` gaps from
   the generic Card primitive. With equal icon geometry, the unequal
   icon-to-text intervals move only the revealed text axis.
3. The transcript has a shared `--transcript-activity-font-size`, but the title,
   nested Card header, Tool title, and Tool detail reach it through different
   inherited/custom-property rules and different weights. The numeric size can
   currently coincide while the authored hierarchy remains split and visually
   unstable.
4. The previous tone convergence deliberately made summary and revealed rows
   inherit one foreground. The current user requirement supersedes that visual
   choice: the title must remain the stronger level and revealed content must
   use one slightly lighter semantic foreground.
5. The root repair therefore belongs in the single transcript-local CSS owner:
   define one explicit Tool text geometry, share one icon-to-text gap across
   both structures, and separate title/content foreground tokens without
   changing markup, state, or data flow.

## Complete Call-Site Disposition

| Owner or consumer | Decision |
| --- | --- |
| `CardParts.tsx::ExecutionDisclosureRun` | Preserve markup, Tool summary projection, trailing state marker, accessible name, title, click handler, and expansion write. |
| `CardParts.tsx::ExecutionEventRun` | Preserve chronological event projection and canonical nested Tool Card reuse. |
| `Card.tsx`, `CardHeader.tsx`, `InlineToolPart.tsx` | Preserve generic Tool rendering and behavior. No component branch is required. |
| `messages.css::.msg-work-details` | Own explicit title/content foregrounds, one Tool font size/line height, and one icon-to-text gap. |
| `messages.css::work-details-toggle` | Consume the stronger title foreground and the shared gap. |
| `messages.css::nested Tool Card` | Consume the lighter content foreground, the same font geometry, and the same icon-to-text gap while preserving collapsed/expanded surface differences. |
| `card.css`, Button/Icon primitives, theme palette | Preserve globally; the request is transcript-local and must not change other cards or buttons. |
| Existing Overlay UI tests and fixtures | Do not add, modify, update, delete, or run. Visual acceptance is a one-off real-page interaction and screenshot review, not a repeatable assertion artifact. |

## Implementation And Verification Plan

1. Commit and push this Recall before product edits.
2. Replace the split transcript gap/typography/tone inheritance with one
   explicit title/content contract in `messages.css`.
3. Run Overlay formatting/typecheck/localization/build, documentation-health,
   and `git diff --check`; do not run UI automated tests.
4. Start an isolated current-source OpenCorvus page without disturbing the
   user's running process. Through the Browser skill, open the real desktop
   page, expand a Tool disclosure, inspect the exact row region and computed
   geometry, and capture a task-scoped screenshot for personal review.
5. If the screenshot still shows axis, scale, or hierarchy drift, correct the
   shared style owner and repeat the real-page review. Then re-grep owners,
   perform a second diff review, update this record with evidence, commit only
   task-owned paths, push `myhexin`, and verify remote convergence.

## Progress

- [x] Supplied screenshot, architecture, relevant history, renderer ownership,
      style inheritance, all production call sites, and dirty Git baseline
      inspected.
- [x] Recall, cause chain, complete call-site disposition, and verification
      plan recorded.
- [x] Recall committed as `cef52ea9aa` and pushed to the git-cc `myhexin`
      remote before the product edit.
- [x] Product implementation complete in the transcript-local style owner.
      `biome check`, Overlay typecheck, localization validation, Vite production
      build, and `git diff --check` passed without running a UI automated test.
- [x] Real-page visual acceptance and second review complete on an isolated
      current-source OpenCorvus server at `127.0.0.1:7886`, using a portable
      snapshot of the real local data so the user's running application was not
      restarted, refreshed, closed, or reused.
- [x] Product delivery committed as `662349a467`, pushed to `myhexin`, and
      verified at zero ahead/behind against
      `myhexin/work-v0.0.24beta-yr-0729`. Shared indexes already contain this
      record from the pre-change Recall commit; unrelated concurrent index and
      Overlay edits remain untouched.

## Real-Page Acceptance Evidence

- Opened the real Chat `修复公开开源项目缺陷` through the application command
  palette and expanded the real aggregate `bash` Tool disclosure containing
  five chronological Tool calls.
- The summary icon and all five revealed Tool icons measured
  `x = 363.0714px`. The summary Tool name and all five revealed Tool names
  measured `x = 383.0714px`; both structures now use the same `6px`
  icon-to-text gap.
- The summary Tool name and all five revealed Tool names measured
  `font-size: 14px`, `line-height: 21px`, and `font-weight: 500`.
- The title resolved to the stronger foreground `rgb(89, 97, 100)`, while each
  revealed Tool name/detail resolved to the deliberately lighter
  `color(srgb 0.34902 0.380392 0.392157 / 0.82)`.
- The personally reviewed screenshot is
  `specs/artifacts/2026-07-30-tool-disclosure-text-alignment.png`. It confirms
  aligned text axes, consistent type scale, a visibly quieter expanded
  hierarchy, preserved one-line ellipsis, preserved trailing disclosure
  marker, and unchanged chronological row order.
