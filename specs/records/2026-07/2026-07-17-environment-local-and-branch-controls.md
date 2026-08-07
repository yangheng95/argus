# Environment Local And Branch Controls

## Recall

| Item | Evidence |
| --- | --- |
| Original user request | “这个里面的 local master 后的按钮点击没有效果；参考 Codex 调整。” The supplied image is `C:/Users/10132/AppData/Local/Temp/codex-clipboard-f92992a9-b487-45ce-859c-e0bf63c59ec2.png`. |
| Acceptance metrics | The Local and branch rows are real keyboard-accessible controls; each opens a visible task-scoped menu; Local exposes the current project directory plus the existing open/switch-folder actions; branch options come from the active repository and selecting another local branch updates the real Git checkout and the visible branch; errors remain visible; the desktop panel retains the supplied Codex information order, width, density, and no horizontal overflow; Node-launched Playwright interaction and region screenshots pass personal visual review. |
| Hard constraints | Reuse the Kobalte-backed `DropdownMenu` and shared `Button` primitives; keep `boardStore.vcs` and the project Git checkout as the only runtime sources; no temporary iframe, signal/query override, mocked screenshot result, fallback branch source, hard-coded branch list, state machine, process/window restart, new worktree, mobile scope, or unrelated Work Ledger edit; branch switching must use exact local branch refs and must not discard local changes. |
| Sources read | `AGENTS.md`; supplied image at original resolution; Browser and OpenAI Docs skills; fresh Codex manual; official Local-environment and Git-control guidance; `specs/current/architecture/{07-panel,99-principles}.md`; the 2026-07-15 environment parity, 2026-07-17 environment completion, right-Dock shortcuts, and task-hover/worktree records; current `TaskDirBar.tsx`, `conversation.css`, shared popup primitives, `workspace.ts`, `meta.ts`, `board.ts`, `app.ts`, `project/vcs.ts`, API client, focused source/server/browser tests, route generator, and current Git history/blame. |
| Whole-repository grep | Enumerated every `project-runtime-local`, `project-runtime-branch`, `ProjectRuntimeStatusPanel`, `openDirectory`, `browseDirectory`, `loadMeta`, `setVcs`, `/vcs`, `/vcs/diff`, `Vcs.info`, `Vcs.branch`, `VcsPrerequisiteError`, `DropdownMenu`, generated OpenAPI/Software Development Kit (SDK) route, locale label, environment-popover style, and task-dirbar browser-fixture call site. The static Local and branch `<div>` rows in `TaskDirBar.tsx` are the only broken renderers; `workspace.ts` owns the existing directory actions; `project/vcs.ts` owns Git metadata; `app.ts` owns the current `/vcs` routes; `meta.ts` is the overlay VCS request/store boundary. |
| Independent agent feedback | None. The user did not request sub-agents, and current collaboration policy does not authorize spawning them. |

## Evidence And Root Cause

Git blame and source inspection prove both chevrons were introduced as decoration inside static `<div>` rows. Neither row has a button role, focus semantics, open state, event handler, or data-loading path. This is not propagation failure or an overlay-dismiss bug: no interaction was implemented.

The existing architecture already supplies the Local half of the behavior through `activeDirectory()`, `openDirectory()`, and `browseDirectory()`. The branch half has only `GET /vcs`, so the UI cannot enumerate or select a branch without inventing client-side shell access. The root fix is therefore one project-scoped VCS contract plus two shared dropdown triggers, not click handlers that manufacture local menu data.

The fresh Codex manual confirms that Local uses the current project directory and that the desktop app exposes common Git controls while unexposed Git work remains terminal-owned. It does not document the exact Environment information dropdown contents. The supplied Codex screenshot is therefore the visual/semantic reference, while exact behavior is bounded by OpenCorvus's real project and Git sources.

## Call-Point Disposition

| Call point | Disposition |
| --- | --- |
| `project/vcs.ts::VcsPrerequisiteError` | Extend the typed prerequisite reasons for a missing requested local branch and a Git-refused branch switch; reuse the existing 412 mapping. |
| `project/vcs.ts::Vcs` | Add the strict branch schema, local-branch enumeration, and exact `git switch --no-guess` operation; reset cached branch observation only after Git succeeds. |
| `server/routes/app.ts` | Add documented `GET /vcs/branches` and `POST /vcs/branch` routes beside the existing `/vcs` source; no second route module. |
| `overlay/services/meta.ts` | Add strict branch payload parsing and branch-switch request functions beside `loadMeta`; after a successful switch, refresh through the existing `loadMeta` store path. |
| `TaskDirBar.tsx::ProjectRuntimeStatusPanel` | Replace only the Local and initialized-branch static rows with shared `DropdownMenu` + `Button` triggers; keep the parent environment Popover and existing source/worktree/tool projections. |
| `conversation.css` | Add only task-scoped menu width, row metadata, busy/check placement, and open-caret rotation while retaining the current 300-pixel environment shell. |
| `task-cwd-row-layout.test.ts` | Replace the obsolete “no DropdownMenu” assertion with shared-primitive, source ownership, accessible control, and exact route assertions. |
| `project/vcs.test.ts`, `server/vcs-routes.test.ts`, overlay service tests | Cover branch enumeration, successful switch, missing branch, Git-refused dirty switch, route/OpenAPI shape, strict overlay payload validation, and store refresh ownership. |
| `task-dirbar-keyboard.test.ts` | Exercise pointer and keyboard opening for both menus against the real browser fixture, select a server-backed branch, assert the POST and visible branch update, confirm no overflow, and capture goal/region-bound screenshots. |
| generated SDK/OpenAPI artifacts | Regenerate after the route contract lands and verify route parity. |
| `specs` indexes | Record this plan/result in the two canonical indexes without staging concurrent unrelated edits. |

## Implementation Plan

1. Add failing project and route tests for exact local-branch enumeration/switch behavior, then implement the single `Vcs` contract and regenerate route artifacts.
2. Add failing overlay service/source assertions, then replace the two inert rows with Kobalte-backed dropdown triggers wired to the current directory and VCS sources.
3. Extend the existing Node/Playwright task-dirbar fixture to prove visible menus, keyboard semantics, branch mutation, stable parent popover behavior, region geometry, and screenshots.
4. Run focused server/overlay tests, typecheck, internationalization, route parity, document health, and the Node browser checker. Inspect both Local and branch menu screenshots and correct visual mismatches.
5. Review the complete task diff independently against this Recall, append result evidence, commit with the `dsw-33987` prefix, and push the current main delivery branch to `legacy-remote` without including unrelated working-tree changes.

## Verification Plan

```powershell
bun test packages/opencorvus/test/project/vcs.test.ts packages/opencorvus/test/server/vcs-routes.test.ts
bun test packages/overlay/test/meta-service.test.ts packages/overlay/test/task-cwd-row-layout.test.ts packages/overlay/test/dropdown-menu-primitive.test.ts
bun run --cwd packages/opencorvus typecheck
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run packages/sdk/js/script/build.ts
bun run api:routes-check
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts
git diff --check
```

## Result

Implemented the two controls as shared `Button` triggers backed by the existing
Kobalte `DropdownMenu`. Local now exposes the canonical current project path,
native file-manager action, and directory picker. The branch menu reads exact
local refs from the new project-scoped VCS (Version Control System) route,
marks the current branch, switches without force/discard flags, and refreshes
the existing `boardStore.vcs` projection. Missing branches and Git-refused
dirty switches use the existing typed 412 prerequisite error and leave the
checkout untouched.

Real browser acceptance exposed one additional interaction cause that source
tests could not see: a modal child DropdownMenu competed with the parent
Environment Popover's focus/dismiss boundary. Both child menus now use the
library's non-modal nested-overlay mode, leaving the parent Popover as the sole
outer focus boundary. Pointer-open Local, native open-action invocation and
dismissal, keyboard-open branch selection, the exact `POST /vcs/branch`,
parent-panel persistence, and the visible branch update all pass in the
Node-launched Playwright scenario.

Verification evidence:

- project and route branch tests: 22 passed, 2 pre-existing skips, 0 failed;
- Overlay menu/service/layout/primitive tests: 16 passed with 311 assertions;
- Overlay typecheck, panel internationalization check, production Vite build,
  generated OpenAPI/SDK parity, API docs, and the legacy remote pre-push hook passed;
- task-scoped browser scenario passed in 6.0 seconds after the final build;
- `.scratch/task-dirbar-runtime-local-menu.png` and
  `.scratch/task-dirbar-runtime-branch-menu.png` were inspected at original
  resolution: both menus remain inside the desktop viewport with no horizontal
  overflow, the Local path/actions are legible, and the active branch has one
  clear checked state;
- document health, historical-link health, and product-doc single-source passed
  81 tests with 1,282 assertions; focused diff review and `git diff --check`
  also passed immediately before the final implementation commit.
