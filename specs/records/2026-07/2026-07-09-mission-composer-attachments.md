# Mission Composer Attachments

Date: 2026-07-09
Status: In Progress
Owner: Codex

## Recall

### User Request

The user reported that uploading files and folders from the input box has bugs, then clarified that Mission should not be treated as unable to upload attachments.

### Acceptance Criteria

- The shared composer must let Mission, Chat, and Task submissions use the same file and folder attachment controls.
- A new Mission submission must POST selected attachments to `/mission/wake`; it must not reject them in the overlay.
- The Mission wake user message must persist the text and attachment file parts through the existing `SessionPrompt` / `AttachmentStore` materialization path.
- Uploaded files and every file selected through folder upload must be durably archived under the project `.opencorvus` runtime via `AttachmentStore`; no Mission/Chat/Task path may depend on browser-memory data URLs after submit.
- Folder upload must preserve a readable relative-path filename in the resulting attachment inventory.
- Existing scheduler and child-task Session wake behavior must remain text-only unless their callers provide explicit parts.
- Tests must cover overlay Mission submit payloads, backend route forwarding, and `SessionWake` persistence of data URL attachments.

### Hard Constraints

- No fallback path, no duplicate attachment store, no hidden synthetic message split.
- Do not hide Mission attachment buttons as a workaround.
- Do not restart or interfere with the user's running OpenCorvus / overlay process.
- Preserve unrelated dirty worktree changes.
- Use existing mature `SessionPrompt.createUserMessage` and `AttachmentStore` materialization instead of hand-writing a second attachment persistence path.
- User clarification 2026-07-09: uploaded files and folders must be stored in `.opencorvus` for durable recordkeeping, preventing later agent forgetting or byte loss.

### Sources Read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-08-composer-file-loader-right-toolbar-hover.md`
- `specs/current/architecture/07-panel.md`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/services/chat.ts`
- `packages/overlay/src/services/task.ts`
- `packages/overlay/src/services/mission.ts`
- `packages/overlay/src/main.tsx`
- `packages/opencorvus/src/server/routes/mission.ts`
- `packages/opencorvus/src/session/wake.ts`
- `packages/opencorvus/src/session/prompt/index.ts`
- `packages/opencorvus/src/session/prompt/schema.ts`
- `packages/opencorvus/src/session/prompt/parts.ts`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/test/mission/wake-route.test.ts`
- `packages/opencorvus/test/session/wake.test.ts`

### Repository Search Evidence

- `rg -n "webkitdirectory|directory|folder|folder upload|upload|file input|input.*file|DataTransferItem|showOpenFilePicker|showDirectoryPicker|attachments|Attachment|composer|drop" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test`
  - Found the shared composer loader, existing chat attachment store, task create/message attachment encoding, Mission wake route, and Session wake callers.
- `rg -n "MissionWakeInput|wakeMission\(|mission\.launcher\.attachments_unsupported|attachments_unsupported|SessionWake\.wake\(" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test packages/web/src/content/docs packages/sdk/openapi.json packages/sdk/js/src/gen`
  - Found the overlay Mission branch explicitly throws `mission.launcher.attachments_unsupported`; overlay `wakeMission` accepts no attachments; server `MissionWakeInput` accepts only `missionID`, `text`, `title`, `model`, and `promptProfile`; `SessionWake.wake` callers are Mission operator, Mission child task result, scheduler cron, scheduler event, and right-sidebar `panel.wake_mission`.
- `rg -n "SessionWake\.wake|interface .*Wake|createUserMessage|attachments|FilePart|parts:" packages/opencorvus/src packages/opencorvus/test --glob '*.ts'`
  - Found `SessionPrompt.prompt(... noReply)` as the existing message-materialization entry and `SessionPrompt.createUserMessage` as the existing data URL attachment to `AttachmentStore` path.

### Root Cause

The shared composer exposes file and folder controls in all modes, but the Mission creation branch in `packages/overlay/src/main.tsx` rejects any non-empty attachment array before calling `wakeMission`. The client `MissionWakeInput`, server `MissionWakeInput` Zod schema, and `SessionWake.WakeInput` also lack any attachment / file-part field. Finally, `SessionWake.wake` manually persists a single text part instead of using the existing `SessionPrompt.createUserMessage` path, so even adding route fields alone would not persist attachment bytes correctly.

### Implementation Plan

1. Extend overlay `MissionWakeInput` and `wakeMission` to accept attachments with the same `{ mime, data, filename }` contract used by task creation and task messages.
2. Remove the Mission submit attachment rejection in `main.tsx` and forward composer attachments into `wakeMission`.
3. Extend server `/mission/wake` input schema with attachment data and convert them to `SessionPrompt` file parts.
4. Refactor `SessionWake.wake` so it uses `SessionPrompt.prompt.force({ noReply: true, parts })` for the user message, then writes the existing `wake_reason` control and starts the session loop.
5. Add regression tests for Mission wake route forwarding, SessionWake attachment persistence, and overlay source contracts.
6. Run focused tests, typecheck where changed, docs link check for this record, and `git diff --check`.

### Validation Tooling Finding

Focused backend reruns exposed that `packages/opencorvus/test/mission/wake-route.test.ts` still uses Bun elapsed per-test timeouts (`15_000` / `30_000`). The linked worktree route case can legitimately take about 28 seconds on Windows after project open, gitignore setup, expert-squad release, and attachment sweep activity. Running the whole file can push this over the fixed elapsed threshold and leave dangling test processes. This is a test tooling defect, not a Mission attachment failure. The fix must use the repository's existing isolated Bun runner with process-output inactivity timeout instead of increasing the elapsed timeout number.
