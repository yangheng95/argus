# Left Dock Project Rename JSON Contract Repair

## Recall

| Field | Evidence |
| --- | --- |
| User request | “左侧dock的重命名项目不起作用”. |
| Acceptance criteria | The existing left-Dock project menu opens the existing rename dialog; confirming a non-empty changed name sends one directory-scoped `PATCH /project/current` with an `application/json` body containing the exact trimmed `name`; the backend persists the label; the canonical Work Ledger refresh shows it without reloading the running Overlay; malformed input and response handling remain strict; the anonymous-project promotion request keeps the same JSON transport contract; focused service, route, Vite/browser, screenshot, type, build, document-health, second-review, commit, and legacy remote push checks pass. |
| Hard constraints | Preserve the existing `ProjectLedgerGroup` → `main.tsx` → `workspace.ts` → `PATCH /project/current` ownership chain and Work Ledger projection; do not add a duplicate project-name store, optimistic fallback, compatibility path, gate, state machine, mobile/tablet scope, new worktree, or process restart/refresh; use Node for browser interaction and an isolated Vite fixture; preserve every unrelated dirty change; commit subjects use `dsw-33987`; push only to `legacy-remote`. |
| Runtime evidence | `~/.local/share/opencorvus/log/dev.log` records two real attempts at `2026-07-25T08:05:22Z` and `08:05:41Z`. Both reached `PATCH /project/current` and returned HTTP 400 because the validated JSON body was `{}` and `name` was `undefined`. The diagnostic ID is `runtime:work-ledger.project-rename`. SQLite inspection immediately afterward showed the affected project names still unset. |
| Sources read | Root `AGENTS.md`; Browser skill; `specs/current/architecture/07-panel.md`; `2026-07-16-project-actions-secondary-menu.md`; `2026-07-18-work-ledger-pin-and-automatic-right-dock-reveal.md`; `2026-07-25-anonymous-project-chats-promotion-and-attachments.md`; current `ProjectLedgerGroup.tsx`, `WorkLedger.tsx`, `main.tsx`, `workspace.ts`, `api.ts`, `tauri-transport.ts`, project/work-ledger routes and projections, and focused service/route/browser tests. |
| Git baseline | `v0.0.18beta` at `a04d15c851`, equal to `legacy-remote/v0.0.18beta` before this task. The worktree contains unrelated right-Dock/sub-agent changes; they remain untouched and unstaged by this task. |
| Independent agent feedback | None. The user did not request sub-agents; current collaboration policy forbids unsolicited delegation. |

## Causal Chain

1. The left-Dock menu, dialog, callback, and directory-scoped route selection
   are working: the real request log proves the action reaches
   `PATCH /project/current`.
2. `renameProjectRecord()` passes `JSON.stringify({ name })` without a JSON
   content type. `api.ts::bodyFromInit()` therefore correctly classifies the
   payload as transport text, and `tauri-transport.ts::applyBody()` declares it
   `text/plain;charset=utf-8`.
3. The backend uses `validator("json", CurrentProjectUpdateInput)`. With a text
   content type, the JSON validator receives no `name`, returns 400, and no
   project row changes.
4. The service regression explicitly expected `{ kind: "text" }`, while the
   browser fixture called `req.json()` without asserting the request content
   type. Both tests encoded the defect instead of exercising the server's
   content-type-sensitive contract.
5. The same whole-repository audit finds exactly one sibling violation:
   `promoteAnonymousProject()` in `workspace.ts` also stringifies JSON without
   declaring it. All other `apiJson`/`apiRequest` JSON-body call sites under
   `packages/overlay/src/services` already declare JSON.

## Whole-Repository Search Evidence

- `ProjectLedgerGroup.tsx` is the only project-row rename action owner.
- `main.tsx::renameWorkLedgerProject()` is the only rename-dialog owner and the
  only production caller of `renameProjectRecord()`.
- `workspace.ts::renameProjectRecord()` is the only Overlay writer for
  `PATCH /project/current`; `promoteAnonymousProject()` is the only sibling
  JSON-body call in the same service with the same missing-header defect.
- `api.ts::bodyFromInit()` and each HostTransport remain the single body-encoding
  source; they must not guess that arbitrary strings are JSON.
- `ProjectRoutes` and `Project.update()` are the only backend rename
  route/persistence owners, and already emit the canonical `project.updated`
  event consumed by Work Ledger.
- TypeScript AST enumeration of every `apiJson`, `apiRequest`, and
  `apiJsonWithTimeout` object literal under `packages/overlay/src/services`
  reports only the two `workspace.ts` requests as having a body without
  headers.

## Call-Site Disposition

| Surface | Decision |
| --- | --- |
| `workspace.ts::renameProjectRecord` | Declare `Content-Type: application/json`; preserve the path, payload, strict validation, and refresh ownership. |
| `workspace.ts::promoteAnonymousProject` | Apply the same required JSON declaration because the exhaustive audit proves the identical transport defect. |
| `project-actions-service.test.ts` | Replace the defect-encoding text-body assertion with the canonical JSON transport body and header; add promotion coverage so the sibling cannot regress. |
| `project-ledger-group-browser.test.ts` | Assert the real rename request content type and payload before accepting the refreshed visible name. Keep the existing desktop interaction and screenshot surface. |
| Backend project/work-ledger route tests | Keep canonical persistence/event coverage; add no parallel route or schema. |
| `api.ts`, HostTransport, route schemas, Work Ledger stores | Keep unchanged. Their current strict behavior exposed the missing caller contract and is the single source of truth. |

## Implementation And Verification Plan

1. Commit and push this Recall/index checkpoint without staging unrelated
   worktree changes.
2. Add the failing service and real browser transport assertions.
3. Repair the two audited `workspace.ts` JSON requests at their canonical
   caller boundary.
4. Run focused Overlay service, API-directory, project route, and Work Ledger
   route tests; then Overlay typecheck, localization check, and production build.
5. Run the project-row Vite fixture through Node, perform rename via the visible
   left-Dock menu, inspect the desktop screenshot at original resolution, and
   correct any interaction or visual regression.
6. Run document-health checks, re-enumerate body/header call sites, review the
   exact diff and staged ownership, fetch legacy remote, commit with `dsw-33987`, and
   push through normal hooks.

## Progress

- [x] Read governing rules, historical decisions, current implementation, real
  logs, database state, transport owners, and focused tests.
- [x] Reconstruct the observable → trigger → root cause → missing-test chain.
- [x] Enumerate all relevant request-body call sites and sibling violations.
- [x] Commit the Recall/index checkpoint; the normal push hook correctly
  rejected unrelated concurrent sub-agent projection type errors, so no hook
  bypass was used.
- [x] Add regressions and implement the caller-contract repair.
- [x] Complete real Vite/browser screenshot acceptance and second review.
- [x] Commit the verified implementation.
- [x] Push the verified commits through the normal legacy remote hook.

## Result And Verification

- The real failure was reproduced from `dev.log`: two left-Dock rename attempts
  reached `PATCH /project/current` but returned 400 because the request content
  type was text and the backend JSON validator received no `name`.
- `renameProjectRecord()` and the exhaustively identified sibling
  `promoteAnonymousProject()` now declare `application/json`. The canonical
  `api.ts::bodyFromInit()` converts both to `{ kind: "json" }`; no transport or
  backend schema was weakened.
- `project-actions-service.test.ts` now asserts the exact JSON headers and
  decoded bodies for both requests. The prior assertion that explicitly
  expected the broken text body was removed.
- Focused Overlay service and directory-policy coverage passed 103 tests.
  Focused backend rename validation passed 2 tests, and opened-project
  projection/event coverage passed 2 tests.
- The TypeScript AST audit of every `apiJson`, `apiRequest`, and
  `apiJsonWithTimeout` object-literal call under `packages/overlay/src/services`
  reports no body-bearing request without declared headers.
- The Node-launched Vite/browser project fixture passed after asserting the
  rename request's `application/json` content type and exact `name` payload,
  then waiting for the refreshed Work Ledger title.
- `.scratch/left-dock-project-rename-result.png` was inspected at original
  resolution and again through the isolated in-app browser. It visibly shows
  `Ledger Browser Project` in the existing left-Dock hierarchy with unchanged
  row geometry and no duplicate chrome.
- Overlay localization validation, typecheck, and production Vite build passed.
  The first normal push attempt exposed unrelated concurrent
  `subagent-presentation.ts` type errors; after that parallel implementation
  corrected them, the full nine-package hook typecheck passed. The next hook
  exposed OpenAPI drift from the same concurrent delegated-worker contract
  changes. The canonical SDK and API documentation generators synchronized
  those derived artifacts, after which `api:routes-check` and `docs:check`
  passed without bypassing the hook or modifying the concurrent source edits.
- The final normal legacy remote hook passed all nine package typechecks,
  `api:routes-check`, `docs:check`, Overlay localization validation, and the
  tracked-source secret scan. Commit `c11ff8ade4` reached
  `legacy-remote/v0.0.18beta`; concurrent worktree changes remained unstaged and
  uncommitted by this repair.
