# Anonymous Project Deletion and Suffix

## Recall

| Item                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement           | Explain why the anonymous Projects in the supplied screenshot cannot apparently be deleted, make deletion work, and give anonymous Projects random suffixes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Acceptance criteria        | Deleting the active anonymous Project removes that Project without allocating an empty replacement; the workspace enters the existing directory-free global launcher; deleting a backend-owned anonymous Project removes its complete managed directory while named-project deletion continues to preserve source files; every anonymous Project row has a stable visible short suffix derived from its allocator-owned UUID; non-UI deletion contracts, typecheck/build, real-page interaction, inspected screenshot, second review, commit, and legacy remote push pass.                                                                                                                                                                                                                         |
| Hard constraints           | Preserve all concurrent worktree changes. Do not restart, refresh, terminate, or mutate the running production Overlay or database. Do not add a second random identity, fallback name source, deletion gate, compatibility path, UI automated test, temporary iframe, or client-owned anonymous allocator. Playwright/Browser Preview acceptance must use Node and an isolated real page.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Supplied artifact          | `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-e9a41126-d5bb-45f1-84c6-4619283ff170.png`, inspected at original resolution. It shows five visually indistinguishable `Anonymous project` rows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Read records               | `specs/records/2026-07/2026-07-29-global-new-chat-lazy-project-persistence.md`; `specs/records/2026-07/2026-07-28-projects-single-section-convergence.md`; `specs/records/2026-07/2026-07-27-fresh-temporary-project-per-global-launch.md`; `specs/records/2026-07/2026-07-12-project-delete-bootstrap-independence.md`; `specs/current/architecture/07-panel.md`.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Running-instance evidence  | Read-only log inspection found eight `DELETE /project/current` requests between 17:00:46 and 17:01:26, all completed with HTTP 200. The corresponding UI diagnostics say `Project deleted`. Read-only SQLite inspection then found five anonymous rows: four empty Projects created during that deletion sequence and one Project owning five Sessions. Deleted anonymous directories remained on disk with `.git` but without `.opencorvus`.                                                                                                                                                                                                                                                                                                                                               |
| Whole-repository grep      | Every `closeProject`, `openGlobalChatLauncher`, `createAnonymousProject`, `deleteProjectState`, `deleteCurrentProject`, `projectDisplayName`, `projectDirectoryLabel`, and `isImplicitProjectDirectory` definition/call site was enumerated. Production deletion has one Overlay caller in `main.tsx`, one service transport in `workspace.ts`, one route handler in `server/routes/project.ts`, and one backend implementation in `project/delete.ts`. `closeProject` is also the titlebar Close Project owner and therefore keeps its explicit-close replacement behavior. Anonymous display ownership is confined to `WorkLedger.tsx`, `Conversation.tsx`, `ProjectLedgerGroup.tsx`, and `utils/project-directory.ts`; the Projects row override in `WorkLedger.tsx` is the defect site. |
| Independent agent feedback | None requested. The repair is one coupled Project lifecycle and presentation change, and no sub-agent was authorized.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Root Cause

The delete requests did not fail. The active Project row and its OpenCorvus
state were deleted successfully, but `main.tsx::deleteWorkLedgerProject()` then
called `closeProject()`. That explicit Close Project lifecycle immediately
called `createAnonymousProject()`, so deleting the selected anonymous Project
created a new empty anonymous Project. Repeating the action created another
replacement each time.

At the same time, `WorkLedger.tsx::projectDisplayName()` discarded the UUID
directory identity for every canonical anonymous directory and returned the
same localized `Anonymous project` string. The replacement therefore looked
identical to the deleted row.

The backend deletion boundary also treated backend-owned anonymous directories
like user-owned named workspaces: it removed only `.opencorvus`, leaving the
server-created Git directory behind. Anonymous directories are allocated wholly
under `Global.Path.data/projects/YYYY/MM/DD/<UUID>` and are therefore owned by
OpenCorvus; preserving them after Project deletion is a resource leak, not
source-file protection.

Observable unchanged list -> successful active Project deletion -> generic
Close Project transition -> fresh anonymous allocation -> generic display label
hides changed UUID. Deleted row count and identity change, but the UI presents
an indistinguishable replacement.

## Call-Site Decisions

| Call site                                 | Decision                                                                                                                                                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.tsx::deleteWorkLedgerProject`       | After a committed deletion of the active Project, enter a deletion-specific directory-free workspace transition instead of `closeProject()`. Keep the existing Work Ledger refresh and success diagnostics.                                  |
| `workspace.ts::closeProject`              | Keep explicit titlebar Close Project semantics unchanged; it remains allowed to allocate a fresh anonymous owner.                                                                                                                            |
| `workspace.ts::openGlobalChatLauncher`    | Keep lazy Project persistence unchanged. Extract the shared directory-free transition so deletion and the global launcher use one implementation.                                                                                            |
| `workspace.ts` deletion transition        | Clear active/project-scoped state and clear `savedDirectory` only when it names the deleted Project. Do not allocate, persist, or infer another Project.                                                                                     |
| `WorkLedger.tsx::projectDisplayName`      | Render canonical anonymous Projects as a compact localized row label plus a stable short suffix from the existing UUID directory segment. Keep the full generic anonymous label for Conversation context. Do not generate client identity or use project-row title as a second suffix source. |
| `Conversation.tsx` anonymous label        | Keep the generic conversation context label; the request concerns Projects row identity, and the Work Ledger remains its owner.                                                                                                              |
| `project/delete.ts::deleteCurrentProject` | Preserve complete cancellation, row deletion, and Instance disposal. After disposal, remove the entire directory only when `ImplicitProject.isAnonymousDirectory()` proves it is backend-owned; named project source files remain untouched. |
| `server/routes/project.ts`                | Keep the one DELETE route and result contract; no route or SDK fork is needed.                                                                                                                                                               |
| `project-routes.test.ts`                  | Add a non-UI real-route contract proving anonymous root removal and retain the named source-preservation regression.                                                                                                                         |
| `workspace-active-directory.test.ts`      | Update only service-state/API assertions for the deletion-specific transition; do not assert rendered UI.                                                                                                                                    |
| UI automated tests                        | Do not add, modify, update, or run them. Validate row suffixes and deletion interaction through an isolated real page and manually inspect screenshots.                                                                                      |

## Implementation

1. Extract the existing directory-free workspace reset and expose one
   deletion-specific transition that does not allocate a Project.
2. Route committed active-Project deletion to that transition.
3. Derive a compact stable suffix from the allocator-owned UUID and append it to
   the localized anonymous Project row label.
4. Extend backend deletion so only canonical OpenCorvus-owned anonymous roots
   are physically removed after Project runtime disposal.
5. Run focused non-UI lifecycle tests, typecheck/build and document checks, then
   operate an isolated real page with Node, inspect the resulting screenshot,
   and perform a second diff review.

## Verification

- `bun test packages/overlay/test/workspace-active-directory.test.ts`: 25 pass,
  0 fail. The deletion transition clears active and saved directory state,
  persists settings, and makes no anonymous-allocation request.
- `bun test packages/opencorvus/test/server/project-routes.test.ts
  --test-name-pattern "deletes OpenCorvus project state without deleting source
  files|removes the complete backend-owned anonymous directory"`: 2 pass,
  0 fail. Named source files remain while the canonical anonymous root is
  removed.
- `bun run --cwd packages/opencorvus typecheck`: pass.
- `bun run --cwd packages/overlay typecheck`: pass.
- `bun run --cwd packages/overlay check:i18n`: pass.
- `bun run --cwd packages/overlay build:vite`: pass. Vite emitted only the
  existing Radix `use client` and chunk-size warnings.
- `bun test
  packages/opencorvus/test/script/historical-docs-links.test.ts`: 22 pass,
  0 fail.
- `bun test
  packages/opencorvus/test/script/product-docs-single-source.test.ts`: 8 pass,
  0 fail.
- `bun test packages/opencorvus/test/script/document-health.test.ts`: 63 pass,
  0 fail after the new indexed record was staged as required by the repository
  document-integrity contract.
- Isolated real-page acceptance used
  `OPENCORVUS_HOME=/tmp/opencorvus-anonymous-delete-visual.4AF0pl` and the real
  server at `http://127.0.0.1:47893/ui/`. Chrome showed five distinct anonymous
  rows, opened the active Project action menu, selected `Remove project`,
  confirmed `Delete`, and then showed exactly four rows. No replacement
  allocation appeared and the workspace entered its directory-free launcher.
- Immutable SQLite inspection found zero Project rows for the deleted directory,
  and filesystem inspection confirmed that the complete anonymous root no
  longer existed. The post-delete screenshot is
  `.scratch/anonymous-project-after-delete.png`; it was manually inspected and
  shows the remaining stable suffixes `93acec`, `986a98`, `fc9790`, and
  `711f99` without truncation or overlap.
- The isolated server and browser sessions were stopped after acceptance. The
  production Overlay process and database were not restarted or mutated.
