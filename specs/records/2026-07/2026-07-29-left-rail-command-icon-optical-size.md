# Left-Rail Command Icon Optical Size

Status: complete

## Recall

| Item | Detail |
| --- | --- |
| User request | Inspect the two highlighted Search and Mailbox icons in the supplied OpenCorvus screenshot and enlarge them if they are smaller than the surrounding interface icons. |
| Acceptance criteria | The left-rail Search and Mailbox glyphs use the existing medium Icon tier and read at the same optical scale as nearby primary chrome icons, while their existing 20px button geometry, alignment, hover/focus behavior, labels, callbacks, Mailbox attention animation, and unread Badge remain unchanged. Overlay typecheck and production build pass. A real desktop page is opened, the affected region is captured, and the screenshot is inspected twice without creating, modifying, or running any UI automated test. The task-owned diff is committed with the `dsw-33987` prefix and pushed to `legacy-remote`. |
| Hard constraints | Desktop-only visual adjustment. Reuse the shared Icon primitive and its closed size tiers; do not add arbitrary pixel sizing, CSS transforms, a second icon implementation, fallback behavior, compatibility selectors, responsive/mobile scope, or UI automated tests. Preserve unrelated worktree changes and stage only task-owned hunks. Do not create a worktree or delegate to a sub-agent. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-88671d1b-524c-4240-b795-62f4f4140072.png` highlights the Search and Mailbox actions at the trailing edge of the left context bar. Original-resolution review shows both glyphs visibly lighter and smaller than the adjacent primary chrome. |
| Sources read | Root `AGENTS.md`; Browser control skill; `specs/current/architecture/99-principles.md`; `2026-07-22-left-rail-hover-and-action-column-convergence.md`; `2026-07-17-overlay-primitive-system-convergence.md`; current `App.tsx`, `Icon.tsx`, `Icon.types.ts`, `Icon.lucide.ts`, `icon.css`, `titlebar.css`, and `design-language.css`. |
| Whole-repository search evidence | Repository-wide searches for `workspace-contextbar`, `workspace-command-search`, `workspace-command-mailbox`, `work-ledger-search-toggle`, `<Icon name="search"`, and `<Icon name="mailbox"` show that `App.tsx` is the only renderer for this Search/Mailbox pair and `titlebar.css` is its only button-geometry owner. Both Icons currently omit `size`, so `Icon.tsx` resolves them to the 14px `standard` tier; the shared registry already exposes the 16px `medium` tier. Other Search and Mailbox occurrences belong to independent settings, field, panel, and notification surfaces and remain unchanged. No route, service, state, or responsive owner is involved. |
| Git baseline | The current branch is `work-v0.0.24beta-yr-0729`. After fetching `legacy-remote`, local `HEAD` is one already-recorded documentation commit ahead of `legacy-remote/work-v0.0.24beta-yr-0729`; unrelated conversation, Right Dock, test-formatting, and spec-index edits are present and must remain untouched. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration boundary forbids unrequested delegation. |

## Causal chain

1. The visible button boxes are already the canonical 20px left-rail action size, so the issue is not hit-target or column geometry.
2. Both highlighted Icons omit a size tier and therefore render through the shared 14px `standard` default.
3. The supplied screenshot shows the resulting Search and Mailbox strokes occupying less visual area than nearby primary chrome glyphs.
4. The Icon primitive already defines a 16px `medium` tier. Selecting that tier at the two semantic call sites fixes the optical hierarchy without changing the global default or unrelated icon consumers.

## Call-site disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/App.tsx` Search action | Set the existing Search Icon to `size="medium"`; preserve the Button and command-palette callback. |
| `packages/overlay/src/components/App.tsx` Mailbox action | Set the existing Mailbox Icon to `size="medium"`; preserve preview, attention animation, active state, accessibility attributes, and unread Badge. |
| `packages/overlay/src/styles/surfaces/titlebar.css` | Keep unchanged; the 20px button geometry and shared trailing centerlines are already correct. |
| Shared Icon registry and all other Search/Mailbox consumers | Keep unchanged; the closed medium tier already exists and other surfaces have independent density requirements. |

## Verification plan

1. Apply the two explicit shared-tier selections in `App.tsx`.
2. Run Overlay TypeScript checking and the production Vite build. Do not run UI automated tests.
3. Start the real Overlay with Node-backed browser tooling, capture the affected desktop region, and inspect the screenshot at original resolution.
4. Re-read the plan, re-grep the two renderers, review the exact task-owned diff and screenshot a second time, run the required historical/document health checks, then commit and push only this task.

## Progress

- [x] Supplied screenshot, relevant architecture/history, production owners, and git baseline inspected.
- [x] Whole-repository call-site search completed.
- [x] Shared Icon tiers applied.
- [x] Typecheck and production build complete.
- [x] Real-page screenshot and first visual review complete.
- [x] Second review, documentation health, commit, and legacy remote push complete.

## Verification evidence

- `bun run typecheck` in `packages/overlay`: passed.
- `bun run build` in `packages/overlay`: passed; Vite completed 7,055 transformed modules. Existing third-party `"use client"` and large-chunk warnings remain non-blocking.
- Real page: the already-running Node-hosted Vite page at `http://127.0.0.1:5173/` rendered the current source. Browser inspection measured both affected buttons at 20×20px and both nested SVG (Scalable Vector Graphics) glyphs at 16×16px with `data-size="medium"`.
- Task-scoped screenshot: `.scratch/2026-07-29-left-rail-command-icon-optical-size.png`. First browser review and a second original-resolution image review both show Search and Mailbox aligned on their existing columns and optically consistent with the nearby primary navigation glyphs.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`: historical links passed. Document health reached the real checker and reported only monthly-index links to untracked records: this task's new record plus the unrelated pre-existing `2026-07-29-conversation-edge-to-edge-surface.md`. The task record will become tracked in the delivery commit; the unrelated record is intentionally not staged by this task.
- Delivery commit `b244d9f88b` (`dsw-33987 enlarge left rail command icons`) passed the repository pre-push typecheck, route inventory, generated API documentation, Overlay i18n, and secret-scan hooks, then pushed successfully to `legacy-remote/work-v0.0.24beta-yr-0729`.
