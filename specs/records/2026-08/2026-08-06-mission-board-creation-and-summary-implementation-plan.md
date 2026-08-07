# Mission Board Creation and Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared Mission status summary, durable manual Mission drafts with explicit dispatch, and immediate Artificial Intelligence Mission creation to the Mission-first board.

**Architecture:** Keep Mission Session metadata and visible Session messages as the only durable facts. A pending prompt is a one-shot operator request, not a status; manual dispatch consumes it through the existing streaming Mission wake path. One shared Overlay Mission-list projection feeds both the left navigation summary and the board.

**Tech Stack:** Bun, TypeScript, Zod, Hono, SolidJS, Kobalte Dialog, generated OpenAPI Software Development Kit, existing OpenCorvus Session and Mission services.

## Global Constraints

- Mission is the top-level card and count identity; child Task remains nested execution detail.
- Do not persist Mission status, board column, dispatch state, or workflow step.
- Do not change the database schema.
- All dispatched prompts are visible user messages through the existing streaming Mission path.
- Expert Squad selection uses the immutable Mission-held snapshot.
- Do not add, change, or run User Interface automation tests.
- Positive non-User-Interface contracts must fail before production implementation is written.
- Use exact-file staging; preserve unrelated `.superpowers/`; commit subjects begin with `dsw-33987`; push to `legacy-remote`.

---

### Task 1: Pending-prompt Mission contract

**Files:**
- Modify: `packages/opencorvus/src/mission/schema.ts`
- Modify: `packages/opencorvus/src/mission/session.ts`
- Modify: `packages/opencorvus/src/mission/projection.ts`
- Test: `packages/opencorvus/test/mission/pending-prompt.test.ts`

**Interfaces:**
- Consumes: existing `metadata.mission`, immutable `MissionVisibleExpertSquadIDs`, `Session.mergeMetadata`, and `MissionRecord`.
- Produces:

```ts
const MissionPendingPrompt = z.object({ text: z.string().trim().min(1).max(32_000) })
function missionPendingPrompt(session: Session.Info): MissionPendingPromptValue | undefined
function setMissionPendingPrompt(input: { session: Session.Info; pendingPrompt?: MissionPendingPromptValue }): Promise<Session.Info>
```

- [x] Write a positive Mission projection contract that creates a Mission, records `{ text: "Prepare the release plan" }` in canonical Session metadata, and reads the same validated fact through `MissionRecord.pendingPrompt`.
- [x] Run `bun test packages/opencorvus/test/mission/pending-prompt.test.ts` and confirm failure because the pending-prompt projection does not exist.
- [x] Add the strict schema and one Mission metadata read/write helper that replaces the complete nested Mission metadata object while preserving its existing fields.
- [x] Project the optional pending prompt through `MissionRecord`.
- [x] Re-run the focused pending-prompt contract and confirm it passes.
- [x] Commit the independently verified metadata contract (`0f6cb744f5`).

### Task 2: Manual create and dispatch routes

**Files:**
- Modify: `packages/opencorvus/src/server/routes/mission.ts`
- Create: `packages/opencorvus/test/mission/draft-route.test.ts`
- Modify generated outputs: `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/**`, `packages/sdk/js/dist/**`

**Interfaces:**
- Consumes: `ensureMissionSession`, `resolveMissionLaunchExpertSquadIDs`, `setMissionPendingPrompt`, `missionPendingPrompt`, `resolveAgentModel`, `SessionWake.wake`.
- Produces:

```ts
type MissionDraftInput = { title: string; request: string; expertSquadIDs?: string[] }
type MissionDispatchInput = { model?: string }
POST /mission/draft -> MissionRecord
POST /mission/:missionID/dispatch -> MissionWakeResult
```

- [x] Write a positive route contract that creates a named backlog Mission with the requested immutable Expert Squad and persisted pending prompt.
- [x] Write a positive route contract that dispatches that Mission, persists the exact visible user prompt, and returns the Mission wake receipt with the same Mission and Session identities.
- [x] Run `bun test packages/opencorvus/test/mission/draft-route.test.ts` and confirm both contracts fail because the routes do not exist.
- [x] Implement draft creation by reusing Mission Session and Expert Squad authority; do not call a model.
- [x] Implement dispatch by reading the pending prompt, resolving the existing Mission model, calling the canonical streaming wake service, and clearing the consumed metadata fact after wake acceptance.
- [x] Re-run the focused pending-prompt and draft route contracts together; all three positive contracts pass.
- [x] Run `bun run build` in `packages/sdk/js`, regenerate the English and Simplified Chinese Application Programming Interface references, then run root `bun run api:routes-check`.
- [x] Commit the independently verified route and generated Software Development Kit contract (`a5b6083217`).

### Task 3: Shared Mission board projection

**Files:**
- Create: `packages/overlay/src/services/mission-board.ts`
- Modify: `packages/overlay/src/services/mission.ts`
- Modify: `packages/overlay/src/services/work-ledger.ts`
- Modify: `packages/overlay/src/components/MissionBoard.tsx`
- Modify: `packages/overlay/src/components/WorkLedger.tsx`
- Test: `packages/overlay/test/mission-board-summary.test.ts`

**Interfaces:**
- Consumes: paged `loadMissions`, Work Ledger refresh revision, connection status, and Work Ledger Project rows.
- Produces:

```ts
type MissionBoardCounts = Record<MissionBoardLane, number>
const missionBoardStore: { records: MissionRecord[]; loading: boolean; error: string }
function reloadMissionBoard(): Promise<void>
function missionBoardCounts(records: readonly MissionRecord[]): MissionBoardCounts
function workLedgerProjectDirectories(): string[]
```

- [x] Write pure positive contracts that map Mission records to exact five-lane counts and retain sorted unique Work Ledger Project directories.
- [x] Run each focused pure contract before its implementation and confirm failure because its exported projection does not exist.
- [x] Implement the shared paged loader and pure count projection.
- [x] Retain canonical Work Ledger Project rows in its existing runtime projection and expose sorted unique directories.
- [x] Replace Mission Board's private loader with the shared store and invoke the shared refresh from Work Ledger's existing online/refresh lifecycle.
- [x] Re-run the two focused pure contracts and Overlay typecheck. Do not run User Interface tests.
- [x] Commit the shared projection (`ea5342788b`).

### Task 4: Navigation summary and creation experience

**Files:**
- Create: `packages/overlay/src/components/MissionCreateDialog.tsx`
- Modify: `packages/overlay/src/components/MissionBoard.tsx`
- Modify: `packages/overlay/src/components/WorkLedger.tsx`
- Modify: `packages/overlay/src/main.tsx`
- Modify: `packages/overlay/src/styles/surfaces/mission-board.css`
- Modify: every owned Overlay locale bundle containing Mission Board copy

**Interfaces:**
- Consumes: shared Mission records/counts, `createMissionDraft`, `dispatchMission`, existing `wakeMission`, composer model, Project directories, and Expert Squad catalog.
- Produces: one create dialog, one running-count navigation badge, one five-lane hover overview, and pending-prompt card Dispatch action.

- [x] Extend `WorkLedgerNavigationAction` with a trailing slot and custom tooltip content, and use them only on the Task Board row.
- [x] Build the manual/Artificial Intelligence dialog with existing primitives, explicit Project and Expert Squad selection, form validation, submitting state, and visible errors.
- [x] Add the board-header Create Task action and pending-prompt card Dispatch action.
- [x] Wire manual creation to `POST /mission/draft`, keeping the board open and refreshing shared facts.
- [x] Wire Artificial Intelligence creation to existing `POST /mission/wake`, and dispatch to `POST /mission/:missionID/dispatch`; open the returned Mission conversation and refresh shared facts.
- [x] Add localized labels and Mission-board styles using existing design tokens.
- [x] Run Overlay typecheck, localization check, and production build. Do not run User Interface tests.
- [x] Commit the compiled User Interface slice (`526497e8c5`).

### Task 5: Real-page verification and delivery

**Files:**
- Create screenshot evidence: `specs/artifacts/mission-board-summary-and-create.png`
- Create screenshot evidence: `specs/artifacts/mission-board-manual-draft.png`
- Create screenshot evidence: `specs/artifacts/mission-board-ai-create.png`
- Modify: this implementation plan with final facts.

**Interfaces:**
- Consumes: a real local OpenCorvus server, current compiled Overlay, and isolated current-schema database.
- Produces: manually inspected desktop evidence and verified legacy remote delivery.

- [x] Start the real page against an isolated current-schema database.
- [x] Confirm the left row shows the running Mission count and hover shows all five counts; capture and personally inspect a desktop screenshot.
- [ ] Create a manual Mission, confirm its backlog card and Dispatch action, dispatch it, and confirm the visible Mission conversation opens. The draft and Dispatch surface were verified on the real page; the isolated runtime had no configured model, so live conversation startup remains unverified. The positive route contract verifies that dispatch sends the stored prompt as the visible Mission user message.
- [ ] Open Artificial Intelligence mode, submit a request, and confirm the created Mission conversation opens immediately. The complete form was verified on the real page; live model-backed submission remains unverified because the isolated runtime intentionally has no credentials or model configuration.
- [x] Correct every observed layout, clipping, focus, loading, token, or interaction defect and capture fresh screenshots.
- [x] Run focused non-User-Interface tests, package typechecks, localization, generated route check, documentation checks, historical links, document health, production build, and `git diff --check`.
- [x] Remove one-off browser scripts, complete a second diff/status review, commit exact files, and push the branch to `legacy-remote` (`7a18b893c5`).

### Task 6: Rebuild the Windows desktop client package

**Produces:**

- `packages/overlay/dist-artifacts/windows-x64/opencorvus-overlay.exe`
- `packages/overlay/dist-artifacts/windows-x64/OpenCorvus_0.0.32-beta_x64_en-US.msi`
- `packages/overlay/dist-artifacts/windows-x64/OpenCorvus_0.0.32-beta_x64-setup.exe`

- [x] Commit and push the exact Mission Board implementation and visual evidence before packaging so the package source is immutable.
- [x] Run `bun run version:check` and confirm the canonical package version `0.0.32-beta`.
- [x] Run `bun run package:gui-installer-matrix` without a shortcut or skipped build, with the documented Node.js heap allocation.
- [x] Run the independent release-asset checker against the staged Windows x64 directory.
- [x] Record artifact names, byte sizes, timestamps, and Secure Hash Algorithm 256-bit hashes; confirm the package was rebuilt after the Mission Board commit.

## Final package evidence

- Immutable source: local `HEAD` and `legacy-remote/work-lcx-0.0.31beta-0806` both remained `7a18b893c5eb3c2d4f277a23af997f188a1cf614` before and after packaging.
- The canonical GUI installer matrix completed the Software Development Kit build, 7,077-module production Overlay build, embedded backend and runtime payload, Tauri executable, Microsoft Installer, Nullsoft Scriptable Install System installer, staging, and its real Windows x64 checker. Non-host Linux and macOS rows were explicitly skipped.
- A separate `check-release-assets.ts ... --require-bundle` invocation accepted the staged Windows x64 directory.

| Artifact | Bytes | Generated | Secure Hash Algorithm 256-bit |
| --- | ---: | --- | --- |
| `opencorvus-overlay.exe` | 219,297,280 | 2026-08-06 18:05:43 | `7A9524B83E1F9D1C1BFE879BAD93863A5D28A2C372BBF5E17D4F6671017DF431` |
| `OpenCorvus_0.0.32-beta_x64_en-US.msi` | 210,620,416 | 2026-08-06 18:06:03 | `117B2D9A3E7D4100B3ACC55225B86422A643ECC6E44A16BF474232AB87E69C09` |
| `OpenCorvus_0.0.32-beta_x64-setup.exe` | 210,070,896 | 2026-08-06 18:06:25 | `3D4FB5E2E4A7F0BF5387CF0B1FEA05493E5AE7CA20A219BE775ABBD1EC7E0E96` |

## Plan self-review

- Spec coverage: navigation count, five-lane hover, shared source, manual create, delayed dispatch, immediate Artificial Intelligence create, project and Expert Squad selection, refresh, and real-page review each map to one task.
- Placeholder scan: no deferred implementation owner or unspecified error behavior remains.
- Type consistency: `MissionPendingPrompt`, `MissionRecord.pendingPrompt`, `MissionDraftInput`, `MissionDispatchInput`, `MissionBoardCounts`, and the three Overlay callbacks retain the same names across producer and consumer tasks.
- Scope: no child-Task creation, status mutation, schema change, person-assignee model, mobile work, or second message path is introduced.
