# Chat Default Assistant Routing

## Recall

### User request

- Ordinary Chat must route to Assistant by default.
- Sending a greeting such as `你好` must not implicitly create a task or enter an expert-squad/Mission execution path.

### Acceptance criteria

- `composerMode === "chat"` is authoritative for new Chat submission even when a stale task or Mission session remains selected.
- A new Chat submission creates and selects a Coding Assistant session for the explicit active project directory, then sends the user message through `session/:id/prompt_async`.
- `panelMessage` never creates a task when no task or session is selected.
- Task follow-up remains available only when the caller has explicitly selected the task/Mission route.
- Mission launch remains explicit and keeps `prompt_profile.active` as the only expert-squad selection source.
- Focused service tests, Overlay routing tests, a real rendered browser screenshot, historical-document links, and `git diff --check` pass.

### Hard constraints

- No fallback directory, compatibility route, hidden active-squad state, UI-only filter, keyword classifier, gate, or state machine.
- Do not restore implicit `createTask()` behavior under another name.
- Do not restart, refresh, close, or kill the user's running OpenCorvus/overlay process; browser verification must use an isolated test server.
- Preserve unrelated dirty-worktree edits and do not create another worktree.

### Landed sources read before implementation

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-13-chat-lifecycle-and-work-ledger-icon-repair.md`
- `specs/records/2026-07/2026-07-11-platform-runtime-external-goal-team.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`

### Whole-repository search evidence

The pre-change inventory used `rg` for `panelMessage`, `createTask`, `createCodingAssistantSession`, `assistantSubmitActive`, `composerMode`, `prompt_profile.active`, `select_expert_squad`, `PromptProfileResolver`, and coding-session routes across `packages/overlay/src`, `packages/overlay/test`, `packages/opencorvus/src`, `packages/opencorvus/test`, and `specs`.

| Call point | Current behavior | Disposition |
| --- | --- | --- |
| `packages/overlay/src/main.tsx::assistantSubmitActive` | Chat is considered a new Assistant launch only when no task/session is selected | Replace with explicit Chat intent plus current Coding Assistant identity; stale non-Chat selection cannot override Chat intent |
| `packages/overlay/src/main.tsx::ChatComposer.onSubmit` | Assistant creation is skipped when `activeDirectory()` is empty, then submission falls through | Require an explicit project directory and create the Assistant session before sending |
| `packages/overlay/src/services/chat.ts::panelMessage` | No session/task implicitly calls `createTask()` | Delete implicit task creation; reject a targetless call |
| `packages/overlay/src/services/dialog.ts` | Goal dialog calls `panelMessage` with an explicitly selected task | Preserve explicit task follow-up semantics |
| `packages/overlay/test/panel-message-new-task-directory.test.ts` | Asserts the retired implicit task creation behavior | Replace with a negative regression proving no task request occurs |
| Coding Assistant service/routes | Already create, claim, hydrate, and prompt project-scoped Assistant sessions | Reuse unchanged as the single Chat lifecycle |
| Expert-squad resolver/catalog | Own active capability projection through `prompt_profile.active` | Keep unchanged; this routing repair must not create a second squad source |

No independent agents were used because the user did not request delegation.

## Root cause

The visible composer intent and the message transport disagreed. The UI defaulted to Chat, but `assistantSubmitActive` yielded ownership to any residual task/session selection. If the Assistant session was not created, the generic `panelMessage` transport silently converted the message into a new task. That implicit conversion is why a greeting appeared to enter expert-team execution even though no expert squad had actually been selected.

## Design

1. Treat the explicit composer mode as routing intent: Chat routes only to Coding Assistant; Mission/task routes remain explicit.
2. Require the active project directory when starting a new Assistant session. Absence is an actionable error, not a default-directory fallback.
3. Make `panelMessage` a transport for an already-selected session or task. It must never manufacture a task.
4. Keep task creation in the existing explicit task/Mission APIs and keep expert-squad selection in `prompt_profile.active`.

## Verification log

- Red: the targetless `panelMessage` regression resolved successfully after issuing a real `/task` request, proving the ordinary Chat transport still created a task implicitly. The static routing assertions also failed because residual task/session state overrode `composerMode === "chat"`.
- Green: 10 focused Chat/Assistant/Mission routing tests passed with 146 assertions. The targetless transport now rejects before any request; explicit Chat creates an Assistant session first.
- Coding Assistant lifecycle: 6/6 focused service tests passed, including explicit directory propagation for create, claim, hydrate, stream, rename, stop, and delete.
- Real browser: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-default-assistant-browser.test.ts` passed. The rendered Chinese Overlay submitted `你好`, observed exactly one Coding Assistant session creation and one `session/:id/prompt_async` call, observed zero `/task` creation calls, and wrote `.scratch/chat-default-assistant-routing.png`.
- Visual review: the screenshot was opened at original resolution. The center title and composer intent remained `Chat`; the persisted `你好` appeared as an ordinary user message, with no Mission/expert-squad launch card or visual routing regression.
- Overlay TypeScript check passed: `bun run --cwd packages/overlay typecheck`.
- Historical-document links passed 20/20 and product-document single-source checks passed 4/4.
- `git diff --check` passed. The final grep leaves `createTask` only in the explicit task service; `packages/overlay/src/services/chat.ts` contains no task creation call.

## Repository-wide blockers outside this repair

- The broader `runtime-directory-actions.test.ts` currently has five unrelated failures from concurrent worktree changes: missing canonical message `agentID`, broken registered session-directory lookup, a changed board refresh request/notification contract, and an explicit notification target hydration mismatch. All tests directly changed or added by this repair pass.
- The full `PromptProfileResolver` file has three existing five-second timeout failures and two failures because the concurrently edited built-in `general` manifest projects `default/skill/multica-import` while the test fixture does not provide that skill. This repair does not alter the manifest, resolver, or active expert-squad source.
- The pre-existing expert-squad selector browser test intentionally returns HTTP 500 for catalog reload. Its local collector allows that expected response, but the browser sidecar collector still reports the console resource error at shutdown. Both screenshot scenarios pass; the new no-fault-injection Chat routing browser test is fully green.
