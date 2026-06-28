# 2026-06-27 Bug Hunt Residual Convergence

## Objective

Run an unattended residual bug hunt with independent agents, repair confirmed defects, and repeat until an independent pass reports no new non-duplicate issues.

API means Application Programming Interface. SDK means Software Development Kit. UI means User Interface. VSIX means Visual Studio Code Extension package. CWD means Current Working Directory. SSE means Server-Sent Events. LSP means Language Server Protocol. MCP means Model Context Protocol. ACP means Agent Client Protocol. HTTP means Hypertext Transfer Protocol. URL means Uniform Resource Locator. JS means JavaScript.

Current continuation constraint: the VSCode / VSIX plugin surface is deprecated and excluded from further exploration, repair, or acceptance scope. Historical VSIX findings above remain archival context only and must not be used to expand new work.

## Independent Findings

Three read-only agents scanned disjoint areas:

- Backend/runtime: project update ownership, instruction loading, auth loading, task binding lookup, tool-result attachments.
- Tooling/docs: historical docs index, channel env examples, bundled env variable name, VSIX manifest, hook bypasses, SDK defaults guard, web README source wording, mission E2E timeout.
- Overlay/UI: worktree deletion errors, CWD switch failures, file explorer search failures.

Fourth convergence scan after the first repair batch:

- Overlay event/replay: live replay gap recovery success semantics, malformed SSE payload diagnostics, `message.part.updated` order key single source, conversation replay/history error visibility, completed-task elapsed time source.

Fifth convergence scan after the fourth repair batch:

- Overlay GUI/event residuals: persisted message ingestion under strict `orderKey`, recovery failure stream ownership, invalid terminal elapsed time, agent rail locate errors, browser fixture error observability.
- Backend/tooling residuals: provider discovery auth fail-fast propagation, mission E2E part-update activity, file route OpenAPI/SDK error contracts, SDK required-parameter signatures, VSIX package identity/lockfile drift, conversation history event order-key pagination.

Sixth convergence scan after the fifth repair batch:

- Overlay residuals: rewind-clear recovery failure visibility, worktree post-delete board reload failure visibility, agent rail locate service error propagation, browser test page/console/response error collector coverage.
- Backend/tooling residuals: SDK required-body snake_case and mapped-body drift, task SSE message watermark same-millisecond writes, file upload OpenAPI/SDK errors, OpenAPI JavaScript sample SDK method naming, provider discovery provider-config fail-fast propagation, VSIX package contents cache pollution.

Seventh convergence scan after the sixth repair batch:

- Overlay residuals: file explorer mutation/refresh success messages after failed `/file` reload, shared browser error collector request-failure blind spot.
- Backend/tooling residuals: OpenAPI JavaScript samples still drift from generated SDK when Hey API adds conflict-suffix getters such as `current2`, `runtime2`, `auth2`, and `conversation2`.

Eighth convergence scan after the seventh repair batch:

- Overlay residuals: required file explorer reloads can still be superseded by background refresh tokens, post-upload reload failures use misleading upload-failed copy, and browser collector allow rules are too broad when query strings are dropped.
- Backend/tooling residuals: no new issues.

Ninth convergence scan after the eighth repair batch:

- Overlay residuals: FileExplorer retry is blocked by cached children after a reload failure, FileEditor content load failures render as non-editable files, search-result mutations leave stale search rows, expired-worktree cleanup partial failure leaves successfully removed rows stale, and the broad FileExplorer accessibility browser test still bypasses the shared browser error collector.
- Backend/tooling residuals: `/find/symbol` returns a hard-coded empty result instead of the LSP workspace-symbol result, `/executor` hides executor bootstrap registration failures, and `/gateway/stats` silently omits channel runtime status on `ChannelSupervisor.status()` failure.

Tenth convergence scan after the ninth repair batch:

- Overlay residuals: browser tests still have fixture/error-collector double sources outside the FileExplorer coverage, TaskList delete/rename failures return false without a visible error boundary, Goal save/delete failures are caught internally, and ordinary selected-task board refresh failures only log/retry while stale board content stays visible.
- Backend/tooling residuals: `EngineGit.prepare()` failure is logged but the orchestrator still runs, `/coding/sessions` accepts half of a compound cursor, coding and experimental schedule routes omit documented 400/404 error responses, and attachment route `stat()` errors are all flattened into 404.

Eleventh convergence scan after the tenth repair batch:

- Overlay residuals: Task queue drag-reorder failures still only log to console and the Coding Assistant directory browser test still owns a local page/console/response collector instead of the shared browser collector.
- Backend/tooling residuals: `/file/content` converts missing and unreadable files into 200 empty content, `/session/global` timestamp-only pagination can skip same-timestamp sessions, MCP auth store read failures are converted into empty credentials, MCP connect/disconnect/auth routes report success or the wrong status for missing servers, and MCP prompt/resource list failures are flattened into empty maps.

Twelfth convergence scan after the eleventh repair batch:

- Overlay residuals: successful TaskList start-now/project delete/project rename mutations can be relabeled as failed when the required post-mutation task reload fails, TaskDirBar browser coverage still has local response-only collectors, and the queue reorder browser evidence covers backend failure but not successful reorder followed by reload failure.
- Backend/tooling residuals: configured MCP connect failures still return `200 true`, connected-client `MCP.tools()` failures are flattened into partial maps, selected MCP prompt/resource fetch failures return `undefined`, non-image binary file reads verify only `stat()` before returning empty content, `file.read` generated SDK errors omit runtime `FileNotFoundError`, and `/session/global` response cursor headers are not declared in OpenAPI.

Thirteenth convergence scan after the twelfth repair batch:

- Overlay residuals: TaskDirBar worktree delete and expired cleanup still wrap successful deletion, worktree sync, and required board reload in a single mutation-failed catch; TaskList reload-failure browser fixtures return HTTP 500 with success-shaped task bodies, producing unusable raw JSON visible copy; TaskList and several browser suites still own local page/console/response collectors outside the shared browser collector.
- Backend/tooling residuals: MCP resource file parts in `createUserMessage()` still convert `MCP.readResource()` failures into ordinary user text; startup `listTools()` failures still mark the configured server failed and allow later `MCP.tools()` calls to return `{}`; provider and ACP attachment conversion still preserve or skip unresolved attachment references after read failure; SDK contract tests still check route status/type presence without proving generated runtime error names for documented runtime failures.

Fourteenth convergence scan after the thirteenth repair batch:

- Overlay residuals: required TaskList post-mutation reloads can still reuse a stale in-flight `_tasksLoading` request started before the mutation; shared browser error collector ownership remains incomplete across browser suites outside the named thirteenth-file set; TaskDirBar browser fixtures still accept both `/tasks` and `/global/tasks`, masking regressions from the single real `global/tasks` task-list client route.
- Backend/tooling residuals: successful MCP blob resources are preserved as unresolved `mcp://` file parts instead of being materialized to stored attachments or rejected; ACP history replay skips persisted `/attachment/...` file parts through a second conversion path; MCP OAuth callback/authenticate routes return HTTP 200 with `{ status: "failed" }` on finish/reconnect failure; unsupported-OAuth 400 responses are plain `{ error }` bodies while SDK/OpenAPI documents named errors; MCP prompt/resource fail-fast now makes `/experimental/resource` and `/command` capable of throwing but their route contracts still declare only 200.
- Cross-cutting residuals: architect explicit goal count is enforced through both structured requirement decisions and regex parsing of raw task text; the browser collector source guard is a fixed-file allowlist rather than a repository-wide browser-test ownership contract; the generate workflow rebuilds SDK/OpenAPI but not the generated API docs that the docs now claim come from OpenAPI.

Fifteenth convergence scan after the fourteenth repair batch:

- Overlay residuals: required TaskDirBar board reloads can still reuse stale in-flight board requests; stale `loadMoreTasks()` pagination responses can append rows after a required fresh first-page task reload; non-TaskDirBar browser fixtures still accept both `/tasks` and `/global/tasks`; the screenshot browser evidence suite still owns a local request collector instead of the shared browser error collector.
- Backend/tooling residuals: text-only MCP resources still persist unresolved `mcp://` file parts; local text file read failures are converted into ordinary user text; ACP session load/fork history fetch failures are swallowed; persisted HTTP(S) file parts are skipped during ACP replay; proxied MCP tool/prompt/resource prewarm failures are swallowed; MCP OAuth start failures can throw 500 without a route/SDK contract.
- Cross-cutting residuals: `script/beta.ts` still contains destructive broad git cleanup commands; generated API docs group unknown first path segments under an implicit fallback instead of failing; architecture docs still mention stale gateway kind/path concepts; an older session-config test still expects the retired root `generate-openapi.ts` path.

Fifteenth visual verification residual:

- Overlay browser fixture residual: `task-list-tree-click.test.ts` now uses the shared browser error collector, which exposed that its fixture did not implement the real initialization request `GET /skill/mounts?directory=...`; the fixture must model that production route instead of relying on a hidden 404.
- Screenshot browser fixture residual: `screenshot-browser-panel-browser.test.ts` still fed screenshot evidence through transcript-only payloads. The current screenshot browser reads `cardTreeStore.screenshotItems`, which is populated from `view.messages`/card-tree metadata and part order keys; the fixture must provide those authoritative hydrate fields instead of relying on a retired transcript-derived path.

## Call Point Inventory

| Surface                                         | Owner                                                                                                                                                                                                                                                                | Call points                                                                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project update route                            | `packages/opencorvus/src/server/routes/project.ts`                                                                                                                                                                                                                   | `PATCH /project/current`, `PATCH /project/:projectID`, `Project.update()`                                                                                   |
| Instruction loading                             | `packages/opencorvus/src/session/instruction.ts`                                                                                                                                                                                                                     | `systemPaths()`, `renderInstructionFile()`, config `instructions`, URL instructions, `resolve()`                                                            |
| Auth loading                                    | `packages/opencorvus/src/auth/index.ts`                                                                                                                                                                                                                              | `Auth.all()`, `Auth.get()`, `Auth.set()`, `Auth.remove()`, provider init auth reads                                                                         |
| Task bindings                                   | `packages/opencorvus/src/server/routes/orchestrator.ts`, `packages/opencorvus/src/channel/ingress.ts`                                                                                                                                                                | `GET /task/:taskID/bindings`, `ChannelIngress.bindingsByTaskID()`                                                                                           |
| Tool-result attachments                         | `packages/opencorvus/src/session/message.ts`                                                                                                                                                                                                                         | `attachmentToBase64()`, `toModelOutput()`                                                                                                                   |
| Channel env examples                            | `packages/channel-config/src/index.ts`, `packages/channel-runtime/.env.example`, `packages/channel-runtime/.env.bundle.example`                                                                                                                                      | `ChannelCatalog`, `registerAdapters()`, `applyBundledEnv()`                                                                                                 |
| SDK generated guard                             | `.github/workflows/typecheck.yml`, `packages/sdk/js/script/build.ts`                                                                                                                                                                                                 | `src/gen`, `src/defaults.ts`, `packages/sdk/openapi.json`                                                                                                   |
| VSIX package                                    | `packages/vscode-extension/package.json`, `packages/vscode-extension/script/package-vsix.ts`                                                                                                                                                                         | `vsce package`, output filename generation                                                                                                                  |
| Push hooks                                      | `.github/workflows/generate.yml`, `script/publish.ts`, `script/beta.ts`, `.husky/pre-push`                                                                                                                                                                           | `git push --no-verify` paths                                                                                                                                |
| Web docs wording                                | `packages/web/README.md`, `packages/opencorvus/script/docs/render-api-md.ts`                                                                                                                                                                                         | live `generateOpenApiSpec()` API docs source                                                                                                                |
| Mission E2E timeout                             | `packages/opencorvus/script/mission-e2e.ts`                                                                                                                                                                                                                          | activity polling loop, `SessionPrompt.cancel()`                                                                                                             |
| Overlay worktree errors                         | `packages/overlay/src/components/TaskDirBar.tsx`, `packages/overlay/src/services/worktree.ts`                                                                                                                                                                        | single worktree delete, expired worktree cleanup                                                                                                            |
| Overlay CWD switch                              | `packages/overlay/src/components/TaskDirBar.tsx`, `packages/overlay/src/services/workspace.ts`                                                                                                                                                                       | manual path, recent path, discovered project path                                                                                                           |
| File explorer search                            | `packages/overlay/src/components/FileExplorerPanel.tsx`                                                                                                                                                                                                              | search resource, result list empty/error states                                                                                                             |
| Event display time                              | `packages/overlay/src/services/tree-writer.ts`                                                                                                                                                                                                                       | `eventEmittedAt()`, `session.status`, `session.error`, `review.stream.*`                                                                                    |
| Selected task live replay recovery              | `packages/overlay/src/services/selected-task-recovery.ts`, `packages/overlay/src/services/sse.ts`, `packages/overlay/src/services/conversation.ts`                                                                                                                   | `recoverSelectedTaskConversation()`, `performSseReconnect()`, `mergeLatestConversationTail()`                                                               |
| SSE payload parsing                             | `packages/overlay/src/services/sse.ts`, `packages/overlay/src/services/task.ts`                                                                                                                                                                                      | selected-task stream `onEvent`, task-list stream `onEvent`, task SSE event parsing                                                                          |
| Conversation replay/history errors              | `packages/overlay/src/services/conversation.ts`, `packages/overlay/src/components/Conversation.tsx`                                                                                                                                                                  | background `continueConversationReplay()`, scheduled `mergeLatestConversationTail()`, `loadOlderConversationHistory()`                                      |
| Part event order key                            | `packages/overlay/src/services/tree-writer.ts`                                                                                                                                                                                                                       | `requirePartEventRouteMeta()`, `ensurePartProjection()`, `message.part.updated`                                                                             |
| Task elapsed display time                       | `packages/overlay/src/components/TaskStatusHeader.tsx`                                                                                                                                                                                                               | completed task elapsed label, `useNowTick()` live label                                                                                                     |
| Persisted message ingestion                     | `packages/overlay/src/services/tree-writer.ts`, `packages/overlay/src/services/chat.ts`, `packages/overlay/src/services/task.ts`                                                                                                                                     | `ingestPersistedConversationMessage()`, user-message echoes from chat/task POST responses                                                                   |
| Recovery stream ownership                       | `packages/overlay/src/services/selected-task-recovery.ts`, `packages/overlay/src/services/sse.ts`                                                                                                                                                                    | live replay expired recovery, `performSseReconnect()`, `startSSE()` close handling                                                                          |
| Agent rail locate errors                        | `packages/overlay/src/components/ConversationAgentRail.tsx`, `packages/overlay/src/services/conversation.ts`                                                                                                                                                         | click locate, history hydrate, scroll-to-card request                                                                                                       |
| Provider discovery auth                         | `packages/opencorvus/src/server/routes/provider.ts`, `packages/opencorvus/src/auth/index.ts`                                                                                                                                                                         | `POST /provider/discover-models`, saved auth lookup, upstream `/models` call                                                                                |
| Mission E2E inactivity                          | `packages/opencorvus/script/mission-e2e-inactivity.ts`, `packages/opencorvus/script/mission-e2e.ts`                                                                                                                                                                  | part observation signature, inactivity deadline reset                                                                                                       |
| File item OpenAPI errors                        | `packages/opencorvus/src/server/routes/file.ts`, `packages/opencorvus/test/server/file-routes.test.ts`, `packages/sdk/js/src/gen`                                                                                                                                    | create/move/delete item response contracts                                                                                                                  |
| SDK required parameters                         | `packages/sdk/js/script/build.ts`, `packages/sdk/js/src/gen/sdk.gen.ts`, `packages/sdk/js/src/gen/types.gen.ts`                                                                                                                                                      | OpenAPI requestBody.required, generated method signatures                                                                                                   |
| VSIX package identity                           | `packages/vscode-extension/package.json`, `packages/opencorvus/package.json`, `bun.lock`                                                                                                                                                                             | workspace package names, VSIX packaging manifest name                                                                                                       |
| Conversation history event window               | `packages/opencorvus/src/server/routes/orchestrator.ts`, overlay conversation history requests                                                                                                                                                                       | `before_order_key`, event replay/history filtering                                                                                                          |
| Rewind-clear recovery failure visibility        | `packages/overlay/src/services/events.ts`, `packages/overlay/src/services/selected-task-recovery.ts`                                                                                                                                                                 | `scheduleRewindClearRecovery()`, `recoverSelectedTaskAfterRewindClear()`                                                                                    |
| Worktree post-delete board reload               | `packages/overlay/src/components/TaskDirBar.tsx`, `packages/overlay/src/services/task.ts`                                                                                                                                                                            | `removeWorktree()`, `cleanupExpiredWorktrees()`, `loadBoard({ sync: true })`                                                                                |
| Agent rail locate history propagation           | `packages/overlay/src/services/conversation.ts`, `packages/overlay/src/components/ConversationAgentRail.tsx`                                                                                                                                                         | `loadConversationHistoryUntilCard()`, rail locate click                                                                                                     |
| Browser fixture error collector                 | `packages/overlay/test/browser-runner.mjs`, `packages/overlay/test/browser/*`                                                                                                                                                                                        | page errors, console errors, HTTP 4xx/5xx fixture responses                                                                                                 |
| SDK required body residuals                     | `packages/sdk/js/script/build.ts`, `packages/sdk/js/src/gen/sdk.gen.ts`, `packages/sdk/openapi.json`                                                                                                                                                                 | snake_case operation IDs, `map`-renamed body fields, top-level parameter optionality                                                                        |
| Task SSE message watermark                      | `packages/opencorvus/src/orchestrator/task-event.ts`, `packages/opencorvus/src/server/routes/orchestrator.ts`, `packages/overlay/src/services/selected-stream-cursor.ts`                                                                                             | `after_message_watermark`, `task.messages.changed`, DB-backed same-millisecond message/part writes                                                          |
| File upload OpenAPI errors                      | `packages/opencorvus/src/server/routes/file.ts`, `packages/opencorvus/test/server/file-routes.test.ts`, `packages/sdk/js/src/gen`                                                                                                                                    | `POST /file/upload`, `FileUploadInvalidNameError`, `FileUploadConflictError`                                                                                |
| OpenAPI JavaScript samples                      | `packages/opencorvus/src/cli/cmd/generate.ts`, `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/sdk.gen.ts`                                                                                                                                                     | `x-codeSamples`, operationId to SDK method naming                                                                                                           |
| Provider discovery provider config              | `packages/opencorvus/src/server/routes/provider.ts`, `packages/opencorvus/src/provider/provider.ts`                                                                                                                                                                  | `POST /provider/discover-models`, `Provider.getProvider()`                                                                                                  |
| VSIX package contents                           | `packages/vscode-extension/.vscodeignore`, `packages/vscode-extension/test/package-vsix.test.ts`                                                                                                                                                                     | `vsce ls --no-dependencies`, `.turbo`, `.vscode-test`, e2e/cache files                                                                                      |
| File explorer post-mutation refresh             | `packages/overlay/src/components/FileExplorerPanel.tsx`, `packages/overlay/test/browser/file-explorer-search-error.test.ts`                                                                                                                                          | refresh, create, delete, move, upload, `refreshDirectories()`, `/file` reload errors                                                                        |
| Browser request failure collector               | `packages/overlay/test/browser/error-collector.ts`, browser tests using `installBrowserErrorCollector()`                                                                                                                                                             | page errors, console errors, HTTP 4xx/5xx, network/request failures without responses                                                                       |
| SDK sample accessor parity                      | `packages/opencorvus/src/cli/cmd/generate.ts`, `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/sdk.gen.ts`, `packages/opencorvus/test/script/sdk-build-format-contract.test.ts`                                                                                | `x-codeSamples`, generated `export class` / `get` / `public` SDK surface, conflict suffix getters                                                           |
| Required file explorer reload ownership         | `packages/overlay/src/components/FileExplorerPanel.tsx`, `packages/overlay/test/browser/file-explorer-search-error.test.ts`                                                                                                                                          | user-command reloads, background refresh interval, stale load tokens, upload post-refresh                                                                   |
| Browser collector query precision               | `packages/overlay/test/browser/error-collector.ts`, `packages/overlay/test/browser-error-collector.test.ts`, FileExplorer browser tests                                                                                                                              | URL pathname + query in expected response/request failure allow rules                                                                                       |
| File explorer retry and search mutation refresh | `packages/overlay/src/components/FileExplorerPanel.tsx`, `packages/overlay/test/browser/file-explorer-search-error.test.ts`                                                                                                                                          | root/directory retry buttons, cached directory entries, `refetchSearch()`, rename/move/delete post-mutation search state                                    |
| File editor content load errors                 | `packages/overlay/src/components/FileEditorPane.tsx`, `packages/overlay/src/i18n/en-US.json`, `packages/overlay/src/i18n/zh-CN.json`, browser FileExplorer/FileEditor tests                                                                                          | `readFileContent()`, `content.error`, non-editable/binary fallback                                                                                          |
| Expired worktree cleanup partial failure        | `packages/overlay/src/components/TaskDirBar.tsx`, `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`                                                                                                                                                       | `cleanupExpiredWorktrees()`, `deleteProjectWorktrees()`, `syncWorktrees()`, `loadBoard({ requireFresh: true })`                                             |
| FileExplorer accessibility browser coverage     | `packages/overlay/test/browser/file-explorer-accessibility.test.ts`, `packages/overlay/test/browser/error-collector.ts`                                                                                                                                              | shared page/console/response/request-failed collector, fixture unmatched routes                                                                             |
| Symbol search route                             | `packages/opencorvus/src/server/routes/file.ts`, `packages/opencorvus/src/lsp/index.ts`, `packages/opencorvus/test/server/file-routes.test.ts`                                                                                                                       | `GET /find/symbol`, `LSP.workspaceSymbol()`                                                                                                                 |
| Executor list bootstrap                         | `packages/opencorvus/src/server/routes/executor.ts`, `packages/opencorvus/src/executor/bootstrap.ts`, `packages/opencorvus/test/server/executor-routes.test.ts`                                                                                                      | `GET /executor`, `ExecutorBootstrap.autoRegister(true)`, `ExecutorDiscovery.scan()`                                                                         |
| Gateway stats channel runtime                   | `packages/opencorvus/src/server/routes/gateway.ts`, `packages/opencorvus/src/server/routes/channel.ts`, `packages/opencorvus/test/gateway/e2e.test.ts`                                                                                                               | `GET /gateway/stats`, `GET /channel/runtime`, `ChannelSupervisor.status()`                                                                                  |
| Browser fixture error collector residual        | `packages/overlay/test/browser/error-collector.ts`, `packages/overlay/test/browser/app-dialog-segmented-control.test.ts`, `packages/overlay/test/browser/browser-preview-evidence.test.ts`, `packages/overlay/test/browser/browser-preview-live-input-batch.test.ts` | shared page/console/response/request-failed collector, explicit fixture route misses, test-local collectors                                                 |
| TaskList action failure visibility              | `packages/overlay/src/services/task.ts`, `packages/overlay/src/main.tsx`, `packages/overlay/src/components/TaskList.tsx`, `packages/overlay/test/task-rename-service.test.ts`                                                                                        | `deleteTask()`, `renameTask()`, `onDeleteTask`, `onRenameTask`, `TaskRow.commitRename()`                                                                    |
| Goal operation failure visibility               | `packages/overlay/src/services/dialog.ts`, `packages/overlay/src/main.tsx`, `packages/overlay/src/components/GoalDialogHost.tsx`, `packages/overlay/src/components/GoalWorkflowGroup.tsx`                                                                            | `saveGoalDialog()`, `deleteGoal()`, `panelMessage()`, `loadBoard({ sync: true })`, removed manual goal buttons                                              |
| Selected-task board refresh visibility          | `packages/overlay/src/store/board.ts`, `packages/overlay/src/services/events.ts`, `packages/overlay/src/services/sync.ts`                                                                                                                                            | `loadBoard()`, `retryBoard()`, `scheduleBoard()`, `observeScheduledBoardLoad()`                                                                             |
| Orchestrator git prepare fail-fast              | `packages/opencorvus/src/orchestrator/loop.ts`, `packages/opencorvus/src/engine/git.ts`, `packages/opencorvus/test/orchestrator/loop-prepare-baseline.test.ts`                                                                                                       | `EngineGit.prepare(task)`, `runTaskLoopInner()`, `Orchestrator.processTask()`                                                                               |
| Coding assistant session cursor and errors      | `packages/opencorvus/src/server/routes/coding.ts`, `packages/opencorvus/src/coding-assistant/session.ts`, `packages/opencorvus/test/server/coding-routes.test.ts`                                                                                                    | `GET /coding/sessions`, `cursorUpdated`, `cursorSessionID`, `assertRightSidebarCodingSession()`                                                             |
| Experimental schedule error contracts           | `packages/opencorvus/src/server/routes/experimental.ts`, `packages/opencorvus/test/server/experimental-schedule-routes.test.ts`, `packages/opencorvus/test/server/experimental-schedule-contract.test.ts`, `packages/sdk/openapi.json`, `packages/sdk/js/src/gen`    | schedule/event-schedule create/delete routes, project-scoped query validation, generated SDK error types                                                    |
| Attachment route stat errors                    | `packages/opencorvus/src/server/routes/attachment.ts`, `packages/opencorvus/test/server/attachment-routes.test.ts`, `packages/opencorvus/src/storage/attachment-store.ts`                                                                                            | `GET /attachment/:projectID/:name`, thumbnail variant source stat, normal attachment stat, ENOENT vs EACCES/EPERM                                           |
| Task queue reorder failure visibility           | `packages/overlay/src/components/TaskList.tsx`, `packages/overlay/src/services/task.ts`, `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`                                                                                                                | queued task drag/drop, `reorderTaskQueue()`, required post-reorder `loadTasks()`                                                                            |
| Coding Assistant browser collector ownership    | `packages/overlay/test/browser/coding-assistant-directory-browser.test.ts`, `packages/overlay/test/browser/error-collector.ts`, `packages/overlay/test/browser-error-collector.test.ts`                                                                              | shared page/console/response/request-failed collector, test-local collector removal                                                                         |
| File content fail-fast reads                    | `packages/opencorvus/src/file/index.ts`, `packages/opencorvus/src/server/routes/file.ts`, `packages/opencorvus/test/file/index.test.ts`, `packages/opencorvus/test/server/file-routes.test.ts`                                                                       | `GET /file/content`, image/text/binary reads, ENOENT vs read/access errors                                                                                  |
| Global session compound pagination              | `packages/opencorvus/src/session/index.ts`, `packages/opencorvus/src/server/routes/session.ts`, `packages/opencorvus/test/server/global-session-list.test.ts`, `packages/sdk/openapi.json`                                                                           | `GET /session/global`, `time_updated desc, id desc`, next cursor headers/query                                                                              |
| MCP auth store fail-fast                        | `packages/opencorvus/src/mcp/auth.ts`, `packages/opencorvus/src/mcp/oauth-provider.ts`, `packages/opencorvus/src/mcp/index.ts`, `packages/opencorvus/src/cli/cmd/mcp.ts`                                                                                             | auth file read/parse, `all()`, `set()`, `remove()`, credential preservation                                                                                 |
| MCP missing server route errors                 | `packages/opencorvus/src/mcp/index.ts`, `packages/opencorvus/src/server/routes/mcp.ts`, MCP route tests                                                                                                                                                              | connect, disconnect, OAuth support/auth routes, missing configured server                                                                                   |
| MCP prompt/resource fail-fast lists             | `packages/opencorvus/src/mcp/index.ts`, `packages/opencorvus/src/command/index.ts`, `packages/opencorvus/src/mcp/serve.ts`, `packages/opencorvus/src/server/routes/experimental.ts`                                                                                  | `listPrompts()`, `listResources()`, flattened prompt/resource maps, failed server close path                                                                |
| TaskList post-mutation reload failures          | `packages/overlay/src/components/TaskList.tsx`, `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`, i18n files                                                                                                                                             | `handleStartNow()`, `handleDeleteProject()`, `handleRenameProject()`, required `loadTasks()` after durable mutations                                        |
| TaskDirBar browser collector ownership          | `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`, `packages/overlay/test/browser/error-collector.ts`, `packages/overlay/test/browser-error-collector.test.ts`                                                                                            | local `badResponses`, response-only collectors, shared collector source contract                                                                            |
| MCP connect and tool fetch fail-fast            | `packages/opencorvus/src/mcp/index.ts`, `packages/opencorvus/src/server/routes/mcp.ts`, MCP tests                                                                                                                                                                    | `connect()`, `startConnection()`, `MCP.tools()`, `client.listTools()` after connection                                                                      |
| MCP selected prompt/resource fetch fail-fast    | `packages/opencorvus/src/mcp/index.ts`, `packages/opencorvus/src/command/index.ts`, `packages/opencorvus/src/mcp/serve.ts`, MCP tests                                                                                                                                | `getPrompt()`, `readResource()`, command template rendering, MCP server adapter responses                                                                   |
| File content binary read access                 | `packages/opencorvus/src/file/index.ts`, `packages/opencorvus/test/file/index.test.ts`, `packages/opencorvus/test/server/file-routes.test.ts`                                                                                                                        | non-image binary extension branch, read permission/access failure, binary-empty response                                                                    |
| Route-specific OpenAPI error/header contracts   | `packages/opencorvus/src/server/error.ts`, `packages/opencorvus/src/server/routes/file.ts`, `packages/opencorvus/src/server/routes/session.ts`, `packages/opencorvus/test/script/sdk-build-format-contract.test.ts`, generated SDK/OpenAPI                           | `FileNotFoundError` for `file.read`, `/session/global` next cursor response headers                                                                         |
| TaskDirBar post-delete board reload             | `packages/overlay/src/components/TaskDirBar.tsx`, `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`                                                                                                                                                       | single worktree delete, expired worktree cleanup, `syncWorktrees()`, required `loadBoard({ sync: true, requireFresh: true })`, visible operation error copy |
| TaskList reload browser fixture evidence        | `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`, `packages/overlay/src/services/api.ts`, `packages/overlay/src/components/TaskList.tsx`                                                                                                                 | `/global/tasks` and `/tasks` fixture bodies for non-2xx statuses, visible reload-failed notifications, screenshot evidence readability                      |
| Browser collector remaining double sources      | `packages/overlay/test/browser/error-collector.ts`, `packages/overlay/test/browser-error-collector.test.ts`, `packages/overlay/test/browser/*`                                                                                                                       | TaskList tree/reduced-motion/perf tests and current page/console/response local collectors that omit request failures or fail to assert collected errors    |
| MCP resource prompt parts                       | `packages/opencorvus/src/session/prompt/parts.ts`, session prompt tests                                                                                                                                                                                              | `part.source.type === "resource"`, `MCP.readResource()`, persisted user message parts, command/session prompt creation                                      |
| Model attachment conversion                     | `packages/opencorvus/src/provider/transform.ts`, `packages/opencorvus/src/acp/agent.ts`, provider/ACP tests                                                                                                                                                          | `AttachmentStore.read()`, `AttachmentStore.dataUrlFromReference()`, provider file parts, ACP tool image attachment content                                  |
| Runtime error-name SDK contracts                | `packages/opencorvus/src/server/routes/file.ts`, `packages/opencorvus/src/server/routes/mcp.ts`, `packages/opencorvus/test/script/sdk-build-format-contract.test.ts`, generated SDK types                                                                            | `/file/content` runtime 404/500 names, `/mcp/:name/connect` runtime 404/500 names, generated `FileReadErrors` / `McpConnectErrors` blocks                   |
| TaskList required fresh reload                  | `packages/overlay/src/store/board.ts`, `packages/overlay/src/components/TaskList.tsx`, `packages/overlay/test/runtime-directory-actions.test.ts`, `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`                                                       | `_tasksLoading`, `loadTasks()`, start-now/delete-project/rename-project/reorder post-mutation reloads, stale in-flight list requests                        |
| Browser collector repository ownership          | `packages/overlay/test/browser-error-collector.test.ts`, `packages/overlay/test/browser/*.test.ts`, `packages/overlay/test/browser/error-collector.ts`                                                                                                               | `installBrowserErrorCollector()`, `errors.assertNoUnexpectedErrors()`, explicit documented opt-outs for browser suites that do not use the shared collector |
| TaskList fixture route source                   | `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`, `packages/overlay/src/store/board.ts`, `packages/opencorvus/src/server/routes/orchestrator.ts`                                                                                                         | real `global/tasks` task-list client route, project `tasks` route, fixture and allow-rule route matching                                                    |
| MCP resource blob materialization               | `packages/opencorvus/src/session/prompt/parts.ts`, `packages/opencorvus/src/storage/attachment-store.ts`, `packages/opencorvus/src/session/message.ts`, prompt/session tests                                                                                         | `MCP.readResource()`, blob resource contents, stored attachment references, provider model file parts                                                       |
| ACP persisted attachment replay                 | `packages/opencorvus/src/acp/agent.ts`, `packages/opencorvus/src/storage/attachment-store.ts`, ACP event/replay tests                                                                                                                                                | `loadSession()`, `processMessage()`, `/attachment/<project>/<name>` file parts, replayed ACP content                                                        |
| MCP OAuth route fail-fast contracts             | `packages/opencorvus/src/mcp/index.ts`, `packages/opencorvus/src/server/routes/mcp.ts`, MCP route/auth tests, generated SDK/OpenAPI                                                                                                                                  | `finishAuth()`, `authenticate()`, OAuth callback routes, unsupported OAuth 400s, failed reconnect status                                                    |
| MCP prompt/resource route contracts             | `packages/opencorvus/src/server/routes/experimental.ts`, `packages/opencorvus/src/server/routes/app.ts`, `packages/opencorvus/src/command/index.ts`, generated SDK/OpenAPI                                                                                           | `/experimental/resource`, `/command`, `MCP.resources()`, `MCP.prompts()`, generated route error types                                                       |
| Architect goal-count contract                   | `packages/opencorvus/src/architect/agent.ts`, architect tests, requirements decision payloads                                                                                                                                                                        | explicit structured goal-count requirement, raw task request parsing, prompt contract construction                                                          |
| Generated API docs workflow                     | `script/generate.ts`, `.github/workflows/generate.yml`, `packages/opencorvus/script/docs/render-api-md.ts`, `packages/web/README.md`, docs tests                                                                                                                     | SDK/OpenAPI generation, generated API markdown, docs check in main generation path                                                                          |
| TaskDirBar required board reload freshness      | `packages/overlay/src/store/board.ts`, `packages/overlay/src/components/TaskDirBar.tsx`, `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`, `packages/overlay/test/runtime-directory-actions.test.ts`                                                     | `_boardLoading`, `loadBoard({ requireFresh: true })`, worktree delete, expired worktree cleanup, selected task board reload                                 |
| Task pagination stale response isolation        | `packages/overlay/src/store/board.ts`, `packages/overlay/test/events-refresh.test.ts`                                                                                                                                                                                | `loadTasks({ requireFresh: true })`, `loadMoreTasks()`, task-list cursor, held pagination responses                                                         |
| Browser task-list fixture route contract        | `packages/overlay/test/browser-error-collector.test.ts`, `packages/overlay/test/browser/*.test.ts`, `packages/overlay/src/services/task.ts`                                                                                                                          | `/global/tasks`, rejected `/tasks` task-list fixtures, browser route handlers and allow rules                                                               |
| Browser skill mount fixture route contract      | `packages/overlay/test/browser/task-list-tree-click.test.ts`, `packages/overlay/src/services/extensions.ts`, `packages/opencorvus/src/server/routes/skill.ts`                                                                                                         | `GET /skill/mounts?directory=...`, task-list page initialization, shared browser 4xx collector                                                              |
| Screenshot browser collector ownership          | `packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`, `packages/overlay/test/browser-error-collector.test.ts`, `packages/overlay/test/browser/error-collector.ts`                                                                                 | page errors, console errors, HTTP responses, request failures, `assertNoUnexpectedErrors()`                                                                 |
| Screenshot browser hydrate fixture contract     | `packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`, `packages/overlay/src/services/tree-writer.ts`, `packages/overlay/src/components/ScreenshotBrowserPanel.tsx`, `packages/overlay/src/utils/screenshot-browser.ts`                            | transcript `info.orderKey`, `view.messages`, `agentView.messages`, tool part `orderKey`, `cardTreeStore.screenshotItems`                                    |
| MCP text resource materialization               | `packages/opencorvus/src/session/prompt/parts.ts`, `packages/opencorvus/test/session/prompt-parts-model-resolution.test.ts`                                                                                                                                          | text-only resource contents, unresolved `mcp://` file parts, persisted user message parts                                                                   |
| Prompt local file read fail-fast                | `packages/opencorvus/src/session/prompt/parts.ts`, `packages/opencorvus/test/session/prompt.test.ts`                                                                                                                                                                 | `ReadTool.init()`, local text file parts, user message persistence                                                                                          |
| ACP history and remote file replay              | `packages/opencorvus/src/acp/agent.ts`, `packages/opencorvus/test/acp/event-subscription.test.ts`                                                                                                                                                                    | `loadSession()`, `unstable_forkSession()`, `sdk.session.messages()`, persisted HTTP(S) file parts, `resource_link` replay                                  |
| MCP serve proxied prewarm fail-fast             | `packages/opencorvus/src/mcp/serve.ts`, MCP serve tests                                                                                                                                                                                                              | proxied server tools, prompts, resources, startup prewarm failure propagation                                                                               |
| MCP OAuth start error contract                  | `packages/opencorvus/src/server/routes/mcp.ts`, `packages/opencorvus/test/server/mcp-routes.test.ts`, `packages/opencorvus/test/script/sdk-build-format-contract.test.ts`, generated SDK/OpenAPI                                                                     | `GET /mcp/:name/auth`, OAuth start failures, `UnknownError`, generated `McpAuthStartErrors`                                                                |
| Beta release git safety                         | `script/beta.ts`, script/document-health tests                                                                                                                                                                                                                       | release merge failure cleanup, dirty worktree protection, banned broad `git checkout -- .` and `git clean -fd` commands                                     |
| API docs group strictness                       | `packages/opencorvus/script/docs/render-api-md.ts`, `packages/opencorvus/test/script/routes-check-openapi.test.ts`                                                                                                                                                   | route first-segment grouping, `merge_into` targets, generated API markdown render/check                                                                     |
| Architecture gateway doc drift                  | `specs/new-arch/README.md`, `specs/new-arch/02-data.md`, `specs/new-arch/03-control.md`, `packages/opencorvus/test/script/document-health.test.ts`                                                                                                                   | retired gateway session kind/path references, `SESSION_KINDS`, `src/gateway`                                                                               |
| Root generate test drift                        | `packages/opencorvus/test/server/session-config-routes.test.ts`, `script/generate.ts`, `packages/sdk/js/script/build.ts`, `packages/opencorvus/script/docs/render-api-md.ts`                                                                                         | retired direct `generate-openapi.ts` expectation, SDK build ownership, docs renderer order                                                                  |

## Fix Shape

- Keep `PATCH /project/:projectID` but make it a current-project ownership boundary: mismatch throws `NotFoundError`, match delegates to `Project.update()` and refreshes `Instance`.
- Replace discovered instruction-file read swallowing with fail-fast errors. Missing optional glob matches may remain empty; a discovered path or fetched instruction URL must not be silently converted to no instructions.
- Make corrupt or unreadable existing `auth.json` fail fast. Only a genuinely missing file may mean "no saved auth". Invalid auth entries should fail with the provider key in the error.
- Make `GET /task/:taskID/bindings` prove the task exists before returning an empty binding list.
- Make stored tool-result attachment read failures reject instead of filtering the attachment from model context.
- Update channel runtime examples from `ChannelCatalog` required env keys, and fix the bundled env variable name.
- Remove push `--no-verify` from owned push paths instead of duplicating hook logic.
- Include `packages/sdk/js/src/defaults.ts` in the generated SDK diff guard.
- Change web README wording to the live OpenAPI source used by `render-api-md.ts`.
- Fix VSIX manifest naming at the manifest source, keeping output naming simple.
- Change Mission E2E timeout to an inactivity timeout that resets on observed message/tool activity.
- Add visible overlay errors for worktree deletion, CWD switch failure, and file search failure; verify with browser screenshots.
- Make display-time projections require emitted event timestamps rather than using `Date.now()` as a hidden source.
- Make live replay gap recovery await `mergeLatestConversationTail()` before recording success. Tail merge failure is a recovery failure with a visible notification; reconnect restart uses the same owner promise rather than fire-and-forget.
- Surface malformed SSE JSON payloads through `AppLog.error()` with stream kind and a short raw payload sample.
- Superseded by `2026-06-27-message-card-orderkey-convergence.md`: each `message.part.updated` display event now carries the owning message timeline key at the top level / `payload.orderKey`, while `payload.part.orderKey` carries the part-domain key. Do not revive the old "top-level part event key" contract.
- Surface background conversation replay, scheduled tail merge, and older-history failures through `AppLog.error()` with notification details instead of console-only diagnostics.
- For completed/cancelled/failed task status header elapsed time, require `task.time.completed`. Missing completion time is rendered as a visible error marker and logged once; live tasks still use the shared clock tick.
- Project persisted message ingestion through the same durable message projection as hydrate/replay. Persisted user-message echoes must validate `message.info.orderKey` and must not synthesize live `message.part.updated` events; if part updates are replayed, the top-level order key is the owning message key and `part.orderKey` is the part-domain key.
- In live replay expired recovery, perform the tail merge before opening the non-live replay SSE stream. Failure must leave the stream disconnected and visible as a recovery error; success may open the stream from the persisted sequence.
- For terminal task elapsed time, reject both missing and non-monotonic `time.completed`. Non-monotonic timestamps render a visible "invalid completion time" marker and log once; no negative duration display is allowed.
- Agent rail locate clicks own their async failure boundary: history hydrate and scroll failures surface through `AppLog`/notification rather than console-only or unhandled promise paths.
- Browser visual tests that assert GUI failure states must collect page errors, console errors, and 4xx/5xx fixture responses so missing fixture routes fail loudly.
- Provider model discovery must propagate saved-auth read failures. It may omit saved auth only when there is genuinely no providerID or no stored auth value; corrupt/unreadable auth must abort before upstream calls.
- Mission E2E inactivity tracking must treat meaningful updates to an existing part as activity, not only first-seen part IDs.
- File item create/move/delete route OpenAPI responses must declare the same 400/404/409 errors already exercised by server tests, and generated SDK error types must reflect them.
- SDK generated method signatures must require the top-level `parameters` object when OpenAPI marks a request body required and the generated body type has required fields.
- VSIX workspace package identity must not collide with the CLI package. The package-manager identity and lockfile must stay single-source while the VSIX output filename remains deterministic.
- Conversation history event windows must use the same order-key boundary as transcript/timeline pagination, so same-millisecond status/error events are neither dropped nor over-included.
- Rewind-clear recovery failures must use the same visible `AppLog`/notification surface as selected-task recovery failures; console-only scheduling logs are not sufficient.
- Worktree delete/cleanup success followed by board reload failure is still an operation failure. Do not swallow `loadBoard({ sync: true })`; keep the worktree panel open and surface a visible operation error.
- `loadConversationHistoryUntilCard()` must propagate history/session load failures to the rail locate boundary instead of converting them into a false "missing rendered card" result.
- Browser tests must have a shared page error collector so page errors, unexpected console errors, and unexpected HTTP 4xx/5xx fixture responses fail loudly beyond one-off test-local collectors.
- SDK required-body post-processing must use the same operationId-to-method-name mapping as generated SDK methods and must honor mapped body keys such as `body_directory`.
- Task SSE DB-backed message replay must not use a timestamp-only watermark that can skip same-millisecond writes. The cursor needs a deterministic tie-breaker or must treat equal-watermark rows as activity.
- `/file/upload` OpenAPI responses must declare the same 400/409 errors exercised by server tests, and generated SDK error types must reflect them.
- OpenAPI JavaScript code samples must call the actual SDK method names, including camelCased method names derived from snake_case operation IDs.
- Provider model discovery must propagate provider config/state read failures from `Provider.getProvider()` instead of converting them into URL mismatch or missing-provider behavior.
- VSIX package contents must exclude local caches and test-only artifacts such as `.turbo`, `.vscode-test`, and e2e folders.
- File explorer user actions must not report success when the required post-action directory reload fails. The reload contract must reject so refresh/create/delete/move/upload can surface a visible reload failure instead of a false success toast.
- Shared browser error collection must include request failures without HTTP responses, not only page errors, console errors, and 4xx/5xx responses. Expected failures must be explicitly allowed per test.
- OpenAPI JavaScript samples must be generated from the actual SDK accessor tree after SDK generation, including Hey API conflict suffix getters. `operationId` string mapping alone is not a valid source of truth.
- Required file explorer reloads are owned by the user action that requested them. A background interval reload must not supersede the required reload token and convert a failed user action into a false success.
- Upload success followed by directory reload failure must be reported as a post-upload reload failure, not as an upload failure. The copy must not imply the upload did not happen.
- Browser collector allow predicates must have access to the query string so tests can allow only the exact expected fixture failure, not every route with the same pathname.
- FileExplorer retry from a directory error must force a reload and clear stale cached children/errors when the retry succeeds.
- FileEditor content load failures must render the actual load error and must not reuse the non-editable/binary message for transport or server failures.
- FileExplorer rename/move/delete from search results must refresh the active search resource after the durable mutation and required directory reload complete.
- Expired worktree cleanup must resync the worktree list even when a later delete in the batch fails after an earlier delete succeeded; the visible list must not preserve successfully removed rows.
- FileExplorer accessibility browser coverage must use the shared browser error collector and unmatched fixture routes must fail as 404s, not return success-shaped `{}` bodies.
- `/find/symbol` must call `LSP.workspaceSymbol(query)` and propagate LSP route failures rather than returning a hard-coded empty result.
- `GET /executor` must propagate `ExecutorBootstrap.autoRegister(true)` failures before discovery/list construction.
- `GET /gateway/stats` must use the same fail-fast `ChannelSupervisor.status()` semantics as `/channel/runtime`; stats must not silently omit channel runtime status after a status read failure.
- Browser tests that opt into page/console/response/request-failed diagnostics must use `installBrowserErrorCollector()` as the single collector. Representative non-FileExplorer fixtures must return explicit 404 for unmatched routes, and a source-level browser-test contract must prove the cited tests no longer maintain local collectors or success-shaped catch-all responses.
- `deleteTask()` and `renameTask()` must reject durable backend/load failures instead of returning false. Client-side validation may still return false before network mutation; successful 404 handling for an already-missing active task may remain explicit because it reloads the task list and proves the row is gone.
- Goal save/delete must not catch and hide `panelMessage()` or `loadBoard()` failures. The existing `runMainAsync()` / component notification boundary must receive the original error. The currently invisible manual goal edit/delete props are recorded as historical code; deletion requires separate user approval under rule 17.
- Scheduled selected-task board refresh failures must produce a visible `AppLog.error()` notification while preserving the retry. The stale board may remain visible, but the stale state must no longer be silent.
- `runTaskLoopInner()` must stop before `Orchestrator.processTask()` when `EngineGit.prepare(task)` returns an error. Baseline failure is not a recoverable warning inside the same decision pass.
- `/coding/sessions` must require both `cursorUpdated` and `cursorSessionID` together. The service layer must not synthesize an empty session ID for a half cursor, and legal compound cursors must preserve same-timestamp deterministic pagination.
- Coding assistant and experimental schedule route OpenAPI responses must declare the actual 400/404 errors already thrown by validators and ownership checks, and generated SDK error types must reflect those statuses.
- Attachment route stat handling must distinguish missing files from filesystem access/I/O failures. `ENOENT` may return 404; non-missing stat failures must propagate as server errors for both original attachment and thumbnail source lookup.
- Task queue reorder is a durable user action. Backend reorder failure or required post-reorder reload failure must show a visible error notification and must not be reduced to console-only diagnostics.
- Browser tests that previously installed local page/console/response collectors must delegate to `installBrowserErrorCollector()` so request failures without responses are collected through the same source.
- `/file/content` must fail fast for missing and unreadable files. Missing files may map to 404; read/access failures must propagate as server errors. Returning 200 with empty content is not an acceptable file-read state.
- `/session/global` pagination must use a compound cursor consistent with `time_updated desc, id desc`; timestamp-only headers or filters are insufficient because equal-timestamp sessions can be skipped.
- MCP auth storage may treat only a genuinely missing auth file as empty. Existing unreadable or corrupt auth data must abort reads and writes so credentials are not overwritten from a false empty state.
- MCP connect, disconnect, and OAuth support/auth routes must distinguish a missing configured server from a negative capability. Missing targets must surface as route errors rather than success or false OAuth support.
- MCP prompt/resource listing failures must follow tool-list fail-fast semantics: mark/close the failing server and propagate the failure. Empty prompt/resource maps are valid only when the server successfully returns no prompts/resources.
- TaskList durable mutations must distinguish mutation failure from required post-mutation reload failure. If the backend mutation succeeds but `loadTasks()` fails, the visible notification must say the action completed but the task list reload failed; it must not relabel the original mutation as failed or leave the reload failure silent.
- TaskDirBar browser tests must use the shared browser error collector everywhere; response-only local collectors are not sufficient because they miss page errors, console errors, and request failures.
- Queue reorder regression must cover both backend reorder failure and successful reorder followed by required task-list reload failure.
- `MCP.connect()` must throw when a configured server ends in failed/non-connected status. Route success must mean a connected MCP server, not merely an attempted connection.
- `MCP.tools()` must propagate connected-client `listTools()` failures after marking/closing the failed server. Partial or empty tool maps are valid only when all connected clients list tools successfully.
- Selected MCP prompt and resource fetch failures must propagate to callers. They must not return `undefined` and allow command rendering or the MCP adapter to fabricate empty/generic fallback content.
- Non-image binary file content reads may continue to return binary-empty content, but only after proving the file is readable. A read/access failure must propagate rather than produce a 200 empty binary response.
- OpenAPI/SDK contracts must document route-specific runtime error names and headers where the route exposes them. `file.read` 404 must include `FileNotFoundError`; `/session/global` 200 must declare `x-next-cursor-updated` and `x-next-cursor-session-id`.
- TaskDirBar worktree delete/cleanup must distinguish deletion failure from successful deletion followed by board reload failure. A board reload failure after deletion must show reload-failed copy and keep the worktree panel visibly actionable; it must not say `Delete failed` or `Cleanup failed`.
- TaskList reload-failure browser fixtures must return explicit error-shaped bodies for HTTP 500 responses so screenshots prove production-like readable copy, not success JSON stringification.
- Browser collector ownership must remove confirmed TaskList and current cross-cutting local collectors or extend the source regression so new local page/console/response collectors cannot bypass the shared `requestfailed` coverage.
- MCP resource prompt parts must propagate `MCP.readResource()` failures before persisting the prompt message. A failed MCP resource read must not be converted into ordinary user text.
- MCP startup `listTools()` failures must propagate through `MCP.tools()` and explicit connect, preserving the original error after closing the failed client/transport. Empty tool maps are valid only after startup and connected-client tool lists succeed.
- Provider and ACP attachment conversion must propagate failed local attachment reads. They may leave true remote URLs unchanged, but a recognized local attachment reference that cannot be read must not be preserved or skipped silently.
- SDK contract tests must inspect generated route-specific error blocks for runtime error names, including `UnknownError` where route tests prove 500 responses and `FileNotFoundError` where file routes prove 404 responses.
- TaskList durable post-mutation reloads must prove a request that starts after the mutation. A required fresh reload must not reuse a `_tasksLoading` request that began before the mutation, while ordinary background dedupe may remain for non-required refreshes.
- Browser tests must have a repository-level single collector contract: browser suites either install and assert `installBrowserErrorCollector()` or declare an explicit reviewed opt-out. Fixed hand-picked file guards are not sufficient for convergence.
- TaskDirBar task-list browser fixtures must model the single real task-list route used by the overlay client. They must not accept `/tasks` and `/global/tasks` interchangeably when the component path under test only calls `global/tasks`.
- Successful MCP resource blobs must become provider-usable content. If a blob cannot be materialized into a stored attachment or data URL, prompt creation must reject; it must not persist an unresolved `mcp://` file part that downstream provider conversion cannot read.
- ACP message replay must handle persisted `/attachment/...` file parts through the same attachment store source as live tool-result image attachments. A recognized stored attachment read failure must reject the replay conversion rather than silently dropping the file part.
- MCP OAuth completion failure must be an HTTP route failure. `finishAuth()` and authenticate callback routes must not return 200 with `{ status: "failed" }` when the OAuth finish or reconnect step fails.
- MCP OAuth 400 responses must match the documented named error contract. Plain `{ error }` bodies are not acceptable where OpenAPI/SDK declares `BadRequestError`.
- Routes that depend on MCP prompt/resource fail-fast behavior must declare those failure responses. `/experimental/resource` and `/command` contracts must not advertise only 200 when configured MCP list failures can propagate.
- Architect goal-count requirements must have one source of truth. Structured requirement decisions may carry explicit counts; regex or keyword parsing of raw user text must not create an independent goal-count contract.
- The main generate path must keep generated API docs in sync with generated OpenAPI. Either `script/generate.ts` or its workflow must run the API docs renderer/check so docs drift cannot pass generation.
- Required TaskDirBar board reloads must prove a board request starts after the durable worktree mutation. `loadBoard({ requireFresh: true })` must not return an older `_boardLoading` promise that began before the mutation.
- First-page task reloads must isolate themselves from stale pagination responses. A held `loadMoreTasks()` response from an older task-list generation must not append stale rows or overwrite the cursor after `loadTasks({ requireFresh: true })`.
- Browser task-list fixtures must model the one production route used by the overlay task-list client. A test fixture that accepts `/tasks` and `/global/tasks` interchangeably hides route regressions and must be rejected by a repository source contract.
- Browser fixtures that exercise task-list initialization must model `GET /skill/mounts?directory=...` explicitly. The shared browser error collector must fail an unhandled skill mount route as a fixture defect, not let the GUI test pass with a hidden 404.
- The screenshot browser evidence suite must use the shared browser error collector and assert it, with explicit allow rules for known fixture failures.
- Screenshot browser fixtures must hydrate the same card-tree source the UI reads. Transcript rows, `view.messages`, `agentView.messages`, and tool part order keys must be generated from one timeline so visual screenshots do not hide hydrate errors behind an empty or stale screenshot list.
- MCP text resources must be materialized into prompt text only. Once text content is materialized, the original unresolved `mcp://` file part must not be persisted; resources with no usable text/blob content must reject.
- Local prompt file read failures must reject prompt creation before message persistence. They must not become ordinary user-visible text parts.
- ACP session load and fork replay must propagate history fetch failures. Replaying a session without its persisted history is not an acceptable partial state.
- ACP replay must preserve persisted HTTP(S) file parts as explicit remote resources rather than silently dropping them. Recognized local attachment references still fail fast on unreadable attachment storage.
- Proxied MCP server startup must propagate tool/prompt/resource prewarm failures. A proxy that cannot list its advertised surface must not start in a silently degraded state.
- MCP OAuth start routes must declare and test the 500 error path already reachable when OAuth provider startup fails.
- Release scripts must not run broad git cleanup commands that can destroy unrelated local work. Dirty-worktree and merge-failure states must be surfaced without `git checkout -- .` or `git clean -fd`.
- Generated API docs grouping must fail on unknown route groups or missing `merge_into` targets. A silent fallback group is a second source of route taxonomy.
- Architecture docs must remove stale gateway kind/path references that no longer exist in the session kind or source tree.
- Session-config generation tests must follow the current root generation contract: root `script/generate.ts` calls the SDK build and API docs renderer in order; OpenAPI generation is owned by the SDK build script.

## Regression Matrix

- `bun test packages/opencorvus/test/server/project-routes.test.ts -t "PATCH /project/:projectID" --timeout 60000`
- `bun test packages/opencorvus/test/session/instruction.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/auth/auth.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/gateway/e2e.test.ts packages/opencorvus/test/gateway/bindings-route.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/session/message.test.ts --timeout 60000`
- `bun test packages/channel-runtime/test/registry.test.ts packages/channel-runtime/test/bundled-env.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/sdk-build-format-contract.test.ts --timeout 60000`
- `bunx vsce ls --no-dependencies` from `packages/vscode-extension`
- `rg -n -- "--no-verify" .github script packages` should return only prompt text or tests, not push commands.
- Overlay browser tests for TaskDirBar and FileExplorer failure states must save screenshots under `.scratch/`.
- `bun test packages/overlay/test/selected-task-recovery.test.ts packages/overlay/test/sse-reconnect.test.ts packages/overlay/test/sse-parse-error.test.ts --timeout 60000`
- `bun test packages/overlay/test/conversation-replay-errors.test.ts packages/overlay/test/tree-writer-projection-primitives.test.ts packages/overlay/test/card-duration-single-source.test.ts --timeout 60000`
- Browser screenshot for completed task missing `time.completed` must show the explicit elapsed error state.
- `bun test packages/overlay/test/chat-persisted-message.test.ts packages/overlay/test/tree-writer-projection-primitives.test.ts --timeout 60000`
- `bun test packages/overlay/test/selected-task-recovery.test.ts packages/overlay/test/sse-reconnect.test.ts --timeout 60000`
- Browser screenshot for terminal task with `time.completed < time.created` must show the explicit invalid elapsed error state.
- Conversation agent rail locate failure must be covered by a GUI/browser or component-level test that proves a visible notification and no unhandled rejection.
- `bun test packages/opencorvus/test/server/provider-discover-models.test.ts packages/opencorvus/test/script/mission-e2e-inactivity.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/server/file-routes.test.ts packages/opencorvus/test/script/sdk-build-format-contract.test.ts --timeout 60000`
- SDK/OpenAPI generation guard must verify file item error responses and required-parameter signatures.
- Workspace package identity test must prove package names are unique and the VSIX lockfile entry matches the manifest.
- Conversation history event-window regression must cover same-timestamp different-orderKey events.
- Rewind-clear recovery failure regression must assert visible `AppLog`/notification on hydrate failure.
- TaskDirBar browser regression must cover delete success followed by `loadBoard` failure and verify a visible operation error.
- Agent rail locate regression must prove service-level history load failures reach the visible locate-failed notification.
- Browser error collector regression must prove unexpected page errors / console errors / fixture 404s fail tests through a shared helper.
- SDK format contract must cover snake_case operation IDs and mapped body fields, not only file item methods.
- Task SSE regression must cover same-millisecond message/part writes after `after_message_watermark`.
- File upload OpenAPI/SDK regression must verify 400/409 responses and `FileUploadErrors`.
- OpenAPI sample regression must compare `x-codeSamples` SDK calls with generated SDK method names.
- Provider discovery regression must monkeypatch `Provider.getProvider()` to throw and prove no upstream call happens.
- VSIX package regression must assert `vsce ls --no-dependencies` output excludes local cache/test-only paths.
- File explorer browser regression must prove refresh or upload followed by `/file` reload failure shows a visible reload error and does not show a success status.
- Browser error collector regression must prove `requestfailed` without a response fails through the shared helper.
- SDK sample regression must parse every generated JavaScript `x-codeSamples` accessor and prove each intermediate segment exists as a generated SDK getter and each final segment exists as a generated SDK method, covering conflict suffix paths such as `project.current2.delete`, `channel.runtime2.restart`, `provider.auth2.prompts`, and `task.conversation2.history`.
- FileExplorer regression must prove a slow required reload cannot be superseded by a background reload into a false success.
- FileExplorer upload regression must prove upload 200 + reload 500 reports reload failure copy, not `Upload failed` and not upload success.
- Browser collector regression must prove a test can allow `/file?path=` while still failing `/file?path=src`.
- FileExplorer retry regression must prove cached children do not block retry after a root reload failure and that the list recovers visibly.
- FileEditor browser regression must prove `/file/content` 500 displays a content-load error and not the non-editable/binary copy.
- FileExplorer search mutation regression must prove deleting or moving a search result refetches the active search results.
- TaskDirBar browser regression must prove expired cleanup partial failure refreshes successfully deleted worktrees out of the panel while preserving a visible error.
- FileExplorer accessibility browser regression must use `installBrowserErrorCollector()` and fail unmatched fixture routes as 404s.
- File route regression must prove `/find/symbol` returns `LSP.workspaceSymbol(query)` results and propagates LSP failure.
- Executor route regression must prove `GET /executor` propagates `ExecutorBootstrap.autoRegister(true)` failures.
- Gateway stats regression must prove `ChannelSupervisor.status()` failure makes `/gateway/stats` fail rather than returning 200 without `channelRuntime`.
- Browser fixture collector regression must prove app-dialog segmented-control uses the shared collector and unmatched fixture routes fail as 404s rather than success-shaped `{}`.
- TaskList browser regression must prove delete and rename backend failures show `.app-notification[data-tone="error"]` and leave the original row/title visible.
- Goal operation tests must prove save/delete failures reach a visible error notification path instead of staying console-only.
- Board store regression must prove scheduled board refresh failures call `AppLog.error()` with notification metadata while preserving the retry path.
- Orchestrator loop regression must prove `EngineGit.prepare()` errors prevent `Orchestrator.processTask()` from being called.
- Coding route regression must prove half compound cursors return 400 and legal same-timestamp cursor pairs do not skip or duplicate sessions.
- OpenAPI/SDK regression must prove coding CLI/session/selection and experimental schedule delete operations expose generated 400/404 error types.
- Attachment route regression must prove missing attachment files return 404 while non-missing `stat()` errors propagate as server errors.
- TaskList browser regression must prove queued-task reorder backend failure shows a visible error notification and preserves the visible queue rows without a false success state.
- Browser collector source regression must prove Coding Assistant directory browser coverage uses `installBrowserErrorCollector()` and no local page/console/response collector.
- File content regression must prove missing files no longer return 200 empty content and unreadable/read-failed files propagate an error status.
- Global session regression must prove two same-timestamp sessions paginate without skip or duplicate through the compound cursor contract.
- MCP auth regression must prove existing corrupt/unreadable auth storage rejects `all()`, `set()`, and `remove()` instead of overwriting credentials from `{}`.
- MCP route regression must prove missing configured server connect/disconnect/OAuth routes return the documented missing-target error.
- MCP prompt/resource regression must prove prompt/resource list failures propagate and mark/close the server instead of returning an empty map.
- TaskList browser regression must prove start-now/project delete/project rename successful mutations followed by `/global/tasks` reload failure show reload-failed copy, not mutation-failed copy or success copy.
- TaskDirBar browser collector source regression must prove the file has no local page/console/response collectors and uses `installBrowserErrorCollector()` for expected HTTP failures.
- Queue reorder browser regression must prove successful reorder followed by `/global/tasks` reload failure shows the reload-failed queue notification with rows still visible.
- MCP connect regression must prove a configured server startup/connect failure makes `POST /mcp/:name/connect` fail rather than return `true`.
- MCP tool regression must prove connected-client `listTools()` failures reject `MCP.tools()` and mark/close the server.
- MCP prompt/resource fetch regression must prove selected prompt/resource read failures reject instead of returning `undefined`.
- File content regression must prove non-image binary read/access failures reject while readable binary files still return binary-empty content.
- SDK/OpenAPI regression must prove `FileReadErrors` includes `FileNotFoundError` and `/session/global` declares both next-cursor response headers.
- TaskDirBar browser regression must prove successful worktree delete plus selected-task board reload 500 shows worktree reload-failed copy and saves a reviewed screenshot.
- TaskDirBar browser regression must prove successful expired cleanup plus selected-task board reload 500 shows cleanup reload-failed copy and saves a reviewed screenshot.
- TaskList browser regression must prove start-now/delete/rename/reorder reload 500 fixtures use error-shaped bodies and visible reload-failed notifications stay readable.
- Browser collector source regression must cover the confirmed TaskList browser files plus conversation/message/profile/header files and fail on local page/console/response collectors unless the shared collector is installed.
- Session prompt regression must prove MCP resource read failures reject `createUserMessage()` and leave no fabricated `Failed to read MCP resource` user part.
- MCP startup regression must prove startup `listTools()` failure rejects `MCP.tools()` rather than returning `{}` and leaves failed status with the original list error.
- Provider transform regression must prove recognized local attachment read failure rejects instead of preserving the original AI SDK file part.
- ACP regression must prove tool-result image attachment read failure rejects instead of silently omitting the image content.
- SDK/OpenAPI regression must prove generated `FileReadErrors` and `McpConnectErrors` include their route-proven runtime error names, not only the type aliases.
- TaskList reload regression must prove a required post-mutation `loadTasks()` waits for any stale in-flight load and then performs a new `global/tasks` request after the mutation.
- Browser collector source regression must cover all browser test files, requiring shared collector install/assert or a reviewed opt-out list.
- TaskDirBar browser fixture regression must fail if task-list reload paths accept `/tasks` for scenarios where the overlay client should call only `/global/tasks`.
- Session prompt regression must prove MCP blob resources are materialized to provider-usable stored attachments or reject before persistence.
- ACP replay regression must prove persisted `/attachment/...` file parts appear in replayed ACP message content, and read failures do not become silent omissions.
- MCP OAuth route regression must prove callback/authenticate finish failures return a route error instead of HTTP 200 failed status, and unsupported OAuth 400s return named errors.
- OpenAPI/SDK regression must prove `/experimental/resource` and `/command` expose error types for propagated MCP prompt/resource list failures.
- Architect regression must prove goal-count prompt contracts come only from structured requirement decisions and are not inferred from regex matches in raw task text.
- Generation regression must prove the main generate path invokes or checks API markdown rendering from OpenAPI.
- TaskDirBar board reload regression must prove a required `loadBoard({ requireFresh: true })` waits for a stale in-flight board request and then issues a new selected-task board request after worktree delete or cleanup.
- Task pagination regression must prove a stale held `loadMoreTasks()` response cannot append rows or update cursor after a required fresh task-list reload completes.
- Browser fixture route regression must scan every browser test for dual `/tasks` and `/global/tasks` task-list handlers, and a browser route fixture must prove `/tasks` is unmatched while `/global/tasks` succeeds.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-list-tree-click.test.ts` must pass with the shared browser error collector, including the real `GET /skill/mounts?directory=...` initialization route.
- Screenshot browser collector regression must prove `screenshot-browser-panel-browser.test.ts` installs and asserts the shared browser collector.
- Screenshot browser fixture regression must prove the generated screenshots panel comes from card-tree hydrate metadata, with no visible `missing orderKey` errors in `.scratch/screenshot-browser-panel-browser.png`.
- Task pagination regression must prove a stale held `loadMoreTasks()` response cannot append rows or restore cursor state after `clearTasksForMissingDirectory()` replaces the task list with an empty missing-directory state.
- Selected-task board regression must prove `loadBoard({ requireFresh: true })` rechecks the current active task after waiting for a stale in-flight board refresh and does not issue the fresh request against the old task.
- Session prompt file-range regression must prove malformed `start`/`end`, out-of-range line numbers, reversed ranges, and failed symbol expansion reject instead of silently coercing or degrading to a narrower read.
- ACP prompt regression must prove `file://` image URI parts are either converted to provider file parts or rejected; they must not be silently omitted from the prompt.
- MCP OAuth auth-remove regression must prove `DELETE /mcp/:name/auth` declares and returns a documented 500 route error when auth storage removal fails.
- API docs regression must prove any OpenAPI operation object without `operationId` fails docs/sample-contract generation with the method and path, instead of being skipped.
- Release merge regression must prove post-merge stage/commit failures abort the current merge before any later PR is processed.
- Release push safety regression must reject non-lease `git push --force` usage in scripts and workflows.
- Architecture doc-health regression must prevent `02-data.md` from hard-coding stale engine table or artifact-kind inventories that duplicate `engine.sql.ts`.
- Architecture doc-health regression must prevent `03-control.md` from hard-coding stale panel action or orchestrator route counts that duplicate code truth.
- Task pagination UI regression must prove stale `loadMoreTasks()` requests cannot leave `tasksLoadingMore` stuck after a fresh first-page reload or clear a newer pagination request's loading state.
- Release fetch/lease regression must prove release scripts fetch branch heads into the exact remote-tracking refs used to compute `--force-with-lease` expectations.
- Mission E2E regression must prove inactivity timeout, loop errors, missing required state files, and verification mismatches fail the process instead of logging and exiting 0.
- Session prompt regression must prove invalid MCP resource blob base64 rejects before writing an attachment-backed file part.
- ACP replay regression must prove malformed or empty data URL file parts reject replay instead of becoming empty ACP image/resource content.
- ACP tool-result regression must prove completed image attachments with unsupported or malformed URLs fail fast instead of silently dropping the image while sending a completed update.
- Session prompt regression must prove text-only MCP resources persist text content without any unresolved `mcp://` file part.
- Session prompt regression must prove local text file read failure rejects `createUserMessage()` and does not persist a fallback user message.
- ACP replay regression must prove `loadSession()` and `unstable_forkSession()` reject on history fetch failure, and persisted HTTP(S) file parts replay as explicit ACP resource content.
- MCP serve regression must prove proxied tool/prompt/resource prewarm failure rejects startup rather than logging and continuing.
- MCP OAuth route/SDK regression must prove OAuth start failure returns a documented 500 `UnknownError` and generated `McpAuthStartErrors` includes the route error.
- Release script safety regression must reject broad destructive git cleanup commands in `script/beta.ts`.
- API docs regression must prove unknown route groups and missing merge targets throw rather than falling into `order: 9999`.
- Architecture doc-health regression must reject stale `kind='gateway'` and `src/gateway` references in new-architecture docs.
- Generation contract regression must prove retired direct root `generate-openapi.ts` expectations are gone and root generation invokes SDK build before docs rendering.

## Eighth Round Verification

- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/file-explorer-search-error.test.ts` passed. Visual evidence reviewed at `.scratch/file-explorer-search-error-visible.png`, `.scratch/file-explorer-refresh-error-visible.png`, and `.scratch/file-explorer-upload-reload-error-visible.png`.
- `bun test packages/overlay/test/selected-task-recovery.test.ts packages/overlay/test/conversation-hydrate-replay.test.ts packages/overlay/test/runtime-directory-actions.test.ts packages/overlay/test/browser-error-collector.test.ts --timeout 60000` passed.
- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts -t "same-millisecond" --timeout 60000` passed.
- `bun test packages/opencorvus/test/server/provider-discover-models.test.ts packages/opencorvus/test/server/file-routes.test.ts packages/opencorvus/test/script/sdk-build-format-contract.test.ts --timeout 60000` passed.
- `bun test packages/vscode-extension/test/package-vsix.test.ts --timeout 60000` passed.
- `bun run ./packages/opencorvus/script/check/routes.ts`, `bun run ./packages/opencorvus/script/docs/render-api-md.ts --check`, `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/overlay check:i18n`, focused `git diff --check`, and `bun ./packages/sdk/js/script/build.ts` passed.

## Ninth Round Verification

- `bun test packages/opencorvus/test/server/file-routes.test.ts --timeout 60000` passed.
- `bun test packages/opencorvus/test/server/executor-routes.test.ts --timeout 60000` passed.
- `bun test packages/opencorvus/test/gateway/e2e.test.ts -t "gateway/stats" --timeout 60000` passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/file-explorer-search-error.test.ts` passed. Visual evidence reviewed at `.scratch/file-explorer-retry-recovered-visible.png`, `.scratch/file-editor-content-load-error-visible.png`, and `.scratch/file-explorer-search-delete-refetch-visible.png`.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts` passed. Visual evidence reviewed at `.scratch/task-dirbar-worktree-cleanup-partial-failure-visible.png`.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/file-explorer-accessibility.test.ts` passed after the fixture was moved to the shared browser error collector and unmatched routes were made explicit 404s.
- `bun ./packages/sdk/js/script/build.ts` passed after repairing the SDK build write helper to use temp-file rename retry for Windows `EUNKNOWN` file locks.
- `bun run ./packages/opencorvus/script/check/routes.ts`, `bun run ./packages/opencorvus/script/docs/render-api-md.ts --check`, `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts --timeout 60000`, `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/overlay check:i18n`, `bun test packages/overlay/test/browser-error-collector.test.ts packages/overlay/test/runtime-directory-actions.test.ts packages/overlay/test/worktree-service.test.ts packages/overlay/test/task-cwd-row-layout.test.ts --timeout 60000`, and focused `git diff --check` passed.

## Tenth Round Verification

- `bun test packages/opencorvus/test/orchestrator/loop-prepare-baseline.test.ts packages/opencorvus/test/server/coding-routes.test.ts packages/opencorvus/test/server/attachment-routes.test.ts packages/opencorvus/test/server/experimental-schedule-routes.test.ts packages/opencorvus/test/server/experimental-schedule-contract.test.ts packages/opencorvus/test/script/sdk-build-format-contract.test.ts --timeout 60000` passed.
- `bun test packages/overlay/test/task-rename-service.test.ts packages/overlay/test/task-selection-dead-task.test.ts packages/overlay/test/goal-dialog-error.test.ts packages/overlay/test/runtime-directory-actions.test.ts packages/overlay/test/browser-error-collector.test.ts packages/overlay/test/overlay-unhandled-rejection-owners.test.ts --timeout 60000` passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/app-dialog-segmented-control.test.ts` passed. Visual evidence reviewed at `.scratch/app-dialog-real-task-decision-focus.png` and `.scratch/app-dialog-real-task-decision-queue-focus.png`.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts` passed. Visual evidence reviewed at `.scratch/task-list-delete-failure-visible.png` and `.scratch/task-list-rename-failure-visible.png`; the earlier fixture-only `missing orderKey` notification was removed by adding the backend order key to the task fixture.
- `bun test packages/overlay/test/browser-error-collector.test.ts --timeout 60000`, `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/overlay check:i18n`, `bun run ./packages/opencorvus/script/check/routes.ts`, `bun run ./packages/opencorvus/script/docs/render-api-md.ts --check`, and focused `git diff --check` passed.

## Eleventh Round Verification

- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts` passed. Visual evidence reviewed at `.scratch/task-list-reorder-failure-visible.png`, which shows the queued rows still visible and the visible queue-reorder API 500 notification.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/coding-assistant-directory-browser.test.ts` passed after the test switched to `installBrowserErrorCollector()`.
- `bun test packages/overlay/test/browser-error-collector.test.ts --timeout 60000`, `bun run --cwd packages/overlay typecheck`, and `bun run --cwd packages/overlay check:i18n` passed.
- `bun test packages/opencorvus/test/file/index.test.ts packages/opencorvus/test/server/file-routes.test.ts packages/opencorvus/test/server/global-session-list.test.ts packages/opencorvus/test/mcp/auth-store.test.ts packages/opencorvus/test/server/mcp-routes.test.ts packages/opencorvus/test/mcp/prompt-resource-fail-fast.test.ts packages/opencorvus/test/script/sdk-build-format-contract.test.ts --timeout 60000` passed.
- `bun ./packages/sdk/js/script/build.ts`, `bun run ./packages/opencorvus/script/check/routes.ts`, `bun run ./packages/opencorvus/script/docs/render-api-md.ts --check`, and `bun run --cwd packages/opencorvus typecheck` passed.

## Twelfth Round Verification

- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts` passed. Visual evidence reviewed at `.scratch/task-list-start-now-reload-failure-visible.png`, `.scratch/task-list-project-delete-reload-failure-visible.png`, `.scratch/task-list-project-rename-reload-failure-visible.png`, and `.scratch/task-list-reorder-reload-failure-visible.png`; each screenshot shows reload-failed copy instead of mutation-failed copy.
- `bun test packages/overlay/test/browser-error-collector.test.ts --timeout 60000`, `bun run --cwd packages/overlay typecheck`, and `bun run --cwd packages/overlay check:i18n` passed. `rg -n 'page\.on\("response|badResponses|unexpectedBadResponses|page\.on\("console|page\.on\("pageerror' packages/overlay/test/browser/task-dirbar-keyboard.test.ts` returned no matches.
- `bun test packages/opencorvus/test/file/index.test.ts packages/opencorvus/test/server/file-routes.test.ts packages/opencorvus/test/mcp/prompt-resource-fail-fast.test.ts packages/opencorvus/test/server/mcp-routes.test.ts packages/opencorvus/test/script/sdk-build-format-contract.test.ts --timeout 60000` passed.
- `bun ./packages/sdk/js/script/build.ts`, `bun run ./packages/opencorvus/script/check/routes.ts`, `bun run ./packages/opencorvus/script/docs/render-api-md.ts --check`, `bun run --cwd packages/opencorvus typecheck`, and `git diff --check` passed.

## Thirteenth Round Verification

- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts` passed. Visual evidence reviewed at `.scratch/task-dirbar-worktree-delete-board-reload-failure-visible.png`, `.scratch/task-dirbar-worktree-cleanup-board-reload-failure-visible.png`, `.scratch/task-list-start-now-reload-failure-visible.png`, `.scratch/task-list-project-delete-reload-failure-visible.png`, `.scratch/task-list-project-rename-reload-failure-visible.png`, and `.scratch/task-list-reorder-reload-failure-visible.png`; the worktree panel remains visible/actionable, and TaskList reload errors show readable error-shaped copy rather than raw task-list JSON.
- `bun test packages/overlay/test/runtime-directory-actions.test.ts --timeout 60000` passed after `loadBoard()` was corrected to preserve parsed `ApiError` bodies for required board reload failures.
- `bun test packages/overlay/test/browser-error-collector.test.ts --timeout 60000`, `bun run --cwd packages/overlay typecheck`, and `bun run --cwd packages/overlay check:i18n` passed.
- `bun test packages/opencorvus/test/mcp/prompt-resource-fail-fast.test.ts --timeout 60000`, `bun test packages/opencorvus/test/mcp/startup-failure.test.ts packages/opencorvus/test/mcp/status-lazy-start.test.ts --timeout 60000`, and `bun test packages/opencorvus/test/session/prompt-parts-model-resolution.test.ts --timeout 60000` passed.
- `bun test packages/opencorvus/test/acp/event-subscription.test.ts --timeout 60000`, `bun test packages/opencorvus/test/provider/transform.test.ts --timeout 60000`, and `bun test packages/opencorvus/test/server/mcp-routes.test.ts packages/opencorvus/test/server/file-routes.test.ts packages/opencorvus/test/script/sdk-build-format-contract.test.ts --timeout 60000` passed.
- `bun ./packages/sdk/js/script/build.ts`, `bun run ./packages/opencorvus/script/check/routes.ts`, `bun run ./packages/opencorvus/script/docs/render-api-md.ts --check`, `bun run --cwd packages/opencorvus typecheck`, and `git diff --check` passed.

## Fourteenth Round Verification

- `bun test packages/overlay/test/events-refresh.test.ts -t "task-list reloads are single-flight across refresh triggers|required task-list reload starts after an older in-flight refresh settles" --timeout 60000` passed after required post-mutation task reloads were changed to wait for stale in-flight refreshes and then issue a fresh `/global/tasks` request.
- `bun test packages/overlay/test/browser-error-collector.test.ts packages/overlay/test/runtime-directory-actions.test.ts --timeout 60000`, `bun run --cwd packages/overlay typecheck`, and `bun run --cwd packages/overlay check:i18n` passed after the browser collector source guard became repository-wide and the TaskDirBar fixture accepted only `/global/tasks`.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts` passed. Visual evidence was reviewed at `.scratch/task-dirbar-worktree-delete-board-reload-failure-visible.png`, `.scratch/task-dirbar-worktree-cleanup-board-reload-failure-visible.png`, `.scratch/task-list-start-now-reload-failure-visible.png`, `.scratch/task-list-project-delete-reload-failure-visible.png`, `.scratch/task-list-project-rename-reload-failure-visible.png`, and `.scratch/task-list-reorder-reload-failure-visible.png`; each screenshot shows a readable reload-failed error while preserving the relevant worktree/task rows.
- `bun test packages/opencorvus/test/session/prompt-parts-model-resolution.test.ts --timeout 60000` passed after MCP blob resources were materialized as stored `/attachment/...` file parts with resource provenance instead of unresolved `mcp://` provider file parts.
- `bun test packages/opencorvus/test/acp/event-subscription.test.ts --timeout 60000` passed after ACP history replay resolved persisted `/attachment/...` file parts into ACP image content instead of skipping them.
- `bun test packages/opencorvus/test/server/mcp-routes.test.ts --timeout 60000` passed after OAuth finish failures became route errors and unsupported OAuth routes returned the documented BadRequest response shape.
- `bun test packages/opencorvus/test/architect/agent.test.ts packages/opencorvus/test/architect/output-tools.test.ts --timeout 60000` passed after architect goal-count contracts were limited to structured requirement decisions and raw task text stopped creating a second contract source.
- `bun ./packages/sdk/js/script/build.ts`, `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts packages/opencorvus/test/script/routes-check-openapi.test.ts --timeout 60000`, `bun run ./packages/opencorvus/script/check/routes.ts`, `bun run ./packages/opencorvus/script/docs/render-api-md.ts --check`, and `bun run --cwd packages/opencorvus typecheck` passed after `/command`, `/experimental/resource`, and MCP OAuth route error contracts were regenerated into OpenAPI/SDK/docs. `script/generate.ts` now runs formatting before API markdown rendering so `docs:check` remains stable.

## Fifteenth Round Verification

- `bun test packages/overlay/test/events-refresh.test.ts -t "required task-list reload starts after an older in-flight refresh settles|stale pagination response cannot append after a required fresh task-list reload" --timeout 60000` passed after stale pagination responses were made generation-aware and unable to append rows after a required fresh reload.
- `bun test packages/overlay/test/runtime-directory-actions.test.ts -t "loadBoard requireFresh" --timeout 60000` passed after required board reloads were changed to wait through stale in-flight loads and then issue a fresh selected-task board request.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-list-tree-click.test.ts` passed after the fixture added the real `GET /skill/mounts?directory=...` initialization route while keeping task-list reloads scoped to `/global/tasks`. Visual evidence was reviewed at `.scratch/task-row-children-toggle-focus.png`, `.scratch/task-row-actions-keyboard-open.png`, and `.scratch/task-row-cancel-armed-confirm.png`.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts` passed after the screenshot browser fixture populated card-tree hydrate metadata, message order keys, session order keys, and tool-part order keys instead of relying on transcript-only data. Visual evidence was reviewed at `.scratch/screenshot-browser-panel-browser.png`, `.scratch/screenshot-browser-panel-browser-preview.png`, `.scratch/screenshot-browser-panel-browser-reopen.png`, and `.scratch/screenshot-browser-panel-browser-narrow-panel.png`; the panel shows screenshot groups/thumbnails without visible `missing orderKey` hydration errors.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts` passed. Visual evidence was reviewed at `.scratch/task-dirbar-worktree-delete-board-reload-failure-visible.png`, `.scratch/task-dirbar-worktree-cleanup-board-reload-failure-visible.png`, and `.scratch/task-list-start-now-reload-failure-visible.png`; reload-failed copy remains readable and rows/panels stay actionable.
- `bun test packages/overlay/test/browser-error-collector.test.ts --timeout 60000`, `bun run --cwd packages/overlay typecheck`, and `bun run --cwd packages/overlay check:i18n` passed after screenshot browser coverage kept the shared collector while explicitly bounding expected thumbnail aborts from cancellation stress.
- `bun test packages/opencorvus/test/server/mcp-routes.test.ts packages/opencorvus/test/mcp/serve.test.ts packages/opencorvus/test/acp/event-subscription.test.ts packages/opencorvus/test/session/prompt-parts-model-resolution.test.ts packages/opencorvus/test/session/prompt.test.ts --timeout 60000` passed after MCP prewarm, ACP replay/history, and session prompt materialization remained fail-fast with no fabricated fallback content.
- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts packages/opencorvus/test/script/routes-check-openapi.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/server/session-config-routes.test.ts --timeout 60000`, `bun run ./packages/opencorvus/script/check/routes.ts`, `bun run ./packages/opencorvus/script/docs/render-api-md.ts --check`, `bun run --cwd packages/opencorvus typecheck`, `bun ./packages/sdk/js/script/build.ts`, and focused `git diff --check` passed after API docs group ordering became explicit for QuickNote and new-architecture docs rejected stale gateway references.

## Sixteenth Round Verification

- Independent Overlay/GUI audit found stale pagination could still append after missing-directory task clear, and required-fresh board reload could issue the post-wait request against the old selected task. `applyTasks()` now invalidates task-list pagination at the canonical task-list write boundary, and `loadBoard({ requireFresh: true })` rechecks `activeTaskID()` after waiting for any stale in-flight board request.
- `bun test packages/overlay/test/events-refresh.test.ts -t "required task-list reload starts after an older in-flight refresh settles|stale pagination response cannot append after" --timeout 60000` passed, covering both required fresh reload and `clearTasksForMissingDirectory()` invalidation.
- `bun test packages/overlay/test/runtime-directory-actions.test.ts -t "loadBoard requireFresh" --timeout 60000` passed, including the selected-task switch-after-wait regression.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts` passed. Visual evidence was reviewed at `.scratch/task-dirbar-worktree-delete-board-reload-failure-visible.png`, `.scratch/task-dirbar-worktree-cleanup-board-reload-failure-visible.png`, and `.scratch/task-list-start-now-reload-failure-visible.png`; reload failures remain readable and relevant rows/panels remain visible.
- Independent backend audit found session file ranges silently coerced malformed line numbers, ACP image `file://` URIs were omitted, `DELETE /mcp/:name/auth` lacked a 500 contract, and API docs/sample checks skipped operations without `operationId`. Session prompt range parsing now requires positive safe integers, reversed ranges reject, requested symbol expansion propagates LSP failures, ACP file image URIs become provider file parts, MCP auth removal declares 500, and OpenAPI docs/sample collection fails on missing `operationId`.
- `bun test packages/opencorvus/test/session/prompt.test.ts -t "file range|symbol range" --timeout 60000`, `bun test packages/opencorvus/test/acp/event-subscription.test.ts -t "prompt image URIs" --timeout 60000`, and `bun test packages/opencorvus/test/server/mcp-routes.test.ts -t "credential removal" --timeout 60000` passed.
- `bun test packages/opencorvus/test/session/prompt-parts-model-resolution.test.ts packages/opencorvus/test/session/prompt.test.ts packages/opencorvus/test/acp/event-subscription.test.ts packages/opencorvus/test/server/mcp-routes.test.ts packages/opencorvus/test/mcp/serve.test.ts --timeout 60000` passed.
- Independent tooling/docs audit found beta post-merge stage/commit failures did not abort the merge, release pushes used non-lease `--force`, and architecture docs duplicated stale engine/capability/route inventories. `script/beta.ts` now aborts after stage/commit failure, beta and release pushes use `--force-with-lease`, and new-architecture docs reference code truth instead of copying full counts/lists.
- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts packages/opencorvus/test/script/routes-check-openapi.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 60000`, `bun ./packages/sdk/js/script/build.ts`, `bun run ./packages/opencorvus/script/check/routes.ts`, `bun run ./packages/opencorvus/script/docs/render-api-md.ts`, and `bun run ./packages/opencorvus/script/docs/render-api-md.ts --check` passed after regenerating OpenAPI/SDK/API docs.
- `bun run --cwd packages/opencorvus typecheck`, `bun run --cwd packages/overlay typecheck`, and `bun run --cwd packages/overlay check:i18n` passed.

## Seventeenth Confirmed Residuals

Independent backend/runtime audit found four new non-duplicate issue locations after the sixteenth repair batch:

- Data URL binary file parts still validated only the `data:*;base64,` prefix before reaching `Buffer.from(..., "base64")`. Affects `decodeDataUrlBase64()` callers in `session/prompt/parts.ts` and model-bound attachment conversion in `session/message.ts`; text data URLs also need strict payload validation before text injection.
- MCP tool-result materialization still decoded image `data` and resource `blob` with raw `Buffer.from(..., "base64")`, allowing malformed tool output to persist damaged attachments.
- MCP resource listing keyed resources by sanitized `resource.name`, so same-name resources with different URIs collided and one became unreachable. Resource identity must use the resource URI as the stable key component.
- Standalone session mirror enriched live `message.part.updated` with the owning message order key instead of a part/event order key, breaking the strict backend order-key single source that the overlay uses for part projection.

Call point recall for this repair:

- Base64 payload decoding: `decodeDataUrlBase64()`, `decodeDataUrlText()`, `decodeRawBase64Payload()`, `session/prompt/parts.ts` data URLs, `session/message.ts` model-bound file/tool-result attachment conversion, `session/loop.ts` tool-result media extraction, and `mcp/materialize.ts` tool-result content.
- MCP resources: `fetchResourcesForClient()`, `MCP.resources()`, `/experimental/resource`, MCP serve resource list/read, and prompt resource materialization through `MCP.readResource()`.
- Session mirror order keys: `overlayInfoForPayload()`, `stampPayloadWithMeta()`, `stampSessionPayload()`, `message.part.updated` mirror events, `ProtocolStore` replay of mirrored events, and overlay tree-writer part ordering.
- Tooling/release residuals confirmed by independent tooling audit: beta PR head fetch must force-update the local `pr/<number>` ref for force-pushed PRs; mission E2E inactivity cancellation must have a bounded settle after `SessionPrompt.cancel()`; release creation must not be hidden behind `|| true`; release asset upload must give every uploaded file a unique release-asset basename instead of clobbering cross-platform duplicates; release branch publishing must handle exact no-op rebuilds explicitly without hiding real commit failures.
- Overlay residuals confirmed by independent GUI audit: the goal-group benchmark route fixture still accepts both `/tasks` and `/global/tasks` and returns the retired `time_created/time_updated` task shape; the mission visual loop returns empty 200 responses for unmatched routes and only logs `pageerror`/`requestfailed`; `events-refresh.test.ts` fabricates prefix-valid but non-canonical `v1:test:*` order keys; `conversation-agents.ts` silently returns when live `message.part.updated` lacks top-level `channel/resolvedRole`; and task-list pagination derives the next cursor from `task.time.updated` while the sidebar sort source is `task.time.created`, so updated old tasks can displace rows without becoming reachable by the next page.
- Overlay call point recall: `goal-group-benchmark.ts` route matching and board task fixture, `mission-visual-loop.ts` route/error collection, `events-refresh.test.ts` order-key fixtures, `applyLiveConversationAgentPartUpdated()`/tree-writer projection primitives, `taskPageFromResponse()`, `loadMoreTasks()`, `TaskList` sorted rendering, and `/global/tasks` cursor query construction.

## Seventeenth Round Verification

- Overlay task pagination now stores `tasksCursorCreated` and sends `/global/tasks?cursor=<task.time.created>&cursorTaskID=<id>`, matching the sidebar's single `task.time.created` ordering source. `bun test packages/overlay/test/events-refresh.test.ts packages/overlay/test/task-list-pagination.test.ts packages/overlay/test/conversation-agent-rail-records.test.ts packages/overlay/test/status-labels.test.ts --timeout 60000` passed.
- Live conversation-agent `message.part.updated` now rejects display parts that lack top-level `channel/resolvedRole`; tests prove part-local routing metadata is not used as a second source. The conversation rail browser fixture was updated with canonical task/message/part/session order keys and `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts` passed.
- Goal/mission visual fixtures now reject old `/tasks` task-list routes and unmatched Mission visual-loop routes instead of returning empty 200s; `status-labels.test.ts` guards against the old route/time shape and empty-200 default returning.
- Session/MCP/ACP base64 handling now validates raw base64 payloads before attachment persistence or provider/ACP replay. `bun test packages/opencorvus/test/session/text-mime.test.ts packages/opencorvus/test/mcp/materialize-browser-image.test.ts --timeout 60000`, `bun test packages/opencorvus/test/session/message.test.ts --timeout 60000`, `bun test packages/opencorvus/test/session/prompt.test.ts --timeout 60000`, `bun test packages/opencorvus/test/session/prompt-parts-model-resolution.test.ts --timeout 60000`, and `bun test packages/opencorvus/test/acp/event-subscription.test.ts --timeout 60000` passed.
- MCP resources now use URI-derived identity keys and standalone session mirror part updates use part order keys. `bun test packages/opencorvus/test/mcp/prompt-resource-fail-fast.test.ts packages/opencorvus/test/mcp/serve.test.ts --timeout 60000` and `bun test packages/opencorvus/test/protocol/session-mirror.test.ts --timeout 60000` passed.
- Tooling/release fixes were verified by `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/sdk-build-format-contract.test.ts packages/opencorvus/test/script/routes-check-openapi.test.ts --timeout 60000`.
- Type/build/doc verification passed: `bun run --cwd packages/opencorvus typecheck`, `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/overlay check:i18n`, `bun ./packages/sdk/js/script/build.ts`, `bun run ./packages/opencorvus/script/check/routes.ts`, `bun run ./packages/opencorvus/script/docs/render-api-md.ts --check`, and `git diff --check`.
- Browser GUI verification passed: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-list-perf.test.ts`, `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts`, and `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`. Reviewed screenshots: `.scratch/conversation-agent-rail-scroll-browser/rail-after-drag.png`, `.scratch/conversation-agent-rail-scroll-browser/chat-pane-after-locate.png`, `.scratch/conversation-agent-rail-scroll-browser/rail-coding-assistant.png`, `.scratch/task-list-start-now-reload-failure-visible.png`, and `.scratch/task-dirbar-worktree-delete-board-reload-failure-visible.png`.

## Eighteenth Confirmed Residuals

Independent Overlay/GUI audit found five new non-duplicate issue locations after the seventeenth repair batch:

- TaskList search can hide the pagination affordance when the current loaded page has no search matches but later pages may contain them. The load-more control is owned by the non-empty rendered-list branch instead of the task-list pagination state.
- TaskList queue drag reorder can submit only the currently visible queued task IDs when pagination or search hides other queued tasks, while the backend reorder contract requires the complete queued set.
- `task-list-perf.test.ts` still models task-list cursors with `task.time.updated`, so the browser fixture can pass even when production pagination is keyed by `task.time.created`.
- TaskDirBar worktree mutation refresh failures clear the previous worktree list, removing the user's remaining worktree context after the mutation itself succeeded.
- Goal-group visual benchmark still mocks the retired `/task/:id/transcript` path instead of the current `/task/:id/conversation` hydrate contract, so selected-task conversation/agent rail evidence can be missing while the benchmark still produces screenshots.

Independent tooling/docs/test-harness audit found five new non-duplicate issue locations:

- `script/beta.ts` assumes `origin/beta` already exists; first beta publication fails while trying to fetch a missing remote branch instead of creating it with an empty lease.
- Goal-group benchmark lacks a response/error collector and can continue after selected-task hydrate 404s.
- Mission visual loop uses unanchored route regexes for full URLs, allowing wrong paths such as `/global/tasks-extra` to return fixture success.
- Mission visual loop records `pageerror`/`requestfailed` but not console errors or HTTP 4xx/5xx responses into `runtimeFailures`.
- `release-overlay-contract.test.ts` still asserts the retired newline-sensitive `find /tmp/release-assets -type f | sort` contract while the workflow now uses NUL-safe `find -print0 | sort -z`.

Independent backend/runtime audit found five new non-duplicate issue locations:

- `ProviderTransform.message()` still passes malformed non-empty data URL image/file data through because it does not reuse the strict data URL decoders.
- MCP resource keys encode resource URI but still use a lossy sanitized client name prefix, so distinct client names such as `remote/a` and `remote_a` can collide on the same URI.
- MCP tool-result resource items without usable text or blob content are silently skipped and can produce an empty materialized tool output.
- ACP history/live `sessionUpdate()` transmission failures are swallowed with log-only `.catch()` paths, so replay can report success while chunks/tool images never reach the client.
- `prompt_async` and task operator-note responses can return the pre-persistence user parts without backend canonical part `orderKey`, diverging from subsequent session reads.

Call point recall for this repair:

- TaskList pagination/search/reorder: `TaskList.tsx` search signals, `visibleItems()`, grouped queue rendering, drag handlers, `TaskList` load-more button, `loadMoreTasks()`, `/global/tasks` cursor contract, and browser fixtures that paginate task rows.
- Worktree list refresh: `TaskDirBar.tsx` `syncWorktrees()`, worktree delete/cleanup handlers, worktree error rendering, and browser evidence for worktree reload failures.
- Goal/mission visual benchmarks: `goal-group-benchmark.ts` route mocks and selected-task hydrate, `mission-visual-loop.ts` route handler and runtime failure collection, `status-labels.test.ts` source guards, and shared browser error collector contracts.
- Beta/release tooling: `script/beta.ts` remote beta fetch/push lease path, `.github/workflows/build.yml` release asset enumeration, and `release-overlay-contract.test.ts`.
- Provider/MCP/ACP/order-key runtime: `ProviderTransform.message()`, `decodeDataUrlBase64Bytes()`, `fetchResourcesForClient()`, `MCP.resources()`, `materializeMcpToolResult()`, ACP `sessionUpdate()` replay/live paths, `Session.promptAsync()` response shaping, `Session.messages()`, and task operator-note response shaping.

## Deferred Deletion Note

If implementation reveals dead code or obsolete public routes beyond the confirmed fixes above, deletion requires a separate explicit approval under project rule 17. This batch records such code but does not remove it unless the fix itself requires direct replacement.

## Eighteenth Round Verification

- TaskList pagination/search/reorder now keeps the global load-more affordance independent from the filtered row branch and disables queue drag reorder when the global task source is paginated, searched, or externally filtered. `bun test packages/overlay/test/task-list-pagination.test.ts packages/overlay/test/events-refresh.test.ts packages/overlay/test/runtime-directory-actions.test.ts packages/overlay/test/browser-error-collector.test.ts packages/overlay/test/status-labels.test.ts --timeout 60000` passed.
- TaskDirBar worktree delete/cleanup now removes the successfully deleted worktree locally while preserving remaining same-directory worktree rows if the follow-up list refresh fails. `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts` passed, including the new paginated-reorder and worktree-list-refresh cases.
- Browser GUI verification passed with `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-list-perf.test.ts` and `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts`. Reviewed screenshots: `.scratch/task-list-reorder-disabled-paginated-source.png`, `.scratch/task-dirbar-worktree-delete-list-reload-failure-keeps-remaining.png`, and `.scratch/task-list-start-now-reload-failure-visible.png`.
- Goal/mission benchmark fixtures now use `/task/:id/conversation`, collect console/HTTP runtime failures, and avoid full-URL regex route matching. `bun test packages/overlay/test/status-labels.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/release-overlay-contract.test.ts --timeout 60000` passed; `rg -n "\.test\(url\)|/tasks\"|time_created|time_updated|find /tmp/release-assets -type f \| sort" packages/overlay/test/mission-visual-loop.ts packages/overlay/test/goal-group-benchmark.ts .github/workflows/build.yml packages/opencorvus/test/script/release-overlay-contract.test.ts` returned no matches.
- Provider/MCP/ACP/session response fixes passed: `bun test packages/opencorvus/test/provider/transform.test.ts packages/opencorvus/test/mcp/prompt-resource-fail-fast.test.ts packages/opencorvus/test/mcp/materialize-browser-image.test.ts packages/opencorvus/test/mcp/serve.test.ts --timeout 60000`, `bun test packages/opencorvus/test/acp/event-subscription.test.ts packages/opencorvus/test/session/prompt.test.ts packages/opencorvus/test/server/coding-routes.test.ts --timeout 60000`, and `bun test packages/opencorvus/test/server/task-message-routes.test.ts -t "Operator note|task.*message" --timeout 60000` passed.
- Verification exposed one additional stale-cancellation contract drift: cancellation scope was still sealing `streaming` sessions with no live prompt state as terminal aborted. It now reports `TaskCancellationIncompleteError` instead of faking cancellation success. `bun test packages/opencorvus/test/server/session-prompt-async.test.ts packages/opencorvus/test/session/extra-tools.test.ts --timeout 60000` and `bun test packages/opencorvus/test/task-api/cancel-task-abort-timeout.test.ts packages/opencorvus/test/task-api/delete-running-task-settle.test.ts packages/opencorvus/test/task-api/delete-session-delete-tasks-settle.test.ts --timeout 60000` passed.
- Tool/build checks passed: `bun run --cwd packages/opencorvus typecheck`, `bun run --cwd packages/overlay typecheck`, `bun run --cwd packages/overlay check:i18n`, `bun ./packages/sdk/js/script/build.ts`, `bun run ./packages/opencorvus/script/check/routes.ts`, `bun run ./packages/opencorvus/script/docs/render-api-md.ts --check`, and `git diff --check`.

## Nineteenth Confirmed Residuals

Independent Overlay/GUI audit found six new non-duplicate issue locations after the eighteenth repair batch:

- TaskList queue badges are computed from `sortedItems()`, which is already search-filtered. Searching for a queued task can renumber a real global queue item as `Queued #1` instead of preserving the backend queue position.
- TaskDirBar `syncWorktrees()` writes successful worktree responses without rechecking that `dir()` still matches the requested directory, so a slow response from project A can overwrite project B after the operator switches directories.
- Goal-group benchmark returns display-bearing `transcript` messages through `/task/:id/conversation` while leaving `view.messages` and `agentView.messages` empty, so it can miss the current conversation hydrate/card-tree contract.
- Mission visual-loop has the same selected-session hydrate drift: a display text transcript is returned without matching `view.messages` metadata.
- Goal-group benchmark collects console/pageerror/HTTP failures but not `requestfailed`, so a network failure can leave missing visual evidence while `runtimeFailures` remains empty.
- `task-list-perf.test.ts` returns `{ worktrees: [] }` for `/project/current/worktrees` even though `loadProjectWorktrees()` requires the response body itself to be an array, weakening background TaskDirBar evidence.

Independent tooling/docs/test-harness audit found five new non-duplicate issue locations:

- `script/beta.ts` force-updates PR and beta refs but not `origin/dev`; a force-pushed `dev` can make beta publication fail before any PR merge.
- `script/check-release-assets.ts` validates overlay binary names with platform-agnostic `opencorvus-overlay(.exe)?`, letting Linux/macOS accept a Windows `.exe` and Windows accept an extensionless binary.
- `script/check-release-assets.ts` only checks release bundle version names on Windows; Linux/macOS AppImage, deb, dmg, and app tarball checks can accept stale-version bundles.
- Goal-group benchmark view metadata drift overlaps the Overlay audit and must be fixed in the shared fixture payload rather than accepted as a benchmark variance.
- Mission visual-loop mocks `POST /mission/wake` but only fills the launcher textarea; it never submits the launcher or asserts the wake POST and follow-up conversation hydrate occurred.

Independent backend/runtime audit found four new non-duplicate issue locations:

- `ProviderTransform` validates `data:` file URLs, but a non-URL/non-attachment `file.data` string can still be raw AI SDK base64. Malformed raw base64 must fail locally; valid raw base64 and HTTPS URL behavior must stay explicit.
- Task creation and task operator-message attachments decode upload `data` with raw `Buffer.from(..., "base64")`, which can persist corrupt bytes before the agent wakes.
- Task operator-message responses return `user_message.info` without canonical message-level `orderKey`, so synchronous overlay ingestion can throw before enriched SSE arrives.
- Stale running queue recovery marks the queue row failed before proving the backing `SessionPrompt` was cancelled; active status with no cancellable prompt must surface `TaskCancellationIncompleteError` and leave the queue row non-terminal.

Call point recall for this repair:

- TaskList queue position: `TaskList.tsx` `queuePositions`, `sortTaskItemsByCreated()`, search filtering, grouped project rendering, and `TaskRow` queue badge props.
- Worktree stale response handling: `TaskDirBar.tsx` `syncWorktrees()`, `worktreeDirectory`, dropdown open effect, directory switch actions, `loadProjectWorktrees()`, and worktree browser fixtures.
- Conversation hydrate fixtures: `goal-group-benchmark.ts` transcript generation, `/task/:id/conversation` response, `view.messages`, `agentView.messages`, `hydrateConversationView` / tree-writer display metadata requirements, `mission-visual-loop.ts` selected session conversation fixture, and runtime failure collectors.
- Mission launcher evidence: Mission composer textarea, `POST /mission/wake`, selected mission row hydrate, runtime request accounting, and `summary.json` state capture.
- Release/beta tooling: `script/beta.ts` dev/PR/beta ref fetches, `script/check-release-assets.ts` platform asset kind checks, release workflow asset naming, and `document-health.test.ts` / release asset checker tests.
- Backend attachment/order/cancel contracts: `ProviderTransform.inlineLocalFilePart()`, `decodeRawBase64Payload()`, create-task attachment materialization, task-message attachment materialization, `appendTaskSessionMessage()`, `Session.updateMessage()` / `Session.persistMessage()`, overlay `ingestPersistedConversationMessage()`, `TaskQueueService.recover()`, and `cancelSessionPromptInScope()`.

## Nineteenth Round Repair And Verification

- TaskList queue positions now come from the full loaded task source rather than the search-filtered render source. Browser coverage searches for `task-perf-280` after loading two pages and proves the visible row still shows the global `Queued #20` badge.
- Visual review exposed that the queue badge text existed only in DOM and was clipped by `.task-row-badge-text`. The queued compact row chip now expands to a readable status label, and the browser test asserts the badge text has visible width instead of only asserting textContent.
- TaskDirBar worktree loading now ignores successful responses whose requested directory no longer matches `dir()`. Browser coverage delays project A's worktree response, switches to project B, releases A, and saves `.scratch/task-dirbar-worktree-stale-response-ignored.png`; reviewed screenshot shows only `current-b`.
- The TaskDirBar browser fixture now models task-event SSE as a persistent stream, and the file-level error collector allows only exact `net::ERR_ABORTED` lifecycle aborts for `/task/events` and `/task/:id/events`. Other page errors, HTTP errors, and request failures still fail the suite.
- Goal-group and mission visual fixtures now return populated `view` / `agentView` metadata for displayed transcript messages, collect `requestfailed`, and assert mission launcher submit plus follow-up conversation hydrate.
- Release/beta tooling now force-updates `origin/dev`, validates overlay executables per platform, and checks Linux/macOS bundle versions in addition to Windows bundle names.
- Provider, task-create, and task-message attachment paths now use strict raw base64 decoding before persistence; malformed uploads fail before writing attachments or waking task execution.
- Task operator-message responses now return canonical persisted message `orderKey`, and session persistence rejects supplied message order-key drift.
- Stale running queue recovery now proves the backing session prompt was cancelled before marking the queue row failed; incomplete cancellation leaves the row non-terminal and surfaces the cancellation error.
- Verification exposed and fixed a test isolation error in `task-create-route.test.ts`: malformed attachment coverage now asserts no task with the request's `requestID` was created instead of assuming the whole task table is empty.

Verification commands passed:

- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-list-perf.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun test packages/overlay/test/status-labels.test.ts packages/overlay/test/board-projection-sync.test.ts packages/overlay/test/conversation-replay-errors.test.ts packages/overlay/test/sse-reconnect.test.ts packages/overlay/test/browser-error-collector.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/provider/transform.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/server/task-create-route.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/server/task-message-routes.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/scheduler/task-queue-service.test.ts --timeout 60000`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/check-release-assets.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 60000`
- `bun run ./packages/opencorvus/script/check/routes.ts`
- `bun run ./packages/opencorvus/script/docs/render-api-md.ts --check`
- `bun ./packages/sdk/js/script/build.ts`
- `git diff --check`

Reviewed visual evidence:

- `.scratch/task-list-search-preserves-global-queue-badge.png` shows the search-filtered row with readable `Queued #20` and no runtime error toast.
- `.scratch/task-dirbar-worktree-stale-response-ignored.png` shows the worktree dropdown still bound to the current directory after the stale response is released.

## Twentieth Confirmed Residuals

Independent Overlay/GUI audit found four new non-duplicate issue locations after the nineteenth repair batch:

- TaskList queue badges and drag reorder still derive the queued order from creation-time/render order rather than the backend queue order. When `task.queue.order`, priority, and `task.time.created` diverge, `Queued #N` and drag payloads can use the wrong baseline.
- TaskDirBar `syncWorktrees()` ignores stale successful responses, but the catch path can still write a stale error or clear rows after switching directories.
- `task-list-perf.test.ts` allows any request failure on task event streams, not only lifecycle `net::ERR_ABORTED`, so real network failures can be hidden.
- `task-list-perf.test.ts` reuses a creation-time pagination helper for Mission updated-time pagination and never clicks Mission load-more, so Mission pagination evidence is false-green.

Independent backend/runtime audit found four new non-duplicate issue locations:

- `TaskQueueService.recover()` cancels a stale session prompt and immediately marks the row failed without waiting for the prompt state to finish observing cancellation.
- `POST /task` decodes attachments after creating the root session and writing session metadata/profile overlay, so malformed base64 can leave orphan session side effects even when no task is created.
- `POST /task/:taskID/message` applies `promptProfile` before decoding attachments, so malformed base64 can mutate session config even though the request is rejected.
- The `task.message` OpenAPI / SDK response schema still exposes `user_message.info` and `parts` as `z.any()`, so the newly required canonical `orderKey` contract is not enforceable by generated clients.

Independent tooling/docs/test-harness audit found three new non-duplicate issue locations:

- `script/check-release-assets.ts` validates bundle version and extension but not platform architecture suffix, so same-version wrong-architecture bundles can pass.
- `.github/workflows/build.yml` hides release-branch overlay artifact copy and cleanup failures with `|| true`, so release branch publishing can succeed with missing or stale overlay artifacts.
- `packages/opencorvus/script/benchmark/audit-calculator.ts` uses a fixed wall-clock `setTimeout` from process start instead of an inactivity timeout reset by stdout/stderr activity.

Call point recall for this repair:

- Queue order: overlay `TaskList.tsx` `queuePositions()`, `queuedItems()`, `handleDrop()`, browser `task-list-perf.test.ts`, backend queue ordering in task list routes, and any shared status/source guard that can prevent creation-time drift.
- Worktree stale errors: `TaskDirBar.tsx` `syncWorktrees()` success and catch paths, directory switching via `applyDirectory()`, and browser worktree stale success/failure cases.
- Browser evidence strictness: `task-list-perf.test.ts` request failure allow rules, Mission ledger pagination/load-more controls, and shared browser error collector guard tests.
- Task side-effect order: `task-api/index.ts` create-task route, task-message route, attachment decoding/materialization, `Session.create()`, `Session.mergeConfigOverlay()`, `AttachmentStore.write()`, and route tests that inspect SessionTable / session metadata.
- Prompt cancellation completion: `TaskQueueService.recover()`, `cancelSessionPromptInScope()`, `SessionPromptState.cancel()`, prompt finished wait helpers, recovery timers, and scheduler tests with real active prompt state.
- API schema: `Engine.TaskMessageResult`, route response schemas, generated `packages/sdk/openapi.json`, generated JS SDK types, and SDK/schema contract tests.
- Release/test tooling: `script/check-release-assets.ts`, release asset tests, `.github/workflows/build.yml` release branch assembly, document-health workflow guards, and `audit-calculator.ts` benchmark process runner.

## Twentieth Round Repair And Verification

- TaskList queue position now sorts loaded queued tasks by backend queue semantics: priority, `queue.order`, creation time, then task id. The search evidence targets `task-perf-290` and verifies the visible chip remains `Queued #11` instead of being renumbered by the filtered render list.
- TaskDirBar `syncWorktrees()` now ignores stale failed responses as well as stale successful responses. Browser coverage delays a failed response from the previous directory and verifies the current directory worktree list remains bound to `current-b`.
- TaskList browser evidence now allows task-event request failure only for exact `net::ERR_ABORTED`, uses mission `updated` cursors, and clicks the Mission load-more control so pagination evidence is real.
- `TaskQueueService.recover()` now waits for prompt state cancellation to finish before terminalizing stale running rows. The stale active prompt test proves an unfinished prompt leaves the queue row non-terminal and surfaces the cancellation-completion error.
- Task creation and task operator-message routes now decode all uploaded base64 attachments before creating sessions, writing profile overlays, writing attachments, or waking task execution. Failure-path tests prove malformed attachments do not create orphan root sessions, write task rows, write attachments, persist message parts, dispatch wakes, or mutate prompt profile config.
- `TaskMessageResult` now exposes typed persisted user-message info and parts with required `orderKey`, and the generated OpenAPI/SDK types no longer publish `info: unknown` / `Array<unknown>` for `task.message`.
- Release asset validation now checks platform architecture suffixes for macOS, Linux, and Windows bundles. Same-version wrong-architecture bundles fail, while the Linux arm64 naming contract is covered.
- The release branch workflow no longer hides release-tree cleanup, required document copy, executable chmod, ripgrep chmod, or overlay artifact copy failures behind `|| true`; missing inputs now fail with explicit diagnostics.
- `audit-calculator.ts` command execution now uses an inactivity timeout reset by stdout, stderr, and spawn activity instead of a fixed wall-clock timeout from process start.

Verification commands passed:

- `bun test packages/opencorvus/test/server/task-create-route.test.ts packages/opencorvus/test/server/task-message-routes.test.ts -t "malformed attachment|Operator note|attachment|prompt profile" --timeout 60000`
- `bun test packages/opencorvus/test/scheduler/task-queue-service.test.ts -t "stale running recovery|recovery uses time_updated|message part delta heartbeat|publishes session error" --timeout 60000`
- `bun test packages/opencorvus/test/script/check-release-assets.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/benchmark/audit-calculator.test.ts --timeout 60000`
- `bun run --cwd packages/opencorvus typecheck`
- `bun ./packages/sdk/js/script/build.ts`
- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts --timeout 60000`
- `bun run ./packages/opencorvus/script/check/routes.ts`
- `bun run ./packages/opencorvus/script/docs/render-api-md.ts --check`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun test packages/overlay/test/status-labels.test.ts packages/overlay/test/browser-error-collector.test.ts --timeout 60000`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-list-perf.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-dirbar-keyboard.test.ts`
- `git diff --check`

Reviewed visual evidence:

- `.scratch/task-list-search-preserves-global-queue-badge.png` shows `task-perf-290` with a readable `Queued #11` chip after search filtering.
- `.scratch/task-dirbar-worktree-stale-failure-ignored.png` shows the worktree panel still bound to current directory `current-b` after a stale failed response from the previous directory.
- `.scratch/task-dirbar-worktree-stale-response-ignored.png` still shows the stale successful response case bound to current directory `current-b`.

## Twenty-First Confirmed Residuals

Independent Overlay/GUI audit found three new non-duplicate issue locations after the twentieth repair batch:

- TaskDirBar worktree delete and expired-cleanup actions read live `dir()` after an async confirmation, so an action opened for project A can execute against project B if the active directory changes before confirmation resolves.
- TaskList queue badges still present a loaded-window ordinal as an absolute-looking `Queued #N` when the global task list is paginated. Drag reorder is disabled while `tasksHasMore`, but badge numbering still implies a global rank that the loaded GUI source cannot prove.
- Mission load-more responses can append stale rows after the search, refresh, or activity source changes because `handleMissionLoadMore()` mutates the resource with captured `current`/`cursor`/`search` without rechecking the current source.

Independent tooling/docs/test-harness audit found five new non-duplicate issue locations:

- Release upload asset names include downloaded artifact directory prefixes such as `opencorvus-dist-linux-x64__opencorvus-linux-x64.tar.gz`, while the installer downloads bare names such as `opencorvus-linux-x64.tar.gz`.
- macOS overlay staging tars app bundles as `OpenCorvus.app.tar.gz`, while release validation requires the versioned architecture name `OpenCorvus_<version>_<arch>.app.tar.gz`.
- The generate workflow can run broad formatting, then unstage `.github/workflows` before committing generated artifacts, leaving workflow drift uncommitted in an otherwise green automation commit.
- `audit-calculator.ts` collects browser `pageerror` and console errors but not HTTP 4xx/5xx responses or `requestfailed`, so broken subresources can leave missing visual evidence while the audit still passes.
- `audit-calculator.ts` preview startup still uses a fixed 30-second wall-clock deadline instead of an inactivity deadline reset by stdout/stderr activity and reachability checks.

Independent backend/runtime audit found five new non-duplicate issue locations:

- Malformed `POST /task` attachments can still initialize a missing project directory and enter `Instance.provide()` before body validation and strict attachment decode reject the request.
- Timer-driven stale queue recovery logs incomplete prompt cancellation but does not publish a visible error or re-arm recovery, leaving the queue row `running`.
- `cancelTask()` / `deleteSession()` can mark task-owned running queue rows failed before cancellation completion is proven; if later proof fails, task/session state and queue state diverge.
- Direct agent replies can persist arbitrary or dangling file URLs into session history because `AgentSessionReplyInput` accepts `{ mime, url }` and writes file parts directly without AttachmentStore validation/materialization.
- `/mission/wake` returns runtime `400 { error }` for unknown prompt profiles, but OpenAPI/SDK declare only `200`.

Call point recall for this repair:

- Worktree action ownership: `TaskDirBar.tsx` `removeWorktree()`, `cleanupExpiredWorktrees()`, `worktreeDirectory()`, `dir()`, `deleteProjectWorktree()`, `deleteProjectWorktrees()`, directory-switch helpers, and TaskDirBar browser fixtures for delayed dialogs and worktree mutation requests.
- Queue badge authority: `TaskList.tsx` `queuePositions()`, `TaskRow` badge rendering, `boardStore.tasksHasMore`, `loadTasks()` pagination, `/global/tasks` cursor semantics, and TaskList perf/browser evidence.
- Mission stale pagination: `Mission.tsx` resource source, `handleMissionLoadMore()`, `missionRecordsCtl.mutate()`, `searchQuery`, refresh/activation tokens, `loadMissions()`, and Mission browser fixture pagination/search routes.
- Release asset naming: `.github/workflows/build.yml` Stage overlay artifacts and Upload release assets steps, root `install`, CLI archive names, overlay artifact directory names, release overlay contract tests, and install script URL tests.
- Generate workflow drift: `.github/workflows/generate.yml`, `script/generate.ts`, `script/format.ts`, generated docs/SDK outputs, and document-health source guards.
- Audit calculator browser harness: `audit-calculator.ts` preview startup, browser event collection, screenshot/report writing, inactivity timeout semantics, and benchmark source/behavior tests.
- Task creation ingress: `server/server.ts` task-create middleware, `prepareTaskCreateDirectory()`, `Instance.provide()`, `EngineService.createTask()`, `CreateTaskInput`, attachment strict decode, and task-create route tests against missing directories.
- Queue cancellation terminalization: `TaskQueueService.cancelSessionPrompts()`, `recover()`, `scheduleRecovery()`, `cancelTask()`, `deleteSession()` paths, `SessionPromptState`, `TaskCancellationIncompleteError`, and scheduler/task-api cancellation tests.
- Direct agent reply attachments: `AgentSessionReplyInput`, `appendDirectAgentSessionReply()`, `AttachmentStore`, `Session.persistMessage()`, direct-reply tests, and persisted message replay paths.
- Mission wake contract: `routes/mission.ts` `POST /mission/wake`, `PromptProfile.assertKnownProfileID()`, route error schemas, generated OpenAPI/SDK, and mission route/SDK contract tests.

## Twenty-First Round Repair And Verification

- TaskDirBar worktree delete and expired-cleanup confirmations now capture the originating project directory before the async confirmation and re-check both `dir()` and `worktreeDirectory()` before executing the mutation. Browser coverage proves stale confirmations opened for project A do not delete or clean project B after the active directory changes.
- TaskList queue badges now stop presenting a loaded-window rank as an absolute queue rank when the task source is paginated, searched, or externally filtered. Filtered/paginated rows display `Queued` without an unproven `#N`.
- Mission load-more now captures the active record source and ignores stale responses when search, refresh, activity, or resource source changes before the response mutates the record list.
- Release upload names now preserve bare CLI archive names for installer compatibility, and macOS app bundle staging emits versioned architecture names that match release validation.
- The generate workflow now fails when generated workflow files drift instead of formatting and unstaging `.github/workflows`.
- `audit-calculator.ts` now treats preview startup as an inactivity deadline reset by stdout, stderr, and real HTTP reachability, and browser collection records HTTP 4xx/5xx responses plus request failures.
- `POST /task` validates and strictly decodes attachments before preparing missing project directories or entering `Instance.provide()`.
- Timer-driven stale queue recovery now publishes a visible session error and re-arms the running row if cancellation proof fails.
- Task-owned running queue cancellation now requests cancellation for in-flight prompts but only terminalizes the queue row after the prompt path observes cancellation; the cancellation API return value still counts the in-flight cancellation request.
- Direct agent replies now validate attachment URLs against `AttachmentStore`, reject invalid/wrong-project/missing references with `AgentSessionAttachmentReferenceError`, and rematerialize accepted attachments into the target project before persisting reply parts.
- `/mission/wake` now documents and returns the route-standard 400 error envelope for unknown prompt profiles.
- Mission deletion now removes the target session from the row-owned project via `Session.removeInProject()` when global ledger project identity drift is present.
- AgentSessionReplyBox now recognizes `AgentSessionAttachmentReferenceError`, shows localized attachment-reference copy, and keeps the reply box retryable with the draft message preserved.

Verification commands passed:

- `bun test packages/opencorvus/test/task-api/delete-running-task-settle.test.ts packages/opencorvus/test/scheduler/task-queue-service.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/server/task-create-route.test.ts packages/opencorvus/test/server/reply-error-taxonomy.test.ts packages/opencorvus/test/server/mission-routes.test.ts packages/opencorvus/test/server/app-routes.test.ts --timeout 60000`
- `bun ./packages/sdk/js/script/build.ts`
- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts --timeout 60000`
- `bun run ./packages/opencorvus/script/check/routes.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run ./packages/opencorvus/script/docs/render-api-md.ts --check`
- `bun test packages/opencorvus/test/script/release-overlay-contract.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/benchmark/audit-calculator.test.ts --timeout 60000`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun test packages/overlay/test/status-labels.test.ts packages/overlay/test/browser-error-collector.test.ts packages/overlay/test/agent-reply-box-structured-errors.test.ts --timeout 60000`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-list-perf.test.ts packages/overlay/test/browser/task-dirbar-keyboard.test.ts packages/overlay/test/browser/agent-reply-box-primitives.test.ts`
- `git diff --check`

Reviewed visual evidence:

- `.scratch/task-list-search-preserves-global-queue-badge.png` shows `task-perf-290` with the non-ordinal `Queued` chip under a searched, paginated task source.
- `.scratch/task-dirbar-worktree-delete-confirmation-directory-switch.png` shows stale delete confirmation preserving the current directory's `current-b` worktree.
- `.scratch/task-dirbar-worktree-cleanup-confirmation-directory-switch.png` shows stale cleanup confirmation preserving the current directory's `current-b` worktree.
- `.scratch/agent-reply-box-attachment-reference-error.png` shows the attachment-reference diagnostic fitting inside the reply box error band with the dismiss icon contained.

## Twenty-Second Confirmed Residuals

Independent Overlay/GUI audit found three new non-duplicate issue locations after the twenty-first repair batch:

- TaskDirBar worktree delete and expired-cleanup actions re-check ownership before starting mutation, but a directory switch while the DELETE request is in flight can still let the completed project A operation mutate the visible project B panel or reload B's board.
- Mission load-more stale-source protection covers search/refresh/activity changes, but same-source list mutations from delete/rename/refetch do not advance a revision; a delayed load-more can merge captured pre-delete rows back into the Mission list.
- The attachment-reference reply-box screenshot renders hand-written static HTML rather than the real `AgentSessionReplyBox` submit/error path, so it can pass if the component stops reading `ApiError.body.name`, clears the draft on failure, or fails to render the localized error.

Independent tooling/docs/test-harness audit found five new non-duplicate issue locations:

- Release upload walks the whole downloaded artifact tree. Internal overlay executable files can be uploaded or collide under flattened names instead of staging only the exact installer-compatible CLI archives and intended overlay bundles.
- Generate automation still couples generated artifacts with whole-repo `prettier --write .`; it can commit unrelated formatter drift while only checking `.github/workflows` drift explicitly.
- `audit-calculator.ts` preview startup reachability probes have no per-probe abort/deadline, so a server that accepts a connection but never responds can hang inside `fetch()` beyond the inactivity budget.
- `audit-calculator.ts` theme requirements can pass from source/docs text because `R10-toggle`, `R10-storage`, and `R10-dark-default` use `codeBundle` regexes instead of proving rendered toggle behavior and persistence.
- `review-deliverable.ts` logs console/page diagnostics and HTTP status but exits green; request failures are not collected, so self-review screenshots can hide broken rendered pages.

Independent backend/runtime audit found two new non-duplicate issue locations:

- Project-scoped task/session routes validate task-session relationship but not active project ownership. With project B active, known project A IDs can drive direct reply, direct-child cancellation, transcript, or operator model context reads.
- Direct reply attachment materialization validates URL readability but still uses request-supplied `mime` and `filename` for rematerialization, leaving metadata as a second source of truth for stored attachment bytes.

Call point recall for this repair:

- Worktree post-await ownership: `TaskDirBar.tsx` `removeWorktree()`, `cleanupExpiredWorktrees()`, `syncWorktrees({ requireFresh })`, `loadBoard({ requireFresh })`, delete/cleanup browser fixtures, delayed DELETE handlers, and current-directory switch helpers.
- Mission same-source revision: `Mission.tsx` `missionRecordSource()`, `missionSourceMatches()`, `handleMissionLoadMore()`, `refetch()`, delete/rename handlers, `missionRecordsCtl.mutate()`, Mission row browser fixture, and Mission search/load-more evidence in `task-list-perf.test.ts`.
- Reply-box real component path: `AgentSessionReplyBox.tsx` `pickErrorInfo()`, `messageForError()`, actual `submit()`, `AutoGrowTextarea`, `Button`, i18n keys, `ApiError` shape, static primitive browser fixture, and structured-error source tests.
- Release upload allowlist: `.github/workflows/build.yml` artifact download paths, CLI archive names expected by `install`, overlay bundle names validated by `script/check-release-assets.ts`, release upload flattening, `release-overlay-contract.test.ts`, and any installer URL tests.
- Generate artifact boundary: `script/generate.ts`, `script/format.ts`, `.github/workflows/generate.yml`, SDK generation, API docs generation, OpenAPI generated files, route-check tests, document-health guards, and workflow commit staging.
- Benchmark/self-review: `audit-calculator.ts` preview startup loop, browser runtime failure collection, theme verdict checks, `review-deliverable.ts`, benchmark tests, and browser collector contracts.
- Project ownership: `resolveDirectReplyTarget()`, `assertDirectAgentSession()`, `taskSessionIDs()`, `getTaskOperatorModelContext()`, `requireTaskInCurrentProject()`, direct-reply/cancel/transcript/operator routes, and two-project route tests using directory headers.
- Attachment metadata source: `AgentSessionReplyInput`, `AttachmentStore.nameFromUrl()`, `AttachmentStore.read()`, `AttachmentStore.write()`, stored attachment metadata accessors, direct-reply materialization, and persisted message file-part replay tests.

## Twenty-Second Round Repair And Verification

- TaskDirBar worktree delete and expired-cleanup flows now re-check operation ownership after the awaited DELETE returns, after local list mutation, after fresh worktree sync, and after selected-board reload. Browser coverage holds the DELETE request open, switches the active directory to project B, releases project A's operation, and proves project B's visible panel is not mutated or reloaded by project A completion.
- Mission records now include a mutation revision in the resource source. Delete, rename, abort-local mutate, and refetch-changing paths advance the revision so delayed same-source load-more responses cannot merge captured pre-mutation rows back into the current Mission list.
- `agent-reply-box-primitives.test.ts` now renders the real built overlay page and actual `AgentSessionReplyBox` path through `Conversation` / `ChatBubble`, posts to `/task/:taskID/session/:sessionID/reply`, receives a structured `AgentSessionAttachmentReferenceError`, and proves `ApiError.body.name` drives the localized visible error while the draft remains retryable. The earlier hand-written static HTML fixture was removed.
- Release asset upload staging now uses `script/stage-release-upload-assets.ts` as the single source for release-upload allowlisting. It stages only installer-compatible `opencorvus-*` CLI archives and intended `OpenCorvus*` overlay bundles, ignores internal downloaded executables such as `opencorvus-overlay`, preserves bare asset names, and rejects duplicate staged names.
- Generate automation now runs Prettier only over declared generated SDK/OpenAPI/API-doc paths after SDK and docs generation. The generate workflow checks every worktree change against the generated artifact allowlist before staging and only stages those paths, so unrelated formatter drift cannot be committed by automation.
- `audit-calculator.ts` preview reachability now wraps each `fetch()` probe with `AbortController`, so a server that accepts a connection but never responds cannot outlive the inactivity budget. R10 theme verdicts now inspect the rendered DOM, click the real toggle, and verify `localStorage` persistence instead of passing from source/docs text.
- `review-deliverable.ts` now collects HTTP 4xx/5xx responses and `requestfailed` events, treats navigation HTTP failure as a runtime/network error, and throws after screenshot capture when runtime/network diagnostics are present.
- Record-level task/session routes now enforce active project ownership for direct reply, direct-child cancellation, transcript/session-history helpers, and operator model context reads. The route middleware also provides selected-directory `Instance` context to non-directory-required record routes when the caller supplies a directory header/query.
- Direct reply attachment rematerialization now reads canonical metadata from `AttachmentStore` sidecars. The route rejects request `mime`/`filename` drift with `AgentSessionAttachmentReferenceError` and rematerializes using stored metadata only; attachment sweep deletes sidecars with orphan blobs.

Verification commands passed:

- `bun test packages/opencorvus/test/script/release-overlay-contract.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/routes-check-openapi.test.ts packages/opencorvus/test/server/session-config-routes.test.ts packages/opencorvus/test/benchmark/audit-calculator.test.ts --timeout 60000`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/agent-reply-box-primitives.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-list-perf.test.ts packages/overlay/test/browser/task-dirbar-keyboard.test.ts packages/overlay/test/browser/agent-reply-box-primitives.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun test packages/opencorvus/test/storage/attachment-write-from-path.test.ts packages/opencorvus/test/storage/attachment-store-sweep.test.ts packages/opencorvus/test/server/reply-error-taxonomy.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts -t "project-scoped transcript|session/:sessionID/cancel" --timeout 60000`
- `bun test packages/opencorvus/test/server/task-message-routes.test.ts -t "operator-model-context" --timeout 60000`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run ./packages/opencorvus/script/check/routes.ts`
- `bun ./packages/sdk/js/script/build.ts`
- `bun run ./packages/opencorvus/script/docs/render-api-md.ts --check`
- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts --timeout 60000`
- `git diff --check`

Reviewed visual evidence:

- `.scratch/task-list-search-preserves-global-queue-badge.png` still shows the searched paginated task row with a readable non-ordinal `Queued` chip.
- `.scratch/task-dirbar-worktree-delete-inflight-directory-switch.png` shows project B's `current-b` worktree after project A delete completion is released.
- `.scratch/task-dirbar-worktree-cleanup-inflight-directory-switch.png` shows project B's `current-b` worktree after project A expired-cleanup completion is released.
- `.scratch/agent-reply-box-attachment-reference-error.png` now comes from the real overlay `AgentSessionReplyBox` submit/error path and shows the localized attachment-reference diagnostic with the dismiss icon contained.

## Twenty-Third Confirmed Residuals

Independent Overlay/GUI audit found three new non-duplicate issue locations after the twenty-second repair batch:

- FileExplorer dialog actions capture relative paths but not the originating project directory. If a create/rename/move/delete dialog opens for project A, then the active directory switches to project B before confirmation, the file API client can inject B's current directory for an action initiated in A.
- Mission delete closes the selected Mission conversation before the durable `DELETE /mission/:id` succeeds. A failed delete can leave the row visible while the center session has already been closed.
- TaskDirBar expired-worktree cleanup busy state is global. A stale in-flight cleanup for project A can disable project B's cleanup/remove controls after switching directories, even though post-await mutation guards prevent A completion from mutating B.

Independent tooling/release/test-harness audit found five new non-duplicate issue locations:

- `stage-release-upload-assets.ts` accepts any semver-looking overlay bundle from downloaded artifacts. Stale or wrong-platform overlay bundles copied from Tauri's bundle directory can be uploaded alongside current release assets.
- Generated artifact paths remain duplicated between `script/generate.ts` and `.github/workflows/generate.yml`, and typecheck CI does not verify generated API docs drift.
- `audit-calculator.ts` still lets non-theme requirements such as history and pressed-state evidence pass from README/dead-source regex matches instead of rendered interaction behavior.
- `audit-calculator.ts` preview boot can attach to an unrelated server that already answers `200` on the random port if Vite fails under `--strictPort`.
- `audit-calculator.ts` and `review-deliverable.ts` browser navigation still rely on Playwright wall-clock `timeout` values rather than no-activity deadlines reset by browser activity.

Independent backend/runtime audit found three new non-duplicate issue locations:

- `GET /task/:taskID/project-archive` can export a foreign project's task archive when the caller supplies project A's task ID while project B is active.
- Rewind routes can mutate a foreign project task's rewind cursor and, with `resetWorktree=true`, reset/remove project A goal worktrees while project B is active.
- Task attachment and system-artifact registration validate URL readability but still trust caller-supplied `mime`, `filename`, `sha`, and `size` instead of canonical `AttachmentStore` sidecar metadata.

Call point recall for this repair:

- FileExplorer ownership: `FileExplorerPanel.tsx` create/rename/move/delete handlers, dialog confirmation order, `file-workbench.ts` `createFile()` / `renameFile()` / `deleteFile()` / `uploadFiles()` service calls, `api.ts` directory injection, `activeProjectDirectory()`, FileExplorer browser fixtures, and directory-switch helpers.
- Mission delete failure: `Mission.tsx` `handleMissionDelete()`, `handleCloseMission()`, `deleteMission()`, `withBusy()`, selected Mission session source, action error rendering, and Mission browser/side-activity tests.
- TaskDirBar busy ownership: `TaskDirBar.tsx` `cleanupExpiredBusy`, `deletingWorktrees`, `canCleanupExpired`, remove-button disabled state, captured `projectDirectory`, delayed DELETE browser fixtures, and current-directory switch tests.
- Release staging authority: `script/stage-release-upload-assets.ts`, `.github/workflows/build.yml` publish-release-assets step, downloaded artifact directory names (`opencorvus-dist-*`, `overlay-*`), installer CLI archive names, overlay bundle version/architecture names, `check-release-assets.ts`, and release overlay contract tests.
- Generated artifact authority: `script/generate.ts`, `.github/workflows/generate.yml`, `.github/workflows/typecheck.yml`, SDK/OpenAPI generation, API docs renderer, route/doc checks, and document-health/source contract tests.
- Calculator rendered evidence and browser timeouts: `audit-calculator.ts` `codeBundle`, R6/R8/R10 checks, preview startup port/probe loop, Playwright navigation/reload calls, `review-deliverable.ts`, benchmark tests, and browser error collector contracts.
- Project archive ownership: `server/routes/orchestrator.ts` project archive route, `engine/task-project-archive.ts` `buildTaskProjectArchive()`, `requireTask()`, `loadFullTaskTranscript()`, `Project.get()`, route directory middleware, and task archive route tests.
- Rewind ownership: `server/routes/orchestrator.ts` rewind routes, `engine/rewind.ts` `rewindTask()` / `clearRewindCursor()`, `findTask()`, goal-run/worktree reset helpers, route directory context, and rewind engine/route tests.
- Task attachment metadata authority: `task-api/index.ts` `appendTaskAttachment()`, `appendTaskSystemArtifact()`, `mergeTaskFileRef()`, `AttachmentStore.readReference()`, `AttachmentStore.nameFromUrl()`, task attachment storage/replay tests, and wrong-project reference tests.

## Twenty-Third Round Repair And Verification

- FileExplorer file mutations now carry an explicit `FileOperationScope` from the originating directory through create, rename, move, delete, and upload service calls. Dialog confirmations capture the initiating directory and refuse to mutate a newly active project after a directory switch.
- Mission delete now closes the selected Mission conversation only after the durable `DELETE /mission/:id` succeeds. Failed deletes keep the selected Mission session and row active, with the error visible in the Mission panel.
- TaskDirBar expired-worktree cleanup busy state is scoped to the cleanup operation directory, so a stale cleanup for project A no longer disables project B cleanup/remove controls after switching directories.
- Release upload staging now derives overlay bundle eligibility from `script/release-asset-contract.ts`, requires the active release version, and rejects stale or wrong-platform overlay bundle names instead of accepting any semver-looking bundle.
- Generated artifact paths now come from `script/generated-artifacts.ts`; `script/generate.ts` and the generate workflow share that source, the workflow rejects non-generated drift, and typecheck CI verifies generated API docs drift.
- `audit-calculator.ts` now checks history and pressed-state evidence through rendered browser interactions, verifies preview reachability against the Vite strict-port log before attaching, and uses browser no-activity navigation helpers shared with `review-deliverable.ts`.
- Project archive and rewind routes now enforce active-project task ownership before exporting archives or mutating rewind cursors/worktrees.
- Task attachment and system-artifact registration now read canonical attachment sidecar metadata and reject caller metadata drift for `sha`, `mime`, `size`, and `filename`; caller `intent` and `source` remain semantic metadata only.
- Side activity browser fixtures were updated to emit persisted user messages with the current strict timeline `orderKey` contract, preventing tests from hiding real `message.updated ... missing orderKey` product errors.

Verification commands passed:

- `bun test packages/opencorvus/test/script/release-overlay-contract.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/benchmark/audit-calculator.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/server/task-project-archive.test.ts packages/opencorvus/test/storage/attachment-project-isolation.test.ts --timeout 60000`
- `bun test packages/overlay/test/file-explorer-editor.test.ts packages/overlay/test/task-cwd-row-layout.test.ts --timeout 60000`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/file-explorer-search-error.test.ts packages/overlay/test/browser/side-activity-toolbar-browser.test.ts packages/overlay/test/browser/task-dirbar-keyboard.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`

Reviewed visual evidence:

- `.scratch/file-explorer-dialog-directory-switch-no-cross-project-create.png` shows the newly active project B file list still containing only `NEXT.md`, proving the stale create dialog from project A did not post into B.
- `.scratch/task-dirbar-cleanup-busy-directory-scoped.png` shows project B's `current-b` worktree controls available while project A cleanup remains in flight.
- `.scratch/mission-delete-failure-keeps-session-open.png` shows the Mission row still selected with its child task visible after a failed delete.

## Twenty-Fourth Confirmed Residuals

Independent Overlay/GUI audit found three new non-duplicate issue locations after the twenty-third repair batch:

- FileEditor still stores only a relative `selectedFilePath`. If a file from project A is open, the active directory switches to project B, and the user saves, `file/content` can receive the stale A draft under B's directory.
- Mission delete and rename still wrap durable mutation and required list refetch in one `withBusy()` catch. A successful delete or rename followed by `GET /mission` failure is reported as `Delete mission failed` or `Rename mission failed`, even though the durable mutation already succeeded.
- FileExplorer upload completion uses stale operation guards for success/error messages but unconditionally clears `uploading` and `uploadDragTarget` in `finally`. A completed project A upload can clear project B's newer upload state after a directory switch.

Independent tooling/benchmark audit found five new non-duplicate issue locations:

- Generated-artifact repair left stale tests in `routes-check-openapi.test.ts` and `session-config-routes.test.ts` that still require the retired literal Prettier command instead of the `GENERATED_ARTIFACT_PATHS` source.
- `audit-calculator.ts` preview startup still resets inactivity on unauthoritative `fetch()` probes before the spawned Vite log proves ownership of the port.
- `audit-calculator.ts` history persistence check only inspects `localStorage`; it does not reload and prove rendered history is restored.
- `audit-calculator.ts` accepts 3 to 6 keypad columns for a requirement that says a 4-column grid.
- `publish.ts` can silently skip AUR update when all retry attempts fail because the retry loop never throws after exhaustion.

Independent backend/runtime audit found two new non-duplicate issue locations:

- `/experimental/worktree/reset` calls `Worktree.reset()` directly and can hard-reset active goal-bound worktrees that project worktree deletion correctly marks non-removable.
- `/find` and `/find/file` can report backend search failures as successful empty or stale results. `Ripgrep.search()` returns `[]` for every non-zero exit, and the file indexer can keep `fetching=true` after `Ripgrep.files()` throws.

Call point recall for this repair:

- FileEditor ownership: `file-workbench.ts` `selectedFilePath`, `openFileEditor()`, `updateOpenFilePathAfterMove()`, `closeFileEditorIfDeleted()`, `FileEditorPane.tsx` resource key, read/write API paths, `FileExplorerPanel.tsx` open-file call sites, active directory application, and FileExplorer browser fixtures.
- Mission reload semantics: `Mission.tsx` `withBusy()`, `handleMissionDelete()`, `handleMissionRename()`, `missionRecordsCtl.refetch()`, local mutate paths, action error rendering, mission row browser fixture, and Mission i18n action labels.
- FileExplorer upload ownership: `FileExplorerPanel.tsx` `handleUploadDrop()`, drag target state, upload state/message state, `uploadDroppedFiles()`, held `/file/upload` browser fixtures, and directory switch helpers.
- Generated artifact tests: `script/generate.ts`, `script/generated-artifacts.ts`, `routes-check-openapi.test.ts`, `session-config-routes.test.ts`, `document-health.test.ts`, `generate.yml`, and the SDK/OpenAPI/docs generation order.
- Benchmark evidence: `audit-calculator.ts` `startPreview()`, `markPreviewActivity()`, `fetchWithDeadline()`, R6 history checks, R11 grid checks, `browser-inactivity.ts`, and `audit-calculator.test.ts` source-contract coverage.
- Release publish: `script/publish.ts` AUR retry loop, command execution helper, release/document health tests, and force-push contract checks.
- Worktree reset safety: `server/routes/experimental.ts` `/experimental/worktree/reset`, `Worktree.reset()`, `listProjectWorktrees()`, active goal/worktree inventory, project worktree deletion tests, and worktree lifecycle tests.
- File search failure propagation: `server/routes/file.ts` `/find` and `/find/file`, `file/ripgrep.ts` search/files exit handling, `file/index.ts` file index lifecycle, `file-routes.test.ts`, and `ripgrep.test.ts`.

## Twenty-Fourth Round Repair And Verification

- FileEditor selection now stores `{ path, directory }` as the editor target. Reads, saves, selected-row expansion, move updates, and delete-close behavior all compare the captured directory before mutating editor state or sending file API requests.
- Mission rename/delete now separate durable mutation success from required list reload failure. Durable success updates the local list immediately; a reload failure is reported as reload-specific copy instead of `Rename mission failed` or `Delete mission failed`.
- FileExplorer upload in-flight state is token + directory scoped. A stale completion from project A cannot clear project B's newer upload state or drag target.
- Generated-artifact source-contract tests now assert the `GENERATED_ARTIFACT_PATHS` authority instead of the retired literal Prettier command.
- `audit-calculator.ts` now records preview activity only after the spawned preview log proves port ownership, reloads before validating persisted history rendering, and requires exactly four keypad columns for the four-column requirement.
- CLI publish now throws `AUR update failed after ${maxAurUpdateAttempts} attempts for ${pkg}` on exhausted AUR retries instead of silently continuing to Homebrew.
- `/experimental/worktree/reset` now goes through the project worktree inventory and only resets entries that `listProjectWorktrees()` marks removable, matching delete-route active-worktree safety.
- `/find` and `/find/file` now propagate ripgrep and file-index failures. `Ripgrep.search()` treats exit code 1 as the only no-match success; other non-zero exits throw, and the file index clears failed in-flight scans so the next request can retry rather than returning stale results.
- Side activity browser screenshot targeting was corrected to capture `mission-left-panel`, so visual evidence includes the reload-specific Mission action error rather than only the inner empty ledger.

Verification commands passed:

- `bun test packages/opencorvus/test/benchmark/audit-calculator.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/document-health.test.ts -t "AUR update" --timeout 60000`
- `bun test packages/opencorvus/test/script/routes-check-openapi.test.ts -t "route and docs checks use the generated OpenAPI spec source" --timeout 60000`
- `bun test packages/opencorvus/test/server/session-config-routes.test.ts -t "SDK/OpenAPI generation points stay explicit" --timeout 60000`
- `bun test packages/opencorvus/test/server/project-routes.test.ts -t "active managed worktree" --timeout 60000`
- `bun test packages/opencorvus/test/file/ripgrep.test.ts packages/opencorvus/test/server/file-routes.test.ts --timeout 60000`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/overlay/test/file-explorer-editor.test.ts --timeout 60000`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/file-explorer-search-error.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/side-activity-toolbar-browser.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`

Reviewed visual evidence:

- `.scratch/file-editor-directory-scoped-save-after-switch.png` shows the editor still displaying `README.md` with the edited project A draft after switching directories; the browser assertion proves the save request stays bound to project A.
- `.scratch/file-explorer-upload-stale-completion-keeps-next-upload.png` shows project B's Explorer still in `Uploading` state with `NEXT.md` visible after project A's held upload completes.
- `.scratch/mission-mutation-reload-failure-copy.png` now shows the Mission panel error bar with `Reload missions failed: Deleted "Renamed mission"...`, plus the empty ledger, proving the durable delete succeeded and only the reload failed.

## Twenty-Fifth Confirmed Residuals

Independent Overlay/GUI audit found four new non-duplicate issue locations after the twenty-fourth repair batch:

- Terminal and Coding CLI profile reloads are not directory-owned. Slow project A `/terminal/profiles` or `/coding/cli/profiles` responses can overwrite project B launcher state after a directory switch.
- `MemoryPanel` async loads capture task/directory for requests but write memory rows, errors, and detail states after await without verifying the active task/directory still matches.
- Coding Assistant ledger search and load-more responses can overwrite newer list state because the service reads global search/cursor state and commits responses without a source token.
- Mission load-more busy state is still global. A hanging unfiltered load-more can disable a searched source's own load-more button until the stale request completes.

Independent tooling/benchmark audit found five new non-duplicate issue locations:

- `browser-preview-repair-pressure.ts` still enforces elapsed Bun `--timeout` values, and the test pins this elapsed timeout instead of no-activity ownership.
- `browser-inactivity.ts` resets inactivity on repeated network errors while Playwright navigation waits for `networkidle` with timeout disabled, so a page that repeatedly 404s can hang forever before diagnostics are checked.
- Typecheck CI still hard-codes generated SDK/OpenAPI paths instead of deriving drift verification from `script/generated-artifacts.ts`; `sdk-build-format-contract.test.ts` pins the split.
- Calculator R10 theme persistence evidence checks same-page storage/signature without reloading and proving rendered theme restoration.
- Calculator R11 now requires exactly four columns but still omits the required five-row and operator/function color evidence.

Independent backend/runtime audit found three new non-duplicate issue locations:

- Conversation hydrate/history routes (`/task/:taskID/conversation`, `/task/:taskID/conversation/session/:sessionID`, `/task/:taskID/conversation/history`) still bypass active-project ownership by using task-scope transcript reads.
- `/task/:taskID/events` ignores the active project when resolving the task runtime root. Existing `runtime-isolation-routes.test.ts` evidence expects 404 for foreign project tasks but currently receives 200.
- `PATCH /file/content` converts expected write errors such as escaping paths, missing files, and binary/non-editable files into generic 500s instead of named route errors.

Call point recall for the next repair:

- Terminal/Coding CLI profile ownership: `terminal-selection.ts` terminal profile store, `WorkspaceLayoutControls.tsx` reload trigger and open action, `WorkspaceCodingCliLaunchers.tsx` coding CLI profile state, `/terminal/profiles`, `/coding/cli/profiles`, and command-dock/browser launcher tests.
- MemoryPanel ownership: `MemoryPanel.tsx` `loadMemory()`, `doSearch()`, `loadMemoryDetail()`, active task/directory props, detail state map, and left-tool-panels directory browser fixtures.
- Coding Assistant ledger ownership: `main.tsx` coding assistant search handlers, `services/coding-assistant.ts` `loadCodingAssistantSessions()`, `CodingAssistantSessionList.tsx` load-more button/cursor, and coding-assistant directory browser tests.
- Mission load-more busy ownership: `Mission.tsx` `missionsLoadingMore`, `missionRecordSource()`, `handleMissionLoadMore()`, `MissionList.tsx` load-more disabled state, and task-list-perf stale load-more fixtures.
- Browser benchmark timeouts and diagnostics: `browser-preview-repair-pressure.ts`, `browser-preview-repair-pressure.test.ts`, `browser-inactivity.ts`, `audit-calculator.ts`, `review-deliverable.ts`, and benchmark assets/fixtures for repeated network failures.
- Generated artifact CI authority: `script/generated-artifacts.ts`, `.github/workflows/typecheck.yml`, `sdk-build-format-contract.test.ts`, `generate.yml`, and generated OpenAPI/SDK/docs checks.
- Calculator R10/R11 evidence: `audit-calculator.ts` theme read/toggle/storage path, reload helper, keypad geometry/color collection, `web-calculator-request.txt`, and `audit-calculator.test.ts`.
- Conversation/event ownership: `server/routes/orchestrator.ts` conversation hydrate/session/history/event routes, `taskSessionIDs()`, `taskPrimaryProjectRoot()`, `requireRouteTaskInCurrentProject()`, `runtime-isolation-routes.test.ts`, and task-conversation route tests.
- File write errors: `server/routes/file.ts` `PATCH /file/content`, `File.writeText()`, existing named file errors, `server/error-handler.ts` file error status mapping, `file-routes.test.ts`, and `file/index.test.ts`.

## Twenty-Fifth Round Repair And Verification

- Terminal and Coding CLI profile reloads now carry the originating directory through the reload operation. Stale `/terminal/profiles` or `/coding/cli/profiles` responses from project A cannot overwrite project B launcher state after a directory switch.
- `MemoryPanel` async memory list, search, and detail loads now use task + directory source ownership before writing rows, errors, loading state, or detail state. Stale project/task responses are ignored instead of replacing the current panel.
- Coding Assistant session search and load-more requests now carry directory, search query, cursor, and request owner source. Stale ledger responses cannot overwrite a newer search source or append to the wrong cursor.
- Mission load-more busy state is scoped to the exact mission source, so a hanging unfiltered request cannot disable a searched source's load-more control.
- `browser-preview-repair-pressure.ts` no longer relies on elapsed Bun test timeouts for the benchmark subprocess. Bun test timeout is disabled for the invoked benchmark, leaving the benchmark-owned inactivity timeout as the authority.
- `browser-inactivity.ts` now treats HTTP failure responses, request failures, and page errors as immediate browser failures instead of resetting the inactivity timer while Playwright waits indefinitely for network idle.
- Typecheck CI now derives generated artifact drift paths from `script/generated-artifacts.ts`, matching the generate workflow source of truth.
- Calculator R10 theme persistence now reloads the rendered page before proving restored theme state, and R11 now verifies exactly four columns, five rows, operator key color, and function key color evidence.
- Conversation hydrate, session hydrate, and history routes now read under the task record's project instead of the request directory. Raw current-project transcript and control/mutation routes still reject foreign active-project task IDs, and event streams enforce active-project ownership before opening SSE.
- `PATCH /file/content` now maps escaping, missing, and binary/non-editable write targets to named file errors with documented route status codes instead of generic 500s.
- Project deletion now separates visible queue-row cancellation from in-flight prompt settlement for non-task project session wakes. It marks current-instance running queue rows failed with `project deleted`, then still waits for the in-flight prompt promise to settle before deleting project state.

Verification commands passed:

- `bun test packages/opencorvus/test/benchmark/audit-calculator.test.ts packages/opencorvus/test/benchmark/browser-preview-repair-pressure.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts -t "typecheck workflow" --timeout 60000`
- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts -t "project-scoped transcript" --timeout 60000`
- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts -t "current-project transcript and direct session cancel reject foreign tasks while conversation reads the task project" --timeout 60000`
- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts -t "GET /task/:taskID/conversation hydrates transcript from the task project, not the request directory" --timeout 60000`
- `bun test packages/opencorvus/test/server/runtime-isolation-routes.test.ts -t "task event stream opens" --timeout 60000`
- `bun test packages/opencorvus/test/server/file-routes.test.ts -t "PATCH /file/content returns named errors" --timeout 60000`
- `bun test packages/opencorvus/test/server/project-routes.test.ts -t "DELETE /project/current waits for non-task project queue wake before removing state" --timeout 60000`
- `bun test packages/opencorvus/test/task-api/delete-running-task-settle.test.ts -t "cancelTask waits for running queue prompt before marking queue row failed" --timeout 60000`
- `bun test packages/opencorvus/test/scheduler/task-queue-service.test.ts -t "cancelSessionPrompts stops claimed in-flight wake before it starts a loop" --timeout 60000`
- `bun test packages/opencorvus/test/server/project-routes.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/task-api/delete-running-task-settle.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/scheduler/task-queue-service.test.ts -t "cancelSessionPrompts|with concurrency=1" --timeout 60000`
- `bun test packages/overlay/test/project-directory-request-loop.test.ts packages/overlay/test/mission-session-source.test.ts packages/overlay/test/terminal.test.ts packages/overlay/test/coding-assistant-service.test.ts packages/overlay/test/coding-assistant-panel.test.ts --timeout 60000`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/left-tool-panels-directory-browser.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/workspace-terminal-open.test.ts packages/overlay/test/browser/coding-assistant-directory-browser.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-list-perf.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`

Reviewed visual evidence:

- `.scratch/memory-row-sibling-controls.png` shows Memory panel row actions still contained beside the current task memory rows after directory-scoped request changes.
- `.scratch/workspace-command-dock-launchers.png` shows the command dock launchers remain available and visually stable after directory-owned profile reload changes.
- `.scratch/coding-assistant-directory-filter.png` shows Coding Assistant directory-filtered ledger state after the search/load-more ownership repair.
- `.scratch/memory-panel-delete-empty-state.png` shows the Memory panel empty state after stale detail/list writes were prevented.

## Twenty-Sixth Confirmed Residuals

Independent backend/runtime audit found one new non-duplicate issue location:

- `PATCH /task-queue/reorder` requires an active project directory through middleware, but the mutation used body `directory` directly. With project A active, a request body naming project B's directory and B queued task IDs could reorder project B.

Independent Overlay/GUI audit found three new non-duplicate issue locations:

- Skill Market mount matrix is not directory-owned. `clearProjectScopeData()` clears skills/market state without clearing `skillMounts`, and `loadSkillMountMatrix()` / mount mutations commit without captured directory ownership.
- `MemoryPanel` list/detail loads are directory-owned, but row delete still receives only `fileId` and reads `currentDirectory()` at click time. A stale project A row can be deleted under project B while B is loading.
- Coding CLI dropdown items can survive a directory switch. Reload responses are directory-owned, but an already open menu can launch an A-only CLI profile with B as `cwd`.

Independent tooling/benchmark audit found four new non-duplicate issue locations:

- `runtime/visual-page.ts` still uses elapsed launch/navigation/settle deadlines and Playwright navigation timeout in the visual-diff sidecar instead of no-activity navigation.
- Screenshot/reference helper scripts still use elapsed `page.goto(... networkidle ... timeout)` calls, and some catch navigation failure while still writing screenshots.
- URL screenshot reference capture accepts HTTP error pages as valid visual references when they contain enough visible content.
- Webpage extraction rejects 4xx but not 5xx, allowing server error pages to seed downstream page skeleton evidence.

Call point recall for this repair:

- Queue reorder ownership: `server/routes/orchestrator.ts` `/task-queue/reorder`, `task-api/index.ts` `EngineService.reorderTaskQueue()`, `engine/queue.ts` `queuedTasksForCwd()` / `reorderQueuedTasksForCwd()`, overlay `TaskList.tsx` reorder caller, and queue route/engine tests.
- Skill mount ownership: `store/app.ts` `clearProjectScopeData()`, `services/extensions.ts` skill mount store/load/mount/unmount, `components/settings/SkillMarketPanel.tsx`, `services/workspace.ts` directory change flow, and skill mount browser tests.
- Memory row delete ownership: `MemoryPanel.tsx` `loadMemory()`, `doSearch()`, `loadMemoryDetail()`, `handleDeleteInline()`, current task/directory props, row action rendering, and left-tool-panels directory browser tests.
- Coding CLI stale menu ownership: `WorkspaceCodingCliLaunchers.tsx`, `WorkspaceSplitLauncher.tsx`, coding CLI profile reload/launch service calls, terminal profile validation, and workspace terminal/coding-assistant browser tests.
- Browser inactivity and screenshots: `runtime/visual-page.ts`, `script/benchmark/browser-inactivity.ts`, `script/screenshot-overlay.ts`, `script/overlay-snap.ts`, `script/benchmark/capture-ainvest-reference.ts`, `script/verify-executor-selector.ts`, visual launch/runtime tests, and helper source-contract tests.
- URL screenshot and extraction HTTP status: `frontend-design/capture-gate.ts`, `frontend-design/url-screenshot-tool.ts`, `browser/webpage/extract.ts`, capture reference tests, and webpage extract tests.

## Twenty-Sixth Round Repair And Verification

- Queue reorder now scopes queued task selection by the active project ID. The route can no longer mutate project B's queue while project A is active, while same-project reorder still succeeds.
- URL reference capture and webpage extraction now reject all HTTP error responses before materializing screenshot or page-skeleton evidence. HTTP 500 pages can no longer seed downstream visual references.
- Screenshot helper scripts now use the shared browser no-activity navigation helper and no longer swallow Playwright navigation failures before writing screenshots.
- `runtime/visual-page.ts` now disables Playwright's elapsed navigation timeout and wraps navigation / selector wait in browser-activity ownership. The outer Node sidecar timeout remains only a long last-resort cleanup boundary.
- Skill mount matrix state is directory-owned. `clearProjectScopeData()` clears `skillMounts`, and skill mount load/mount/unmount/import responses commit only when their captured directory still matches the active directory.
- Memory row disclosure/delete actions now use the memory list's captured `{ taskID, directory }` source and disable stale rows after a task/directory switch. A stale project A row cannot delete or fetch details under project B while B is loading.
- Coding CLI launcher profiles are tagged by directory. Directory switches close open menus, clear old profiles, and launch validates that the clicked profile belongs to the active directory before opening a CLI.

Verification commands passed:

- `bun test packages/opencorvus/test/server/task-queue-routes.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/engine/queue.test.ts -t "reordered queued siblings|reorder rejects active tasks" --timeout 60000`
- `bun test packages/opencorvus/test/browser/webpage/extract.test.ts -t "HTTP 500|HTTP 403" --timeout 60000`
- `bun test packages/opencorvus/test/frontend-design/capture-gate.test.ts -t "HTTP error pages|blank local" --timeout 60000`
- `bun test packages/opencorvus/test/script/browser-helper-navigation.test.ts packages/opencorvus/test/runtime/visual-launch.test.ts --timeout 60000`
- `bun test packages/overlay/test/project-directory-request-loop.test.ts packages/overlay/test/extensions-service.test.ts packages/overlay/test/memory-panel-detail-dialog.test.ts packages/overlay/test/terminal.test.ts --timeout 60000`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/left-tool-panels-directory-browser.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/workspace-terminal-open.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `git diff --check`

Reviewed visual evidence:

- `.scratch/workspace-coding-cli-menu-directory-owned.png` shows the real overlay after switching to project B, with only the B-owned `Gemini CLI` menu item visible and no error notifications.
- `.scratch/memory-row-sibling-controls.png` shows Memory panel row disclosure/delete controls still aligned and contained after row source ownership changes.

## Twenty-Seventh Confirmed Residuals

Independent backend/runtime audit found four new non-duplicate issue locations:

- `ControlTimeline.list()` filtered only by task/session/surface and not `ControlMessageTable.project_id`, so timeline reads could leak control messages across projects.
- Persistent panel control sessions in `ControlMessage.resolveSession()` used global `Session.get(input.sessionID)`, allowing a panel request under project B to reuse a project A session ID.
- Control timeline scoping used a global `EngineTaskTable` lookup for `taskSession()`, and explicit session IDs were written into timeline scope without proving active-project ownership.
- Session mutations reachable through the panel tool bypassed route guards: `Session.fork()` used global `Session.get()`, and `EngineService.deleteSession()` used a global root session lookup before deleting tasks/session trees.

Independent Overlay/GUI audit found six new non-duplicate issue locations:

- FileExplorer mutation state was global by kind, so a stale project A refresh could keep project B controls busy or surface stale completion/error copy after a directory switch.
- MCP status reloads committed unowned responses after directory switches.
- Skill Market catalog reloads committed unowned catalog data, and install actions could run against a stale loaded catalog.
- The overlay app store used Solid store merge semantics for MCP maps, so `setMcp({})` preserved stale server keys instead of replacing the map.
- Executor list reloads and model-update-triggered reloads committed stale executor lists after directory switches.
- Provider catalog/auth reloads committed stale provider info and fed stale model choices after directory switches.

Independent tooling/browser audit found two new non-duplicate issue locations:

- Browser evidence sidecars still used elapsed Playwright navigation timeouts in `frontend-design/capture-gate.ts`, `browser/webpage/extract.ts`, `browser/webpage/render.ts`, `browser/webpage/runtime-state.ts`, `frontend-design/output-tools.ts`, and browser-preview sidecars.
- URL reference capture accepted HTTP 200 documents with failed subresources, allowing visually incomplete reference evidence to seed downstream work.

Call point recall for this repair:

- Control ownership: `control/message.ts`, `control/timeline.ts`, `session/index.ts` `Session.fork()`, `task-api/index.ts` `EngineService.deleteSession()`, `server/routes/panel.ts`, `server/routes/gateway.ts`, `tool/panel.ts`, timeline/panel tests, and active-project route guard patterns.
- FileExplorer ownership: `FileExplorerPanel.tsx`, file refresh/search/upload/mutation state, file explorer editor tests, stale refresh browser fixture, and Explorer screenshot evidence.
- Overlay project-scope reload ownership: `services/extensions.ts`, `services/config.ts`, `services/init.ts`, `services/executor.ts`, `store/app.ts`, `ExecutorSelector.tsx`, `SkillMarketPanel.tsx`, `ProvidersPanel.tsx`, extension/provider/executor tests, and MCP/Skill Market browser evidence.
- Browser inactivity and failed-subresource evidence: `frontend-design/capture-gate.ts`, `frontend-design/output-tools.ts`, `browser/webpage/extract.ts`, `browser/webpage/render.ts`, `browser/webpage/runtime-state.ts`, `browser-preview/evidence-runner.ts`, `browser-preview/live.ts`, `browser-preview/local-module-source-binding.ts`, `browser-preview/scroll-slice-comparison.ts`, and their focused browser/source tests.

## Twenty-Seventh Round Repair And Verification

- FileExplorer mutation state is now token + directory scoped. A stale project A refresh cannot own project B controls or write stale command messages after a directory switch.
- `ControlTimeline.list()` now filters by active project ID. Control timeline scope only attaches task/session IDs proven to belong to the active project.
- Persistent panel control sessions now use `Session.getInProject()`. `Session.fork()` enforces active-project session ownership, and `EngineService.deleteSession()` rejects cross-project deletes whenever an active project context exists.
- MCP status and Skill Market catalog loads now carry directory ownership and skip stale commits. Skill Market install returns if the loaded catalog no longer belongs to the active directory.
- MCP and skill mount store setters now replace maps with `reconcile(..., { merge: false })` so stale server/mount keys cannot survive an empty replacement.
- Executor loads and `setExecutorModel()` reloads now commit only when the request directory still owns the active project state.
- Provider catalog/auth loads now carry directory ownership through startup, settings refresh, and executor model selection, preventing stale provider/model state from project A from replacing project B state.
- Browser sidecar navigation now disables Playwright elapsed navigation timeout (`timeout: 0`) and wraps navigation / optional network-idle waits in browser inactivity ownership. The repair covers URL capture, webpage extract/render/runtime-state, static HTML screenshot rendering, browser-preview evidence, live preview, local-module binding, and scroll-slice comparison sidecars.
- URL reference capture now records failed subresources and rejects 200 pages with broken assets before materializing screenshot/manifest artifacts.

Verification commands passed:

- `bun test packages/overlay/test/file-explorer-editor.test.ts --timeout 60000`
- `node --test --test-concurrency=1 --test-name-pattern "file explorer stale refresh completion" packages/overlay/test/browser/file-explorer-search-error.test.ts`
- `bun test packages/opencorvus/test/control/timeline.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/tool/panel.test.ts --timeout 60000`
- `bun test packages/overlay/test/extensions-service.test.ts packages/overlay/test/project-directory-request-loop.test.ts --timeout 60000`
- `bun test packages/overlay/test/task-directory-project-scope.test.ts --timeout 60000`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/skill-mcp-panel-browser.test.ts`
- `bun test packages/overlay/test/executor-service.test.ts --timeout 60000`
- `bun test packages/overlay/test/config-load-timeout.test.ts --timeout 60000`
- `bun test packages/overlay/test/executor-selector-dualbar.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/browser-preview/navigation-inactivity.test.ts packages/opencorvus/test/frontend-design/output-incremental-tools.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/browser/webpage/render.test.ts packages/opencorvus/test/browser/webpage/extract.test.ts packages/opencorvus/test/browser/webpage/runtime-state.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/frontend-design/capture-gate.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/browser-preview/scroll-slice-comparison.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/browser-preview/local-module-source-binding.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `git diff --check`

Reviewed visual evidence:

- `.scratch/file-explorer-stale-refresh-next-project-clean.png` shows the next project Explorer with `NEXT.md`, no stale project A command message, and the Refresh control available.
- `.scratch/skill-mcp-status-pills.png` shows the MCP settings panel rows and status pills aligned after directory-owned MCP/Skill Market reload changes.

## Twenty-Eighth Confirmed Residuals

Independent backend/runtime audit found two new non-duplicate issue locations:

- Plugin `taskArtifacts` helpers used a global `requireTask(input.taskID)` lookup. A project-scoped plugin service under project A could create/read artifacts for project B if it knew B's task ID.
- `/shutdown`, `/restart`, `/instance/dispose`, and `/global/dispose` returned real `503`/`409` responses that were missing from OpenAPI route contracts, leaving generated clients with success-only models.

Independent Overlay/GUI audit found two new non-duplicate issue locations:

- Notification task actions stored only `taskID`, then opened notifications with `selectTask(item.taskID)`. After a directory switch, persisted project A notifications could fail to open or target project B context.
- PromptCatalog project-level profile mutations called directoryless `updateConfig()`. If the active directory changed between the helper's `GET /config` and `PATCH /config`, a project A action could patch project B.

Independent browser/tooling audit found three new non-duplicate issue locations:

- Overlay screenshot helpers under `packages/overlay/script` swallowed navigation, selector, and dialog-open failures, then still wrote screenshots.
- Accepted-output browser sidecars in `frontend-design/output-tools.ts` and `browser-preview/live.ts` treated request failures/page errors as activity and could return successful screenshot payloads from broken pages.
- Web docs screenshot QA used elapsed Playwright `networkidle` navigation and checked only the main response, so docs screenshots could pass with missing subresources or fail slow-but-active pages by wall-clock timeout.

Local audit found one additional non-duplicate issue location before the subagent reports returned:

- Acceptance walkthrough execution used Playwright elapsed navigation/selector waits (`networkidle`, `waitForNavigation({ timeout: 5000 })`) instead of browser-inactivity ownership in both the dependency-injected DSL path and Node sidecar path.

Call point recall for this repair:

- Walkthrough timeout ownership: `acceptance/checks/walkthrough/dsl.ts`, `run.ts`, `translate.ts`, `dsl.test.ts`, `run.test.ts`, browser runtime launch timeout source, and `RUNTIME_CAPTURE_DEFAULTS`.
- Notification task ownership: `services/notify.ts`, `NotificationCenter.tsx`, `services/events.ts`, `services/sse.ts`, `services/task.ts` `selectTask()`, task-list SSE stream directory capture, and notification browser evidence.
- PromptCatalog config ownership: `components/settings/PromptCatalog.tsx`, `services/config.ts` `updateConfig()` / prompt-profile helpers, `prompt-profile-scope.ts`, `services/api.ts` directory injection, and config/prompt catalog tests.
- Plugin artifact ownership: `plugin/index.ts` `createTaskArtifacts()`, `server/routes/plugin.ts`, `engine/store.ts` `requireTask()`, `EngineArtifactTable`, plugin service route tests, and active `Instance.project.id`.
- Route contract drift: `server/routes/app.ts`, `server/routes/global.ts`, `server/error.ts`, `Server.openapi()`, app route tests, and generated OpenAPI/SDK consumers.
- Visual helper strictness: `frontend-design/output-tools.ts`, `browser-preview/live.ts`, `overlay/script/screenshot.ts`, `snap-titlebar.ts`, `snap-settings.ts`, `snap-goal.ts`, `web/qa/screenshot-all.cjs`, browser helper source-contract tests, and notification browser screenshots.

## Twenty-Eighth Round Repair And Verification

- Acceptance walkthroughs now wrap navigation and observable assertions in browser-inactivity ownership and disable Playwright elapsed timeouts with `timeout: 0`. Click steps no longer use a fixed 5-second navigation wait; the following assertion owns readiness.
- Task notifications now persist `taskDirectory`, task-list SSE routing passes its captured directory into notification creation, and notification Open actions call `selectTask(item.taskID, { directory: item.taskDirectory })`. Directoryless task notifications do not render an Open action.
- PromptCatalog project-level profile create/duplicate/save/delete/activate/import handlers capture `promptProfileCatalogDirectory()` at action time. `updateConfig()` accepts an explicit directory and uses it for both `GET /config` and `PATCH /config`.
- Plugin task artifacts now validate the referenced task belongs to the active plugin instance project before create/latest/get. Foreign project artifact creation rejects before writing an `EngineArtifactTable` row.
- Shutdown/restart/dispose routes now document their real `503`/`409` response bodies in OpenAPI.
- Accepted-output browser sidecars now fail on HTTP error responses, request failures, and page errors before returning screenshot payloads.
- Overlay screenshot scripts use shared browser-inactivity navigation and required selector waits; they no longer warn-and-continue before screenshot capture. Web docs screenshot QA uses strict browser-inactivity navigation and fails before screenshot capture on subresource/page failures.

Verification commands passed:

- `bun test packages/opencorvus/src/acceptance/checks/walkthrough/dsl.test.ts packages/opencorvus/src/acceptance/checks/walkthrough/run.test.ts --timeout 60000`
- `bun test packages/overlay/test/notification-center-primitive.test.ts packages/overlay/test/config-update-single-source.test.ts packages/overlay/test/prompt-catalog-save.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/server/plugin-service-routes.test.ts packages/opencorvus/test/server/app-routes.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/browser-helper-navigation.test.ts packages/opencorvus/test/frontend-design/output-incremental-tools.test.ts packages/opencorvus/test/browser-preview/navigation-inactivity.test.ts packages/opencorvus/src/acceptance/checks/walkthrough/dsl.test.ts packages/opencorvus/src/acceptance/checks/walkthrough/run.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/notification-center-task-action-browser.test.ts`
- `git diff --check`

Reviewed visual evidence:

- `.scratch/notification-task-action-toast.png` shows the toast Open action and detail controls as separate contained buttons with readable diagnostic details.
- `.scratch/notification-dismissed-panel-readable.png` shows notification history in the panel remains readable after dismissal.
- `.scratch/notification-panel-width-fill.png` shows the notification card spans the panel width without clipping or overlap.

## Twenty-Ninth Confirmed Residuals

Independent backend/runtime audit found three new non-duplicate issue locations:

- ACP session MCP server attachment failures are swallowed. `ACPAgent.attachSessionMcpServers()` logs `sdk.mcp.add(..., { throwOnError: true })` failures and continues, while `MCP.add()` can also return failed status without throwing when no connection was created. `newSession`, `loadSession`, `resumeSession`, and `forkSession` can therefore report a ready session with requested MCP capability missing.
- Browser-preview task routes return runtime `404` responses for missing or foreign targets/evidence, but their OpenAPI route contracts declare success-only responses.
- Panel memory get/delete routes return runtime `404` for missing or foreign memory rows, but their OpenAPI route contracts declare success-only responses.

Independent Overlay/GUI audit found three new non-duplicate issue locations:

- The ordinary terminal profile menu can outlive the project directory that loaded its rows. Stale project A profile rows can remain clickable after switching to project B.
- Provider settings mutations use current global directory state instead of the directory that owns the edited provider form/API key row. A project A edit can patch project B after a directory switch.
- MCP add and delete-all actions are not bound to the directory whose UI initiated them. A project A form or confirmation can add, disconnect, remove auth, or delete config in project B.

Independent tooling/browser audit found six new non-duplicate issue locations:

- Webpage extraction treats `requestfailed` and `pageerror` as activity and can return successful screenshot/source evidence from a `200` page with broken subresources or runtime errors.
- Webpage render evidence treats `requestfailed` and `pageerror` as activity and can return `ok: true` while burying browser failures in payload metadata.
- Webpage runtime-state capture treats browser failures as activity, swallows network-idle failures, and can return snapshots from a broken runtime.
- Browser-preview region comparison records failed requests, console errors, and page errors in route diagnostics, but `valid_app_page` ignores them and completed regions can still persist as passed.
- Browser-preview local module source binding treats `requestfailed` and `pageerror` as activity and can bind source evidence from a broken implementation page.
- Browser-preview scroll-slice comparison treats `requestfailed` and `pageerror` as activity and can generate visual comparison artifacts from a broken page.

Local audit triaged browser-preview task persistence ownership and did not confirm it as a new issue in this round: route entry points call `browserPreviewTaskEvidenceRoot(taskID)`, which delegates to `taskPrimaryProjectRoot(taskID, { activeProjectID: Instance.project.id })`; existing route tests already reject foreign task IDs across browser-preview subroutes. Tool entry ownership remains tied to the session/task context and will be re-audited only if later evidence shows a callable foreign-task path.

Call point recall for this repair:

- ACP MCP attachment: `acp/agent.ts` `newSession()`, `loadSession()`, `unstable_forkSession()`, `unstable_resumeSession()`, `attachSessionMcpServers()`, `acp/session.ts` session state, `mcp/index.ts` `MCP.add()`, ACP event-subscription tests, and session-config source-contract tests.
- Browser-preview route contracts: `server/routes/browser-preview.ts`, `server/routes/app.ts` route mounting, `server/server.ts` OpenAPI generation, browser-preview route runtime tests, app route OpenAPI tests, and generated SDK/OpenAPI consumers.
- Panel memory route contracts: `server/routes/panel.ts`, `memory` project-scoped get/delete calls, `server/panel-memory-routes.test.ts`, app route OpenAPI tests, and overlay MemoryPanel consumers.
- Terminal menu directory ownership: `WorkspaceLayoutControls.tsx`, `services/terminal-selection.ts`, `services/terminal.ts`, `services/workspace.ts` active-directory flow, terminal unit tests, workspace terminal browser test, and split-launcher primitive tests.
- Provider mutation ownership: `ProvidersPanel.tsx`, `services/config.ts` `updateConfig()`, `services/api.ts` directory injection, auth routes, provider/auth browser tests, provider layout source tests, and config single-source tests.
- MCP mutation ownership: `SkillMarketPanel.tsx`, `services/mcp.ts` add/connect/disconnect/auth/delete-all helpers, `services/config.ts` explicit directory update support, MCP service tests, skill/MCP browser tests, and project-directory request-loop guards.
- Browser failure strictness: `browser/webpage/extract.ts`, `browser/webpage/render.ts`, `browser/webpage/runtime-state.ts`, `browser-preview/evidence-runner.ts`, `browser-preview/region-comparison.ts`, `browser-preview/local-module-source-binding.ts`, `browser-preview/scroll-slice-comparison.ts`, existing browser inactivity helpers, webpage/browser-preview focused tests, and source-contract tests that forbid success-on-browser-failure.

## Twenty-Ninth Round Repair And Verification

- ACP session MCP attachment now fails session creation/resume/fork/load when a requested MCP server attach response is missing or reports a non-connected status. The session is no longer reported ready with a silently missing requested capability.
- Browser-preview task routes and panel memory get/delete routes now document their runtime not-found responses in OpenAPI and throw the shared `NotFoundError` shape for missing or foreign resources.
- Terminal profile launchers close stale menus, clear profile selection on directory changes, and revalidate the clicked profile against the owning directory before launching.
- Provider settings mutations now capture the directory that owns the form/API-key row and pass that directory through config, auth, model discovery, refresh, and test calls.
- MCP add and delete-all now capture the initiating directory and MCP names before async work; disconnect/auth/config writes use that explicit directory and do not read the later global directory.
- Webpage render and runtime-state sidecars now fail before evidence capture on non-favicon HTTP failures, request failures, and page errors. Webpage extraction keeps the existing explicit skipped-image asset path for optional image/media downloads, but fails on failed script-style page dependencies and preserves main-document HTTP status errors.
- Browser-preview full capture, local-module binding, and scroll-slice sidecars fail on browser failures instead of treating them as activity. Region comparison records browser failures in route diagnostics and makes `valid_app_page=false`; route diagnostics remains the single source for route health so main-document status and screenshots are preserved.
- Provider browser fixture now models `/skill/mounts` like the real backend so provider screenshots are not polluted by an unrelated fixture 404 toast.
- A temporary debug script accidentally used the default local OpenCorvus data directory. The only generated records were `engine_task.id=tsk_debug_1782616591593`, two task artifacts, one protocol event, and one temp project row; they were identified by exact IDs and deleted in a transaction, with post-delete counts all zero.

Verification commands passed:

- `bun test packages/opencorvus/test/acp/event-subscription.test.ts -t "newSession rejects when requested MCP server attachment reports failure" --timeout 60000`
- `bun test packages/opencorvus/test/server/app-routes.test.ts packages/opencorvus/test/server/panel-memory-routes.test.ts --timeout 120000`
- `bun test packages/overlay/test/terminal.test.ts packages/overlay/test/mcp-service.test.ts packages/overlay/test/project-directory-request-loop.test.ts packages/overlay/test/provider-settings-layout.test.ts packages/overlay/test/browser-error-collector.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/browser/webpage/extract.test.ts packages/opencorvus/test/browser/webpage/render.test.ts packages/opencorvus/test/browser/webpage/runtime-state.test.ts --timeout 180000`
- `bun test packages/opencorvus/test/browser-preview/navigation-inactivity.test.ts packages/opencorvus/test/browser-preview/region-route-diagnostics.test.ts packages/opencorvus/test/browser-preview/local-module-source-binding.test.ts packages/opencorvus/test/browser-preview/scroll-slice-comparison.test.ts --timeout 180000`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/workspace-terminal-open.test.ts packages/overlay/test/browser/provider-auth-panel.test.ts packages/overlay/test/browser/skill-mcp-panel-browser.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/provider-auth-panel.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`

Reviewed visual evidence:

- `.scratch/workspace-coding-cli-menu-directory-owned.png` shows the terminal/coding CLI launcher after directory switching with only the current directory's menu item visible and no stale profile rows.
- `.scratch/workspace-command-dock-launchers.png` shows the command dock launcher buttons remain contained and aligned.
- `.scratch/provider-settings-primitive-owner.png` shows the provider settings surface after fixture repair: no unrelated `skill/mounts` 404 toast, no overlapping row controls, and API key rows remain contained.
- `.scratch/skill-mcp-delete-failure.png` shows MCP delete-all failure remains visible without removing the config rows or overlapping the MCP status list.

## Thirtieth Confirmed Residuals

Independent backend/runtime audit found six new non-duplicate issue locations:

- MCP OAuth pending authentication is globally keyed by MCP server name. Two active projects using the same MCP name can overwrite `pendingOAuthTransports`, `mcp-auth.json` OAuth state, and the callback `mcpNameToState` entry, allowing project A's callback to finish project B's pending transport/state.
- ACP `unstable_listSessions()` still uses timestamp-only cursor pagination. Sessions sharing the page boundary `time.updated` can be skipped because the next page filters `updated < cursor`.
- Browser-preview live commands use a host-side elapsed `LIVE_COMMAND_TIMEOUT_MILLISECONDS` timer. A live snapshot/input command can fail by wall-clock even while the browser sidecar is active.
- Browser-preview persisted evidence helpers collapse existing but corrupt/unreadable evidence into `undefined`, and routes then return `NotFoundError`. This hides payload/schema/hash/artifact corruption as a missing-resource 404.
- `PATCH /executor/:executorID/model` throws `NotFoundError` at runtime for unsupported executors, but its OpenAPI 404 response is description-only instead of the named error schema.
- `GET /channel/attachment/:id` documents `...errors(404)` but returns plain `{ error: "not found" }` for invalid signatures or missing attachments.

Independent Overlay/GUI audit found three new non-duplicate issue locations:

- Remaining settings/titlebar config writes are still directoryless. `patchConfig()` and several `updateConfig()` callers in Channels, Network, Permissions, AgentModels, General, and Titlebar menus still rely on the current global API directory context at request time.
- `loadConfigInfo()` can repopulate stale project config/channels/tool permissions after Close Project because `clearProjectScopeData()` does not invalidate the in-flight `configInfoLoadSequence`.
- First-page `loadTasks()` lacks stale-completion isolation after project clear/close. Pagination uses generation checks, but the initial `/global/tasks` response unconditionally calls `applyTasks()`.

Independent browser/tooling audit found six new non-duplicate issue locations:

- Acceptance walkthrough DSL and Node paths still treat `requestfailed` and `pageerror` as browser activity in the inactivity helper. Final pass status checks page/console errors but does not make network failures a pass blocker.
- Browser Node sidecar executor uses a process-level elapsed hard timeout. stdout/stderr activity does not refresh the timeout, so active sidecars can be killed by wall-clock.
- Browser MCP automation tools use elapsed Playwright timeouts for navigate/wait operations and return successful screenshots without checking accumulated page diagnostics.
- Browser MCP monitor screenshot endpoint returns cached/blank/error SVG images with HTTP 200 for concurrent, failed, or timed-out captures.
- URL screenshot/reference capture records failed responses and `requestfailed`, but not late `pageerror`; a 200 page that throws after navigation can still materialize screenshot artifacts.
- Mission benchmark accepts completed mission tasks with missing evaluation verdicts when local verification passes.

Call point recall for this repair:

- MCP OAuth ownership: `mcp/index.ts` `pendingOAuthTransports`, `startAuth()`, `authenticate()`, `finishAuth()`, `removeAuth()`, `mcp/auth.ts` token/state persistence, `mcp/oauth-callback.ts` `pendingAuths` / `mcpNameToState`, MCP auth routes and tests.
- ACP pagination: `acp/agent.ts` `unstable_listSessions()`, ACP `ListSessionsRequest` cursor contract, SDK session list shape, ACP event/session tests, and any `/session/global` compound pagination tests for parity.
- Browser-preview live timeout: `browser-preview/live.ts` `BrowserPreviewLiveSidecar.command()`, live sidecar stdout/stderr protocol, snapshot/input routes in `server/routes/browser-preview.ts`, live-input browser-preview tests.
- Browser-preview evidence corruption: `browser-preview/persist.ts` evidence find/readability helpers, artifact SHA checks, `server/routes/browser-preview.ts` evidence/capture/artifact routes, OpenAPI error schemas, route tests.
- Executor/channel route contracts: `server/routes/executor.ts`, `server/routes/channel.ts`, shared `server/error.ts`, OpenAPI generation, app route tests, channel attachment tests, and SDK consumers.
- Overlay config ownership: `services/config.ts` `patchConfig()` / `updateConfig()` / `syncAgentPromptLocale()`, `ChannelsPanel.tsx`, `NetworkPanel.tsx`, `PermissionsPanel.tsx`, `AgentModelsPanel.tsx`, `GeneralPanel.tsx`, `TitlebarMenubar.tsx`, API directory injection tests, and settings browser evidence.
- Overlay stale project clear: `services/init.ts` `loadConfigInfo()` / `loadSettingsInfo()`, `services/workspace.ts` `closeProject()` / `clearProjectScopeData()`, store setters for config/channels/tool permissions, and config-load timeout tests.
- Task list stale clear: `store/board.ts` `loadTasks()` / `loadTasksOnce()` / pagination generation, `services/workspace.ts` clear path, task-list browser fixtures, and board store tests.
- Acceptance walkthrough browser failures: `acceptance/checks/walkthrough/dsl.ts`, `run.ts`, `dsl.test.ts`, `run.test.ts`, and `RUNTIME_CAPTURE_DEFAULTS` browser-inactivity source.
- Browser Node sidecar activity timeout: `browser/runtime/node-executor.ts`, all `runBrowserNodeSidecar()` callers in webpage/browser-preview/frontend-design/acceptance, node-executor tests, and hard timeout sizing at each caller.
- Browser MCP strictness: `mcp/browser/tools.ts` navigate/screenshot/wait tools, `mcp/browser/sessions.ts` diagnostics collection, `mcp/browser/monitor.ts` screenshot endpoint, MCP browser tests and monitor tests.
- URL capture late errors: `frontend-design/capture-gate.ts`, `url-screenshot-tool.ts`, capture-gate tests, and downstream reference artifact materialization.
- Mission benchmark verdicts: `script/benchmark/mission-scenario.ts`, `mission-benchmark.ts`, benchmark tests, mission-state artifact parsing, and local verification result handling.

## Thirtieth Round Repair And Verification

- ACP list-sessions pagination now uses a compound cursor so rows sharing the boundary `updated` timestamp are not skipped.
- Browser-preview live commands now use sidecar activity as the timeout owner instead of `LIVE_COMMAND_TIMEOUT_MILLISECONDS` wall-clock ownership.
- Browser-preview persisted evidence corruption now fails as corruption instead of collapsing to missing evidence. Executor and channel attachment not-found routes return documented named error shapes.
- Acceptance walkthroughs and Node browser sidecars now fail on request failures/page errors and refresh timeouts on stdout/stderr activity.
- Browser MCP tools now use browser-inactivity waits, reject accumulated diagnostics before/after screenshots and observe, share one CDP screenshot implementation, and the monitor endpoint returns explicit non-200 errors for capture failures instead of cached/blank SVG `200` images.
- URL capture, webpage render/runtime-state/extract, and accepted browser sidecars now run final browser-failure checks before materializing artifacts. Extract keeps optional image/media skip semantics but does not allow script/runtime page failures to pass.
- Mission benchmark terminal readiness now requires completed tasks to carry an evaluation verdict, and unreadable mission state files are retried as activity instead of being treated as empty.
- Overlay settings/config ownership repairs were verified with the settings/browser suite; command-palette and titlebar fixtures now model `/skill/mounts`, preventing screenshot pollution from unrelated fixture 404 toasts.
- The titlebar column-resizer browser test now follows the current right-toolbar initial max-width contract: a freshly opened Inspector remains capped by `--ui-right-toolbar-panel-initial-max-width` instead of expecting the retired equal-width right pane behavior.

Verification commands passed:

- `bun test packages/opencorvus/src/acceptance/checks/walkthrough/dsl.test.ts packages/opencorvus/src/acceptance/checks/walkthrough/run.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/browser/node-executor.test.ts packages/opencorvus/test/runtime/visual-launch.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/mcp/browser-tools-resource.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/mcp/browser-stdio.test.ts --timeout 180000`
- `bun test packages/opencorvus/test/frontend-design/capture-gate.test.ts --timeout 180000`
- `bun test packages/opencorvus/test/browser/webpage/render.test.ts packages/opencorvus/test/browser/webpage/runtime-state.test.ts packages/opencorvus/test/browser/webpage/extract.test.ts --timeout 240000`
- `bun test packages/opencorvus/test/benchmark/mission-benchmark.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/agent-models-panel.test.ts packages/overlay/test/browser/settings-channel-extension-head.test.ts packages/overlay/test/browser/general-panel-fail-fast-browser.test.ts packages/overlay/test/browser/network-proxy-delete-browser.test.ts packages/overlay/test/browser/titlebar-menubar.test.ts packages/overlay/test/browser/command-palette.test.ts packages/overlay/test/browser/executor-selector-redesign.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-menubar.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `git diff --check -- packages/overlay/test/browser/titlebar-menubar.test.ts packages/overlay/test/browser/command-palette.test.ts`

Reviewed visual evidence:

- `.scratch/command-palette-dialog-primitive.png` shows the command dialog centered with no unrelated error toast or clipped rows.
- `.scratch/overlay-minimum-1120-full.png` was re-reviewed after the fixture repair and now shows the minimum legal desktop shell without the earlier `/skill/mounts` 404 toast.
- `.scratch/settings-channel-extension-head.png`, `.scratch/network-proxy-delete-button.png`, and `.scratch/general-settings-fail-fast.png` show the settings controls and error feedback without overlap or hidden actions.
- `.scratch/executor-selector-current-model-listbox.png` and `.scratch/agent-models-zh-cn.png` show selector/listbox density and Chinese settings labels fitting their containers.

## Thirty-First Confirmed Residuals

Independent backend/contract audit found three new non-duplicate issue locations:

- Browser-preview artifact route can throw `BrowserPreviewEvidenceCorruptionError` at runtime, but `GET /task/:taskID/browser-preview/evidence/:evidenceID/artifact/:artifactName` OpenAPI documents only `200/404`. The sibling read/capture routes already document `500`.
- ACP session creation/load/fork/resume can leave a session registered or persisted after initialization fails. Thirtieth repair made MCP attach failure reject, but did not prove the rejected session is removed from ACP manager and storage.
- `GET /session/:sessionID/prompt_async/:taskID` declares named 404 errors but still returns plain `{ message }` for missing task status.

Independent browser evidence/benchmark audit found three new non-duplicate issue locations:

- Static HTML screenshot validation in `frontend-design/output-tools.ts` installs strict browser failure listeners, but the `networkidle` phase is followed by `.catch(() => undefined)`, allowing late browser failures to produce `ok: true` screenshots.
- Browser-preview local module source binding has the same late stabilization swallow, so a broken page can still write `local-fullpage.png`, binding puzzle evidence, and `status: "passed"`.
- Browser-preview scroll-slice comparison also swallows late browser failures after `networkidle`, allowing completed comparison artifacts from a broken page.

Independent Overlay/GUI audit found three new non-duplicate issue locations:

- Skill remove/delete-all/import actions are not bound to the directory whose UI initiated the action. A delayed confirm or file-read path can switch from project A to project B before the service call reads the current global directory or current `appStore.skills`.
- MCP add/delete-all responses carry explicit request directory but still commit returned config through an unguarded path when the active project changed before the response resolves.
- Notification Center groups task notifications by `taskID` and resolves group titles from current `boardStore`, while task actions use persisted `taskDirectory`. After switching projects, title source and action source can diverge.

Local visual-tooling audit found one additional issue location:

- `command-palette.test.ts` and `titlebar-menubar.test.ts` were still exempted from the shared browser error collector. Titlebar screenshots passed while hidden fixture 404s and page errors polluted the UI, including `/skill/mounts`, project discovery, worktree/profile, mission, prompt-profile, and task event endpoints.

Call point recall for the next repair:

- Browser-preview route contracts: `server/routes/browser-preview.ts`, `browser-preview/persist.ts`, `browser-preview-routes.test.ts`, `app-routes.test.ts`, OpenAPI/SDK generation checks.
- ACP failed initialization cleanup: `acp/agent.ts` `newSession()`, `loadSession()`, `unstable_forkSession()`, `unstable_resumeSession()`, `acp/session.ts` manager registration/removal, persisted `Session` rows, ACP event tests.
- Prompt async status contract: `server/routes/session.ts` prompt async routes, `session-prompt-async.test.ts`, `server/error.ts` named error helpers, OpenAPI route contract tests.
- Static HTML and browser-preview late failures: `frontend-design/output-tools.ts`, `browser-preview/local-module-source-binding.ts`, `browser-preview/scroll-slice-comparison.ts`, output incremental/browser-preview tests, and artifact persistence checks.
- Skill/MCP/Notification GUI ownership: `SkillMarketPanel.tsx`, `services/extensions.ts`, `services/mcp.ts`, `services/config.ts`, `NotificationCenter.tsx`, `services/notify.ts`, skill/MCP browser tests, notification browser tests, and project-directory stale-response tests.
- Browser visual error collector: `test/browser/error-collector.ts`, `browser-error-collector.test.ts`, `command-palette.test.ts`, `titlebar-menubar.test.ts`, and all titlebar fixture endpoints used during startup and screenshot capture.

## Thirty-First Round Repair And Verification

Repaired in this round:

- `GET /task/:taskID/browser-preview/evidence/:evidenceID/artifact/:artifactName` now documents the same `BrowserPreviewEvidenceCorruptionError` 500 response that the runtime route can throw for corrupt artifacts.
- `GET /session/:sessionID/prompt_async/:taskID` now throws the shared `NotFoundError` for missing or wrong-source task IDs instead of returning a plain `{ message }` 404 body.
- `TaskQueueService.cancelSessionPrompts()` now synchronously persists matching in-flight `running` queue rows as failed after requesting in-flight cancellation. Session and coding abort callers keep one queue-cancellation entrypoint, and abort responses no longer expose a durable `running` row while the async prompt unwinds.
- `command-palette.test.ts` and `titlebar-menubar.test.ts` now use the shared browser error collector. Their fixtures model startup endpoints used by the real overlay, including `/skill/mounts`, and screenshot assertions now fail on hidden page errors, console errors, unexpected request failures, and unexpected HTTP 404s.
- The scheduler regression now asserts the in-flight row is failed immediately after `cancelSessionPrompts()` returns, before the blocked queue execution is released.

Verification commands passed:

- `bun test packages/overlay/test/browser-error-collector.test.ts --timeout 60000`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/command-palette.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-menubar.test.ts`
- `bun test packages/opencorvus/test/scheduler/task-queue-service.test.ts -t "cancelSessionPrompts stops claimed in-flight wake before it starts a loop" --timeout 60000`
- `bun test packages/opencorvus/test/server/session-prompt-async.test.ts -t "session abort cancels queued prompt_async work" --timeout 60000`
- `bun test packages/opencorvus/test/server/session-prompt-async.test.ts packages/opencorvus/test/scheduler/task-queue-service.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/server/coding-routes.test.ts -t "abort" --timeout 120000`
- `bun test packages/opencorvus/test/server/app-routes.test.ts packages/opencorvus/test/server/browser-preview-routes.test.ts --timeout 120000`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check -- packages/opencorvus/src/scheduler/task-queue-service.ts packages/opencorvus/src/server/routes/browser-preview.ts packages/opencorvus/src/server/routes/session.ts packages/opencorvus/test/server/app-routes.test.ts packages/opencorvus/test/server/session-prompt-async.test.ts packages/opencorvus/test/scheduler/task-queue-service.test.ts packages/overlay/test/browser/command-palette.test.ts packages/overlay/test/browser/titlebar-menubar.test.ts packages/overlay/test/browser-error-collector.test.ts`

Reviewed visual evidence:

- `.scratch/command-palette-dialog-primitive.png` shows the dialog primitive after collector activation with no fixture 404 toast, clipping, or hidden startup error.
- `.scratch/titlebar-run-checkbox-menuitem-focus.png` shows menu focus and checkmark alignment without overflow.
- `.scratch/overlay-minimum-1120-full.png` shows the full desktop shell after titlebar fixture completion, with no `/skill/mounts` toast or unhandled startup route visible.

Still open from Thirty-First residuals:

- ACP failed session initialization cleanup still needs a dedicated root repair.
- Static HTML screenshot, local module source binding, and scroll-slice comparison still need late browser failure checks after stabilization.
- Skill/MCP/Notification GUI ownership needs directory-owned request/commit semantics and browser evidence.

## Thirty-Second Round Repair And Verification

Repaired in this round:

- Static HTML screenshot validation no longer swallows browser failures during optional `networkidle` stabilization. It tags inactivity timeouts separately, only ignores that tag, and keeps a page-level browser failure tracker active through screenshot capture.
- Browser-preview local module source binding now applies the same rule. A valid visible locator on a page that throws during stabilization rejects before `local-fullpage.png`, binding puzzle artifacts, or passed evidence are written.
- Browser-preview scroll-slice comparison now applies the same rule. A page that throws during stabilization rejects before completed comparison artifacts are materialized.
- Browser failure labels now preserve string `message` / `text` payloads, so page-error diagnostics include the actual thrown error text instead of a generic `pageerror`.

Verification commands passed:

- `bun test packages/opencorvus/test/frontend-design/output-incremental-tools.test.ts -t "static HTML screenshot" --timeout 60000`
- `bun test packages/opencorvus/test/browser-preview/navigation-inactivity.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/browser-preview/local-module-source-binding.test.ts -t "late browser page errors" --timeout 90000`
- `bun test packages/opencorvus/test/browser-preview/scroll-slice-comparison.test.ts -t "late browser page errors" --timeout 90000`
- `bun test packages/opencorvus/test/frontend-design/output-incremental-tools.test.ts packages/opencorvus/test/browser-preview/navigation-inactivity.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/browser-preview/local-module-source-binding.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/browser-preview/scroll-slice-comparison.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check -- packages/opencorvus/src/frontend-design/output-tools.ts packages/opencorvus/src/browser-preview/local-module-source-binding.ts packages/opencorvus/src/browser-preview/scroll-slice-comparison.ts packages/opencorvus/test/frontend-design/output-incremental-tools.test.ts packages/opencorvus/test/browser-preview/navigation-inactivity.test.ts packages/opencorvus/test/browser-preview/local-module-source-binding.test.ts packages/opencorvus/test/browser-preview/scroll-slice-comparison.test.ts specs/new-arch/2026-06-27-bug-hunt-residual-convergence.md`

Still open from Thirty-First residuals after this repair:

- ACP failed session initialization cleanup still needs a dedicated root repair.
- Skill/MCP/Notification GUI ownership needs directory-owned request/commit semantics and browser evidence.

## Thirty-Third Round Repair And Verification

Repaired in this round:

- ACP failed `newSession()` initialization now removes the rejected session from the in-memory manager and deletes the newly persisted session row.
- ACP failed `loadSession()` and `unstable_resumeSession()` now restore any previous manager state for the same session ID, or unregister the failed load when no previous manager state existed. Existing persisted sessions are not deleted on load/resume failure.
- ACP failed `unstable_forkSession()` now removes the rejected forked child from the manager and deletes the newly persisted forked session.
- Cleanup failures are no longer hidden behind the original initialization error. The caller receives an `AggregateError` containing both the initialization error and the cleanup error, so the rejected session state cannot be silently left behind.
- The ACP session manager now exposes explicit snapshot/restore semantics, keeping cleanup ownership in one place instead of duplicating partial delete paths.

Verification commands passed:

- `bun test packages/opencorvus/test/acp/event-subscription.test.ts -t "unstable_forkSession rejects when forked history cannot be fetched" --timeout 60000`
- `bun test packages/opencorvus/test/acp/event-subscription.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check -- packages/opencorvus/src/acp/agent.ts packages/opencorvus/src/acp/session.ts packages/opencorvus/test/acp/event-subscription.test.ts`

Independent ACP cleanup audit result:

- No additional ACP failed-initialization cleanup issue was found after the focused repair. The remaining ACP risks identified by prior audits are in separate attachment/replay surfaces already covered by existing tests in `event-subscription.test.ts`.

## Thirty-Third Confirmed Residuals

Independent mission-route contract audit found one new non-duplicate issue cluster:

- Mission routes that call `missionRouteSession()` can throw `NotFoundError` at runtime for missing or wrong-directory mission IDs, but several OpenAPI contracts omit the named `404` response: `GET /mission/:missionID/status`, `POST /mission/:missionID/project-archive`, `PATCH /mission/:missionID/title`, `POST /mission/:missionID/abort`, and `DELETE /mission/:missionID`.

Independent Overlay/GUI ownership audit confirmed the remaining Skill/MCP/Notification cluster and added one missing edge:

- Skill remove/delete-all/import actions are still not fully bound to the directory whose UI initiated the action.
- MCP add/delete-all responses still commit returned config through unguarded paths when the active project changes before the response resolves.
- Notification Center display title source and action source can diverge after project switches because titles are resolved from current board state while actions use persisted `taskDirectory`.
- Notification action failure reporting drops `taskDirectory`, so the error notification can be attached to the wrong project scope.

Call point recall for the next repair:

- Mission route 404 contracts: `packages/opencorvus/src/server/routes/mission.ts`, `packages/opencorvus/src/mission/session.ts`, `packages/opencorvus/test/server/mission-routes.test.ts`, `packages/opencorvus/test/server/app-routes.test.ts`, OpenAPI generation, and SDK generated response/error types.
- Overlay Skill/MCP/Notification ownership: `packages/overlay/src/components/settings/SkillMarketPanel.tsx`, `packages/overlay/src/services/extensions.ts`, `packages/overlay/src/services/mcp.ts`, `packages/overlay/src/services/config.ts`, `packages/overlay/src/components/NotificationCenter.tsx`, `packages/overlay/src/services/notify.ts`, `packages/overlay/test/extensions-service.test.ts`, `packages/overlay/test/mcp-service.test.ts`, `packages/overlay/test/browser/skill-mcp-panel-browser.test.ts`, and `packages/overlay/test/browser/notification-center-task-action-browser.test.ts`.

Still open after this repair:

- Mission route 404 OpenAPI/SDK contract drift needs a root repair.
- Skill/MCP/Notification GUI ownership needs directory-owned request/commit semantics and browser evidence.

## Thirty-Fourth Round Repair And Verification

Repaired in this round:

- Mission detail routes now document the named `NotFoundError` 404 response wherever `missionRouteSession()` can throw at runtime: status, project archive, rename, abort, and delete.
- Runtime coverage now exercises all five missing-Mission detail operations and asserts the response body is the named `NotFoundError`, not a plain or mismatched error shape.
- Static `packages/sdk/openapi.json` and generated JS SDK types were regenerated through `packages/sdk/js/script/build.ts`, so the SDK/OpenAPI artifacts carry the same Mission 404 contracts as `Server.openapi()`.
- The full Mission route suite exposed a deeper delete ownership defect: Mission delete found the correct global row by directory, then `EngineService.deleteSession()` re-looked it up in the current bootstrapped project and failed after project identity drift. `EngineService.deleteSession()` now accepts an explicit project ID, and Mission delete passes the project ID from the resolved Mission session row.

Verification commands passed:

- `bun test packages/opencorvus/test/server/mission-routes.test.ts -t "Mission detail routes return named NotFoundError" --timeout 60000`
- `bun test packages/opencorvus/test/server/app-routes.test.ts -t "Mission detail not-found responses" --timeout 60000`
- `bun ./packages/sdk/js/script/build.ts`
- `bun test packages/opencorvus/test/server/mission-routes.test.ts -t "project identity drifted" --timeout 60000`
- `bun test packages/opencorvus/test/server/mission-routes.test.ts packages/opencorvus/test/server/app-routes.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run api:routes-check`
- `bun run --cwd packages/sdk/js typecheck`
- `bun test packages/opencorvus/test/server/session-routes.test.ts -t "DELETE /session" --timeout 90000`
- `bun test packages/opencorvus/test/task-api/delete-task-breadcrumb.test.ts packages/opencorvus/test/task-api/delete-session-delete-tasks-settle.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/server/coding-routes.test.ts -t "delete" --timeout 120000`
- `bun test packages/opencorvus/test/tool/panel.test.ts -t "delete_session" --timeout 90000`
- `git diff --check -- packages/opencorvus/src/server/routes/mission.ts packages/opencorvus/src/task-api/index.ts packages/opencorvus/test/server/mission-routes.test.ts packages/opencorvus/test/server/app-routes.test.ts packages/sdk/openapi.json packages/sdk/js/src/gen/types.gen.ts packages/sdk/js/src/gen/sdk.gen.ts`

Still open after this repair:

- Skill/MCP/Notification GUI ownership needs directory-owned request/commit semantics and browser evidence.

## Thirty-Fifth Round Repair And Verification

Repaired in this round:

- Skill service mutations now accept a directory-owned request option. `installSkill()`, `removeSkillSource()`, `deleteSkill()`, import helpers, `deleteAllSkills()`, and `loadInstalledSkills()` send the initiating directory explicitly instead of reading whatever project is active when the async operation finally reaches `apiJson()`.
- Skill delete-all now accepts the already-confirmed skill list from the UI. A delayed confirm can no longer switch the removal set from project A to project B by re-reading `appStore.skills` after the user changes projects.
- `SkillMarketPanel` captures the initiating directory before destructive confirms, FileReader work, install/import calls, and MCP config mutations. Store refreshes and visible notices are only committed while that captured directory still owns the panel.
- MCP config writes now share the same `ConfigRequestOptions` ownership contract as project config. Stale explicit-directory responses can complete their server-side request without replacing the active project's `appStore.config`.
- Notification items now persist both `taskDirectory` and `taskTitle`. Notification Center renders group labels and open-button labels from the notification item instead of the current board, and task-action failure notifications keep the original `taskDirectory`.

Verification commands passed:

- `bun test packages/overlay/test/project-directory-request-loop.test.ts packages/overlay/test/left-activity-toolbar.test.ts packages/overlay/test/notification-center-primitive.test.ts --timeout 120000`
- `bun test packages/overlay/test/extensions-service.test.ts packages/overlay/test/mcp-service.test.ts packages/overlay/test/config-update-single-source.test.ts --timeout 120000`
- `bun test packages/overlay/test/notify-error-persistence.test.ts packages/overlay/test/notification-reliability.test.ts --timeout 120000`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `git diff --check -- packages/overlay/src/services/extensions.ts packages/overlay/src/services/mcp.ts packages/overlay/src/components/settings/SkillMarketPanel.tsx packages/overlay/src/services/notify.ts packages/overlay/src/components/NotificationCenter.tsx packages/overlay/test/extensions-service.test.ts packages/overlay/test/mcp-service.test.ts packages/overlay/test/project-directory-request-loop.test.ts packages/overlay/test/left-activity-toolbar.test.ts packages/overlay/test/notification-center-primitive.test.ts packages/overlay/test/notification-reliability.test.ts packages/overlay/test/notify-error-persistence.test.ts`
- `node test/browser-runner.mjs test/browser/skill-mcp-panel-browser.test.ts test/browser/notification-center-task-action-browser.test.ts`

Reviewed visual evidence:

- `packages/overlay/.scratch/notification-task-action-toast.png` shows the task notification toast with Open, details, copy, and close controls in a readable order without overlap.
- `packages/overlay/.scratch/notification-dismissed-panel-readable.png` and `packages/overlay/.scratch/notification-panel-width-fill.png` show the notification panel group title, count, and action buttons using the full panel width.
- `.scratch/skill-mcp-status-pills.png` shows MCP status pills aligned with server names and descriptions without truncation or overlap.
- `.scratch/skill-mcp-delete-confirm.png` shows the delete-all confirmation dialog centered with readable copy and visible actions.
- `.scratch/skill-mcp-delete-failure.png` shows the MCP delete failure surfaced in the compact panel with the explicit directory query visible in the failed route.

Still open after this repair:

- No remaining item from the Thirty-Third Overlay/GUI ownership cluster is known after the focused repair. A new independent-agent iteration is required before declaring convergence.

## Thirty-Sixth Confirmed Residuals

Independent backend/API contract audit found three new non-duplicate issue clusters:

- Config PATCH routes document named `BadRequestError` 400 responses, but project config update and session config update still return plain `{ error }` bodies for semantic validation failures such as invalid provider or unknown prompt profile.
- Global DB reset/import routes document shared named 409 errors, but active-session destructive-operation conflicts return plain `{ error }` bodies.
- `GET /experimental/task-plan` and `GET /experimental/scratchpad` call `Session.getInProject()` and can throw `NotFoundError` for missing or wrong-project sessions, while OpenAPI/SDK currently declare only 200 responses for these operations.

Independent Overlay/GUI audit found three new non-duplicate issue clusters:

- Provider panel Test / Save / Delete operations capture a request directory but do not consistently guard response commits and test-result state by the initiating directory.
- Prompt Profile save/delete/activate/import operations pass a directory to config helpers, but do not pass an ownership predicate, and component reload/notice paths re-read the current scope after mutation.
- Browser visual tests still have broad error-collector opt-outs for screenshot-producing suites such as provider, prompt-profile, left-tool, and skill/MCP panels. Hidden 404/pageerror/console errors can still pass visual screenshots outside the suites repaired in the Thirty-First round.

Independent scheduler/tooling audit found one new non-duplicate issue cluster:

- `tool.truncation.cleanup` is registered as a global scheduler task, but its cleanup logic reads ambient `Instance.directory` from the first bootstrapped project. Later projects can generate stale `tool-output/tool_*` files that the global timer never scans.

Call point recall for the next repair:

- Experimental task-plan/scratchpad contracts: `packages/opencorvus/src/server/routes/experimental.ts`, `packages/opencorvus/test/server/session-artifact-routes.test.ts`, `packages/opencorvus/test/server/app-routes.test.ts`, OpenAPI generation, and JS SDK generated response/error types.
- Config 400 contracts: `packages/opencorvus/src/server/routes/config.ts`, `packages/opencorvus/src/server/routes/session.ts`, `packages/opencorvus/test/server/config-routes.test.ts`, `packages/opencorvus/test/server/config-patch-provider.test.ts`, `packages/opencorvus/test/server/session-routes.test.ts`, OpenAPI generation, and JS SDK generated error types.
- Global DB destructive conflict contracts: `packages/opencorvus/src/server/routes/global.ts`, `packages/opencorvus/test/server/global-db-destructive.test.ts`, OpenAPI generation, and JS SDK generated error types.
- Provider and Prompt Profile directory ownership: `packages/overlay/src/components/settings/ProvidersPanel.tsx`, `packages/overlay/src/components/settings/PromptCatalog.tsx`, `packages/overlay/src/services/config.ts`, related provider/prompt browser tests, and project-directory stale-response tests.
- Browser error collector opt-outs: `packages/overlay/test/browser-error-collector.test.ts`, `packages/overlay/test/browser/error-collector.ts`, and the screenshot-producing browser suites still allowlisted there.
- Tool truncation cleanup ownership: `packages/opencorvus/src/tool/truncation.ts`, `packages/opencorvus/src/scheduler/index.ts`, `packages/opencorvus/src/project/bootstrap.ts`, `packages/opencorvus/src/tool/tool.ts`, `packages/opencorvus/src/tool/registry.ts`, `packages/opencorvus/src/session/loop.ts`, and tool truncation scheduler tests.

## Thirty-Sixth Round Repair And Verification

Repaired in this round:

- `GET /experimental/task-plan` now documents the named 404 response that `Session.getInProject()` already throws for missing or wrong-project sessions.
- `GET /experimental/scratchpad` now documents the same named 404 response for missing or wrong-project sessions.
- OpenAPI runtime coverage now includes both experimental memory routes in a focused not-found response assertion.
- Static `packages/sdk/openapi.json` and generated JS SDK types were regenerated through `packages/sdk/js/script/build.ts`, adding `ExperimentalTaskplanListErrors` and `ExperimentalScratchpadGetErrors`.

Verification commands passed:

- `bun test packages/opencorvus/test/server/app-routes.test.ts -t "browser-preview and panel memory not-found responses" --timeout 60000` failed before the route contract fix at the missing experimental 404 response.
- `bun test packages/opencorvus/test/server/app-routes.test.ts -t "experimental task memory not-found responses" --timeout 60000` passed after the route contract fix and is the focused regression for this repair.
- `bun test packages/opencorvus/test/server/session-artifact-routes.test.ts -t "todo, task-plan, and scratchpad reads reject sessions outside the active project" --timeout 60000`
- `bun ./packages/sdk/js/script/build.ts`
- `bun test packages/opencorvus/test/server/app-routes.test.ts packages/opencorvus/test/server/session-artifact-routes.test.ts --timeout 120000`
- `bun run api:routes-check`
- `bun run --cwd packages/sdk/js typecheck`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run ./packages/opencorvus/script/docs/render-api-md.ts --check`
- `git diff --check -- packages/opencorvus/src/server/routes/experimental.ts packages/opencorvus/test/server/app-routes.test.ts packages/sdk/openapi.json packages/sdk/js/src/gen/types.gen.ts packages/sdk/js/src/gen/sdk.gen.ts specs/new-arch/2026-06-27-bug-hunt-residual-convergence.md`

Still open after this repair:

- Config PATCH named 400 response/body drift.
- Global DB destructive active-session 409 response/body drift.
- Provider panel directory-owned response/test-result state.
- Prompt Profile directory-owned mutation reload/notice state.
- Browser error collector opt-outs for screenshot-producing browser suites.
- `tool.truncation.cleanup` global scheduler vs project runtime-root ownership mismatch.

## Thirty-Seventh Round Repair And Verification

Repaired in this round:

- Project `PATCH /config` semantic 400 branches now return the documented shared `BadRequestError` body (`success: false`, `data.message`, and `errors[].message`) instead of a parallel plain `{ error }` shape.
- `PATCH /session/:sessionID/config` now uses the same `BadRequestError` body for unknown prompt-profile rejection, matching its existing OpenAPI/SDK 400 declaration.
- The shared server error module now exposes `badRequestBody()` as the single reusable constructor for runtime branches that intentionally return the generic `BadRequestError` schema.
- Config route tests now assert the runtime 400 body shape for malformed provider records, malformed provider entries, deprecated provider model status, and unknown prompt profiles.
- Session route coverage now asserts the unknown prompt-profile rejection body, not only the 400 status and no-write behavior.
- While re-running `config-routes`, an existing prompt/test phrase drift was exposed. The config prompt test now pins stable native-agent prompt semantics that are present in both the current prompt text and the clean HEAD prompt text instead of an obsolete exact phrase.

Verification commands passed:

- `bun test packages/opencorvus/test/server/config-patch-provider.test.ts packages/opencorvus/test/server/config-routes.test.ts packages/opencorvus/test/server/session-routes.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/server/config-routes.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/server/mcp-routes.test.ts packages/opencorvus/test/server/mission-routes.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/server/global-db-destructive.test.ts -t "DB reset rejects projectDir input|DB reset rejects a mismatched database target" --timeout 60000`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/sdk/js typecheck`
- `bun run api:routes-check`
- `bun run ./packages/opencorvus/script/docs/render-api-md.ts --check`
- `git diff --check -- packages/opencorvus/src/server/error.ts packages/opencorvus/src/server/routes/config.ts packages/opencorvus/src/server/routes/session.ts packages/opencorvus/src/server/routes/mcp.ts packages/opencorvus/src/server/routes/global.ts packages/opencorvus/src/server/routes/mission.ts packages/opencorvus/test/server/config-patch-provider.test.ts packages/opencorvus/test/server/config-routes.test.ts packages/opencorvus/test/server/session-routes.test.ts`

Independent-agent findings received during this round:

- Backend/API: request-origin rejection currently maps to 500 instead of 403; `HTTPException` branches in task/orchestrator routes can emit plain-text bodies while route contracts declare JSON errors; the session-config PATCH drift is covered by this round.
- Overlay/GUI: overlay browser sidecar RPC timeout is fixed-duration instead of inactivity-based; route callback exceptions in the browser launch wrapper are swallowed by `route.continue()`; workspace command launchers can commit stale error/loading state after directory switch.
- Scheduler/tooling: tool-output cleanup can delete fresh files around identifier timestamp wrap; wait-cron early activity and event scheduler subscriptions are instance-scoped and can miss worktree/session activity.

Still open after this repair:

- Global DB destructive active-session 409 response/body drift.
- Provider panel directory-owned response/test-result state.
- Prompt Profile directory-owned mutation reload/notice state.
- Browser error collector opt-outs for screenshot-producing browser suites.
- `tool.truncation.cleanup` global scheduler vs project runtime-root ownership mismatch.
- Request-origin forbidden status mapping to 403.
- Task/orchestrator `HTTPException` plain-text response contract drift.
- Overlay browser sidecar inactivity timeout and route callback failure propagation.
- Workspace command launcher stale directory-owned GUI state.
- Tool-output cleanup identifier timestamp wrap data-loss risk.
- Wait-cron and event scheduler cross-instance activity visibility gaps.

## Thirty-Eighth Round Repair And Verification

Repaired in this round:

- `RequestOriginForbiddenError` now maps to HTTP 403 in the single server `namedErrorStatus()` source used by `serverErrorResponse()`.
- `request-origin` rejection through the real `Server.App()` path now returns the structured `RequestOriginForbiddenError` body and prevents `POST /task` state mutation.
- `onerror-mapping` coverage no longer maintains a copied status table. Its probe uses the real `serverErrorResponse()` function, so future NamedError status drift is observable through the same runtime path.
- Added explicit mapping coverage for `RequestOriginForbiddenError -> 403`.

Verification commands passed:

- `bun test packages/opencorvus/test/server/request-origin.test.ts packages/opencorvus/test/server/onerror-mapping.test.ts --timeout 60000` failed before the fix with hostile origin returning 500 instead of 403.
- `bun test packages/opencorvus/test/server/request-origin.test.ts packages/opencorvus/test/server/onerror-mapping.test.ts --timeout 60000`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run api:routes-check`

Still open after this repair:

- Global DB destructive active-session 409 response/body drift.
- Provider panel directory-owned response/test-result state.
- Prompt Profile directory-owned mutation reload/notice state.
- Browser error collector opt-outs for screenshot-producing browser suites.
- `tool.truncation.cleanup` global scheduler vs project runtime-root ownership mismatch.
- Task/orchestrator `HTTPException` plain-text response contract drift.
- Overlay browser sidecar inactivity timeout and route callback failure propagation.
- Workspace command launcher stale directory-owned GUI state.
- Tool-output cleanup identifier timestamp wrap data-loss risk.
- Wait-cron and event scheduler cross-instance activity visibility gaps.
