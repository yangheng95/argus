# Mission Attachment And Composer Intent Preservation

Date: 2026-07-16
Status: Complete
Owner: Codex

## Recall

### User Request

The user reported two coupled composer failures: creating a Mission rejects an attached file, and changing the selected expert squad clears both the typed request and staged attachments. The user later asked to remove bold text across the UI, then explicitly narrowed that visual request to the shared message input only; every other UI weight must remain unchanged.

### Acceptance Criteria

- A new Mission forwards the shared composer attachment list to `POST /mission/wake` and no longer presents the obsolete unsupported-attachment error.
- The existing Mission wake route persists attachment file parts through the existing `SessionWake` / `SessionPrompt` / `AttachmentStore` path.
- Changing the new-request intent between Chat and an expert squad, or between expert squads, preserves the current text and staged attachments.
- A successful submission still clears the submitted text and attachments exactly once.
- Selecting a different existing task/session still clears stale staged attachments unless the caller is explicitly changing only the new-request intent.
- Typed Chat and Mission requests render with the canonical regular body weight; no other UI typography changes.
- Regression coverage includes source/service contracts, task-selection attachment ownership, and a real Node-launched browser interaction with a screenshot tied to the composer region.

### Hard Constraints

- Preserve unrelated dirty worktree changes; do not reset, restore, or commit them as part of this repair.
- Do not restart, close, refresh, or otherwise interfere with the user's running OpenCorvus/overlay process.
- Keep one attachment store (`messageStore.chatAttachments`) and one new-request draft key per project directory; do not add a compatibility or fallback path.
- Reuse the existing `/mission/wake` attachment schema and durable materialization path rather than adding a second upload endpoint or storage implementation.
- Browser validation must use the repository Node sidecar, never Bun, and must include an inspected screenshot.
- Scope the typography change to `.chat-textarea`; do not alter global form-control inheritance, design-language weight values, Markdown, or other UI surfaces.

### Sources Read

- `AGENTS.md`
- `specs/current/architecture/07-panel.md`
- `specs/records/2026-07/2026-07-09-mission-composer-attachments.md`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/services/composer-draft.ts`
- `packages/overlay/src/services/mission.ts`
- `packages/overlay/src/services/task.ts`
- `packages/overlay/src/store/messages.ts`
- `packages/opencorvus/src/server/routes/mission.ts`
- `packages/opencorvus/src/session/wake.ts`
- Mission, composer-draft, task-selection, and expert-squad browser tests under `packages/overlay/test` and `packages/opencorvus/test`.
- `packages/overlay/src/styles/surfaces/composer.css`
- `packages/overlay/src/styles/cascade/base.css`
- `packages/overlay/test/chat-textarea-single-source.test.ts`

### Whole-Repository Search Evidence

- `rg -n "Mission creation does not support attachments|attachments_unsupported|attachments" packages/overlay packages/opencorvus packages/transport-protocol packages/sdk` found the stale rejection only in Overlay `main.tsx` plus its two locale strings and source-contract tests. The client Mission service, server route, generated API contract, route test, and Session wake test already accept attachment data.
- `rg -n "panelComposerDraftKey|composerDraftKey|setActiveExpertSquad|composerMode" packages/overlay/src packages/overlay/test` found separate `assistant:new:<directory>` and `mission:new:<directory>` draft keys. The draft-loading effect correctly loads the new key, which means the split key itself causes text replacement when the intent changes.
- `rg -n "selectTask\\(|setChatAttachments\\(\\[\\]\\)" packages/overlay/src packages/overlay/test` found that `handleComposerModeChange` calls `selectTask("")`, while `selectTask` unconditionally clears staged attachments. Other deselection callers archive/delete/navigate existing records and should keep their existing cleanup behavior.
- `rg -n "mission/wake|MissionWakeInput|missionWakeAttachmentParts|SessionWake.wake" packages/overlay/src packages/opencorvus/src packages/overlay/test packages/opencorvus/test` confirmed one route and one persistence path; no new server route or attachment store is required.
- `rg -n -C 8 "\\.chat-textarea|chat-textarea-wrap|\\.composer-textarea" packages/overlay/src/styles packages/overlay/test` found one canonical `.chat-textarea` rule in `surfaces/composer.css`; both Chat and Mission use this shared `ChatComposer` field. The canonical rule declared a font size but no weight, while `cascade/base.css` makes textareas inherit their surrounding font shorthand.

### Call-Site Decisions

| Call site                                | Decision                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.tsx` new Mission submit            | Remove the obsolete rejection and pass `attachments` into `wakeMission`.                                                                                |
| `main.tsx` `handleComposerModeChange`    | Deselect the old source while explicitly preserving the active new-request attachment draft.                                                            |
| `main.tsx` `panelComposerDraftKey`       | Replace separate Chat/Mission new-request keys with one directory-scoped launcher key. Task/session keys remain unchanged.                              |
| `services/task.ts` `selectTask`          | Add a narrowly named attachment-preservation option; default cleanup remains authoritative for every existing caller.                                   |
| Mission service/server/Session wake      | Keep the already implemented attachment contract and durable materialization path unchanged; validate it with existing focused tests.                   |
| Locale catalogs                          | Delete the now-dead `mission.launcher.attachments_unsupported` copy from both locales.                                                                  |
| `surfaces/composer.css` `.chat-textarea` | Declare the existing regular body-weight token locally so the shared message input cannot inherit bold context; leave every other UI surface unchanged. |

### Independent Agent Feedback

No sub-agent was started because the user did not request delegated or parallel agent work and the active collaboration boundary prohibits inferred delegation. The primary agent owns the required second review.

## Root Cause

The backend capability and the visible composer diverged. Mission attachment support already exists from the overlay Mission service through `/mission/wake` to durable Session attachment materialization, but a later main-composer integration retained the old pre-capability rejection and did not pass attachments to `wakeMission`. Separately, selecting an expert-squad intent changes `composerMode`, which selects a different persisted draft key and calls the general task/session cleanup path. The key swap replaces the textarea with an empty draft, and the cleanup path empties `messageStore.chatAttachments`.

## Implementation Plan

1. Make the new-request composer draft key independent of Chat versus expert-squad intent while retaining task/session scoping.
2. Let the intent-change caller preserve staged attachments while deselecting an existing source; retain default attachment clearing for all other task/session navigation.
3. Forward staged attachments through the existing `wakeMission` contract and delete the obsolete rejection copy.
4. Update unit/source contracts and add an interactive browser regression that types text, stages a real `File`, changes expert-squad intent, proves both survive, and captures the composer region.
5. Pin the shared `.chat-textarea` to the canonical regular body-weight token and assert its real computed weight in the same browser flow.
6. Run focused overlay/backend tests, typechecks, docs health checks, browser validation, screenshot inspection, diff review, then commit and push to `myhexin`.

## Validation Record

- `bun test packages/overlay/test/chat-textarea-single-source.test.ts packages/overlay/test/mission-launcher-component.test.ts packages/overlay/test/mission-session-source.test.ts packages/overlay/test/mission-service-actions.test.ts packages/overlay/test/task-selection-dead-task.test.ts packages/overlay/test/composer-mention-ui.test.ts packages/opencorvus/test/session/wake.test.ts`: 80 passed, 0 failed.
- `bun test packages/opencorvus/test/mission/wake-route.test.ts`: 23 passed, 0 failed when run independently. A preceding combined run placed two Windows route cases over their five-second per-test bound; the independent rerun completed every route assertion, including attachment forwarding.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/expert-squad-selector-browser.test.ts`: 3 passed, 0 failed. The interaction types a request, asserts the real textarea computed weight is `400`, stages a real `File`, switches Chat -> `Builtin/General` -> Chat, and asserts that both text and attachment survive asynchronous source cleanup.
- `.scratch/composer-expert-squad-draft-preserved.png`: manually inspected at the composer region; the regular-weight request text, attachment chip, selected `Builtin/General` intent, model selector, and send control are visible and correctly aligned.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `bun test packages/opencorvus/test/script/routes-check-openapi.test.ts`: 8 passed, 0 failed after replacing invalid `timeout: 0` process ownership with a synchronous child and an explicit 30-second test bound.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`: passed.
- `bun test packages/opencorvus/test/script/document-health.test.ts`: 53 passed, 0 failed.
- Prettier check for this task record and focused `git diff --check`: passed. Existing whole-file formatting drift in the shared composer/browser sources was not mechanically rewritten because that would absorb unrelated history.
