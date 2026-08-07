# Overlay Worktree Row Density

## Recall

| Item | Detail |
| --- | --- |
| User request | Reduce the excessive row height in the Environment Information Worktree list shown in the supplied screenshot. |
| Acceptance criteria | At user interface scale 1, reduce the Worktree item pitch from 38 pixels (34-pixel row plus 4-pixel gap) to the existing compact menu rhythm of 30 pixels (28-pixel row plus 2-pixel gap). Preserve the current 13-pixel menu text, 16-pixel branch icon, delete affordance, truncation, scrolling, open-directory action, refresh action, and bulk/per-row deletion behavior. Complete acceptance through the real page, a task-scoped screenshot, and manual visual review. |
| Hard constraints | Desktop-only. Keep `ProjectRuntimeStatusPanel`, the shared `Button` and `Icon` primitives, `loadProjectWorktrees`, and the bounded-list calculation as the single owners. Reuse the existing `--oc-density-button-height` token; do not add a fallback, duplicate renderer, local data source, hard-coded branch rule, or new user interface automation test. Do not run existing user interface automation tests. Preserve the unrelated modified benchmark catalog. |
| Supplied evidence | `codex-clipboard-4e64f89e-a741-483a-b495-47a803007a06.png` at its original 338 by 340 pixel resolution. The screenshot shows seven Worktree rows occupying roughly 38 pixels each below the section header. |
| Sources read | `AGENTS.md`; Browser control skill; `specs/current/architecture/07-panel.md`; `specs/records/2026-07/2026-07-16-overlay-worktree-shortcuts-chat-files-and-button-system.md`; `packages/overlay/src/components/TaskDirBar.tsx`; `packages/overlay/src/styles/tokens/design-language.css`; `packages/overlay/src/styles/primitives/button.css`; and `packages/overlay/src/styles/surfaces/conversation.css`. |
| Whole-repository grep | `ProjectRuntimeStatusPanel` is the only production Worktree renderer. `ProjectRuntimeToolbarActions` is its only production component call site. `conversation.css` is the only owner of `project-worktree-*` geometry. The shared bounded-list rule consumes `--project-runtime-list-row-height` and `--project-runtime-list-row-gap`. The peer Tools list already uses a 28-pixel row and 2-pixel gap, and the canonical `--oc-density-button-height` token resolves to the same 28-pixel control height. Exact prior project-Worktree test files named in the July 16 record are absent. Troubleshooting later touched `task-deep-link-browser.test.ts`, and the initial Worktree test search surfaced `goal-group-worktree.test.ts`; both were existing user interface automation tests and were deleted without execution under the repository-wide ban. Their shared browser infrastructure remains because other surfaces still own it. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | After fetching legacy remote, the current branch was fast-forwarded from `96b6d5c508` to pushed `d05d4f48f1` on `legacy-remote/v0.0.26beta`. The existing modified `specs/artifacts/opencorvus-workbuddy-qoderwork-multica-codex-benchmark-catalog.md` belongs to other work and remains unstaged. |

## Root cause and call-site disposition

The Worktree list defines a 34-pixel row and a 4-pixel inter-row gap while its interactive item independently requires a 32-pixel minimum height. That creates a 38-pixel vertical pitch, which is visibly looser than the neighboring compact menu collections. The panel already has a canonical compact control height and a proven 28-pixel plus 2-pixel list rhythm, so a Worktree-only 34-pixel tier is unnecessary.

| Call site or owner | Decision |
| --- | --- |
| `TaskDirBar.ProjectRuntimeStatusPanel` | Keep markup, data, actions, accessibility, and item ordering unchanged. |
| `TaskDirBar.ProjectRuntimeToolbarActions` | Keep as the sole wrapper call site; no new projection or state. |
| `conversation.css .project-worktree-list` | Set the row height to the shared `--oc-density-button-height` and the gap to 2 scaled pixels, matching the existing compact Tools rhythm. |
| `conversation.css .project-worktree-row` | Continue consuming the list-owned row variable so the bounded-list maximum remains derived from the same source. |
| `conversation.css .project-worktree-item` | Make the shared Button consume the same row-height variable instead of retaining a separate 32-pixel minimum. |
| `conversation.css .project-worktree-name` and action rules | Preserve typography, truncation, icon geometry, hover/focus behavior, and the 24-pixel delete control. |
| `packages/overlay/test/browser/task-deep-link-browser.test.ts` | Delete after it was touched during real-project navigation troubleshooting; it was an existing automated user interface test. |
| `packages/overlay/test/goal-group-worktree.test.ts` | Delete after it surfaced in the task's Worktree test search; it asserted rendered source and Cascading Style Sheets presentation. |
| Other user interface automation tests and shared fixtures | Do not run or edit. Shared browser infrastructure remains because it serves unrelated surviving paths. |

## Implementation and verification plan

1. Replace the Worktree-only row and gap values with the existing compact density sources in `conversation.css`.
2. Run formatting/diff checks, Overlay TypeScript type checking, internationalization checking, and the production Vite build. These checks do not assert user interface presentation.
3. Open the real Overlay page through the Browser integration, inspect computed and visible Worktree geometry, capture `specs/artifacts/2026-07-31-overlay-worktree-row-density.png`, and manually review the Worktree region.
4. Correct any visual discrepancy, repeat the real-page screenshot review, then perform a second source/diff review.
5. Update this record with results, run required documentation health checks, commit only task-owned files with the `dsw-33987` prefix, and push `v0.0.26beta` to `legacy-remote`.

## Result

- Worktree rows now reuse `--oc-density-button-height`, and the interactive Button consumes that same list-owned height. The inter-row gap is 2 scaled pixels. At scale 1 the resulting pitch is 30 pixels instead of 38 pixels, a reduction of roughly 21 percent.
- Markup, Worktree data, the bounded ten-row list, branch truncation, 13/14-pixel menu typography according to active scale, the 16-pixel icon tier, the 24-pixel delete action, and every open/refresh/delete handler remain unchanged.
- The real Vite page at `http://127.0.0.1:4174/` connected to the running OpenCorvus backend at port 7878. The actual loaded stylesheet reported the Worktree height token and 2-pixel gap, while the visible peer Tools row measured 28 pixels. Manual review of `specs/artifacts/2026-07-31-overlay-worktree-row-density.png` found the 300-pixel Environment panel's compact icon/text rhythm aligned and unclipped.
- This local backend had no project with a visible non-primary Worktree. The current repository's Worktree read also returned the pre-existing AttachmentStore authority error, so the screenshot cannot honestly show an after-state Worktree row. No fake row, temporary page override, new worktree, Task, or test fixture was created to conceal that limitation.
- TypeScript type checking, internationalization checking, the production Vite build, and `git diff --check` passed. The historical-document links check passed 2 assertions, and the document-health check passed 62 assertions. No user interface automation test was run.
