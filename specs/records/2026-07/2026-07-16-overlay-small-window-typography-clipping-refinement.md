# Overlay Small-Window, Typography, And Descender Refinement

## Recall

| Item | Detail |
| --- | --- |
| User requests | On a small desktop window, reduce the width of the empty-home composer and its three suggestion cards; make every Settings text tier consistent with the main workspace; repair clipped descenders in the chat-header `Open in` label and composer model names such as `hexin/gpt-5.5`. |
| Acceptance criteria | The empty-home title, composer, and suggestion grid keep one shared centered width and become visibly narrower in a narrow desktop workbench; Settings page, section, body, navigation, row, search, and segmented-control text resolve through the application typography tokens; `Open in` and model text retain visible `p`/`g` descenders at desktop scale; focused source tests, TypeScript, i18n, Node-launched browser tests, and manually reviewed screenshots pass. |
| Hard constraints | Reuse the existing `chat-workbench` container, application typography tokens, `WorkspaceSplitLauncher`, `Button`, composer selector, Settings primitives, and existing isolated browser fixtures; no string-specific patch, fallback, duplicate width source, mobile/tablet scope, new worktree, or interference with the user's running OpenCorvus process; Playwright is launched with Node. |
| Supplied evidence | The first screenshot shows the composer and three cards consuming nearly the complete narrow workbench width. The Settings screenshot shows a locally enlarged 26/18/15px hierarchy beside the compact workspace. The third screenshot shows the descenders in `Open in` and `hexin/gpt-5.5` clipped by their line boxes. |
| Sources read | `AGENTS.md`; `specs/README.md`; the July Settings/composer convergence and Work Ledger/Worktree refinement records; `design-language.css`; `base.css`; `conversation.css`; `composer.css`; `settings.css`; `field.css`; `Conversation.tsx`; `WorkspaceEditorLaunchers.tsx`; `ExecutorSelector.tsx`; focused source and browser tests. |
| Whole-repository search | `rg` covered every `chat-home-composition-width`, `ui-chat-message-content-width`, `settings-font-*`, `workspace-editor-primary-label`, `workspace.editor_open`, and `composer-model-selector-value` production/test call point. `base.css` remains the message-width owner; `conversation.css` remains the empty-home and header-label projection owner; `settings.css` remains the Settings scale owner; `composer.css` remains the model-value owner. Existing command-palette, Settings resizer, titlebar toolbar, and executor-selector browser fixtures are the regression surfaces. |
| Independent agent feedback | None. The user did not request sub-agents and the three corrections converge on one Overlay token/layout surface. |
| Git baseline | Previous Work Ledger/Worktree work was isolated, committed as `84cc83693`, and pushed to the git-cc `origin` branch before this task. Unrelated existing Expert Squad generated/formatting changes remain unstaged and are excluded from this delivery. |

## Root cause

The empty-home composition always consumes the canonical 1040px message content width even when the desktop workbench has little remaining inline space, so the composer and cards retain only token-minimal margins. Settings then overrides the shared 20/15/14px application hierarchy with a local 26/18/15px ladder, causing an entire page-level scale discontinuity. Separately, two text nodes combine `overflow: hidden` with line-height values of `1` and `1.15`; at scaled raster boundaries those boxes are shorter than the font's full ascent/descent metrics and clip Latin descenders.

## Implementation plan

1. Add a documented large desktop container breakpoint token and project the empty-home width to a centered percentage only below that workbench threshold, while retaining `--ui-chat-message-content-width` as the upper bound and single canonical source.
2. Replace the Settings-only page, section, and body pixel sizes with `--ui-font-heading`, `--ui-font-title`, and `--ui-font-body`; keep navigation and controls on the existing `--ui-font-control` tier.
3. Replace the clipping-prone header/model line heights with the shared tight line-height token and extend browser geometry assertions using labels that contain descenders.
4. Update focused source tests, run the isolated home, Settings, header, and model browser fixtures, inspect fresh narrow-window and descender screenshots, and iterate on visual evidence.
5. Run Overlay TypeScript/i18n and documentation health, review the diff twice, commit only task-owned files with the `dsw-33987` prefix, and push the current git-cc branch.

## Verification

- Focused source tests for home width, Settings token ownership, and shared line-box behavior.
- Node-launched browser fixtures for the 1440px empty home, General Settings, chat-header editor launcher, and model selector.
- Fresh task-scoped screenshots inspected at original resolution.
- `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/overlay check:i18n`, historical-doc links, `git diff --check`, and final staged diff review.

## Result

- The empty-home composition keeps the canonical 1040px message-content cap on wide desktops and now resolves to 84% of a workbench narrower than the documented 1200px large-desktop breakpoint. The title, composer, and three-card grid remain one centered width owner.
- Settings page headings, section headings, body/search copy, row titles/descriptions, navigation, segmented controls, and the remaining Expert Squad catalog titles now resolve through the application 20/15/14px typography tokens instead of the retired 26/18/15px local ladder and private 18/16px exceptions.
- The chat-header editor label and composer model value use the shared 1.35 tight line box. Fresh screenshots show the `p` in `Open in` and both `g`/`p` descenders in `hexin/gpt-5.5` fully visible.
- Fresh isolated screenshots were manually inspected at original resolution: 1440px empty home, 1920px empty home, General Settings, Expert Squad Details, the closed message header, and the focused model selector. The 1440px home has materially wider side margins; the 1920px home retains the canonical width; Settings hierarchy remains readable; no glyph clipping remains.
- Focused source tests passed 44/44, Node-launched browser tests passed 5/5 plus the final Settings rerun, and Overlay TypeScript passed. Historical/document-health tests passed 74/74 against an isolated index that represented all concurrently authored records. The final git-cc pre-push hook then passed repository-wide TypeScript, API route inventory, docs generation, Overlay i18n, panel i18n, and secret scanning before the branch push completed.
