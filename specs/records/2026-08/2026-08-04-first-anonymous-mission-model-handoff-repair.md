# First Anonymous Mission Model Handoff Repair

## Recall

### User requirement

- “现在的第一次匿名项目创建必定失败，即使我选择了模型，分析解决这个bug”.
- The first real Mission submission from a directory-free Composer must create
  its anonymous Project and start the Mission successfully with the explicitly
  selected model.

### Acceptance criteria

- A selected Composer model is captured before anonymous Project allocation or
  activation can change the active frontend projection.
- The first `POST /mission/wake` for the new anonymous Project contains that
  exact model and persists it as the Mission root Session `configOverlay.model`.
- A successful first submission creates one anonymous Project and one Mission
  root Session; no failed empty Project is left behind by a missing-model 400.
- Existing project-scoped Mission submissions keep using the same request
  contract.
- Focused non-User-Interface service tests prove the ordering and exact wake
  request. No User-Interface automated test is added, changed, or run.

### Hard constraints

- Do not introduce a default model, fallback model, model alias, retry, route
  gate, compatibility request, or second model source.
- Preserve the Composer as the only frontend model projection and
  `/mission/wake` as the only Mission creation boundary.
- Preserve the unrelated worktree modification in
  `packages/opencorvus/src/skill/builtin-payload.ts`.
- Do not restart or stop the user's packaged Overlay or mutate its database.
- Any real-page interaction must use Node.js and manual visual review; it must
  not be saved as a User-Interface test.

### Sources read

- `AGENTS.md`.
- `specs/current/architecture/06-provider.md` and
  `specs/current/architecture/07-panel.md`.
- `specs/records/2026-08/2026-08-03-startup-anonymous-project-allocation-repair.md`.
- `specs/records/2026-07/2026-07-29-global-new-chat-lazy-project-persistence.md`.
- `specs/records/2026-07/2026-07-29-global-new-chat-model-handoff-repair.md`.
- `packages/overlay/src/main.tsx`.
- `packages/overlay/src/services/{composer-model,mission,workspace}.ts`.
- `packages/overlay/test/workspace-active-directory.test.ts`.
- `packages/opencorvus/src/server/routes/mission.ts` and
  `packages/opencorvus/test/server/mission-wake-model-persistence.test.ts`.
- The current packaged backend health response, process identity, bounded log
  snapshot, and read-only SQLite rows described below.

### Whole-repository search

Repository-wide searches enumerated every `resolveGlobalComposerProject`,
`wakeMission`, `createAnonymousProject`, `composerModel`, Mission wake model
schema, and missing-model error reference. The single failing frontend path is
the global Mission branch in `main.tsx`; the Mission transport and backend
route already accept and durably persist an explicit model.

### Independent agent feedback

- None. The user did not request sub-agents. The failing transition has one
  tightly coupled frontend submission owner.

## Runtime evidence

- Snapshot time: 2026-08-04 Asia/Singapore.
- Backend: `http://127.0.0.1:7878`, version `0.0.29-beta`.
- Database path returned by `/global/health`:
  `C:\Users\chuan\AppData\Local\opencorvus\data\opencorvus.db`.
- Packaged backend process: PID 6796, embedded `opencorvus.exe`, started
  2026-08-03 23:53:24 Asia/Singapore.
- Task-root and Orchestrator Session identities: not applicable. The failure
  occurs before a Mission root Session or child Task is created.

### Visible request chronology

Three independent first submissions showed the same sequence:

1. `POST /global/projects/anonymous` completed with HTTP 201.
2. The immediately following `POST /mission/wake` completed with HTTP 400 and
   `MissingModelConfigError`, agent `mission`.
3. A later submission in the already activated Project completed with HTTP 200.

The concrete failing pairs occurred at 15:55:56/15:55:58,
15:57:11/15:57:14, and 16:02:28/16:02:35 UTC on 2026-08-03.

### Durable database evidence

- The three anonymous Project rows exist.
- The first two Projects gained Mission root Sessions only after the later
  successful wake; both Session metadata rows contain
  `configOverlay.model = "hexin/gpt-5.6-sol"`.
- The newest failed Project has no Session row.
- No Engine Task row exists for these failed first submissions.

## Causal chain

Observable symptom: the first submission leaves an anonymous Project but shows
a missing-model failure even though the Composer displayed a selected model.

Direct trigger: the global Mission submit branch awaits
`resolveGlobalComposerProject()` before reading `appStore.composerModel`.
Anonymous allocation and activation switch the active directory and reload the
frontend Project projection before the read occurs.

Owning cause: the submission did not take an immutable draft snapshot before
its first asynchronous ownership transition. The backend correctly rejects a
Mission with neither an explicit request model nor an effective persisted
model, and therefore creates no Mission Session.

Why retry appears to recover: after activation, selecting the model again is
now scoped to the active Project/Session path, so a later wake carries or
resolves the model and succeeds. That reaction does not repair the initial
submission and leaves the failed empty Project visible.

Provider connectivity is disproven as the cause: later wakes use
`hexin/gpt-5.6-sol` successfully, and the persisted successful Session rows
contain the exact selected model.

## Implementation plan

1. Introduce one submission-context owner that snapshots the trimmed Composer
   model synchronously, then resolves the global anonymous Project.
2. Use that snapshot in the global Mission submit branch so the existing
   `wakeMission` transport receives the exact model after activation.
3. Add a positive non-User-Interface service regression proving a model chosen
   before allocation survives an asynchronous Project activation and is sent
   in the first wake request.
4. Run the focused Overlay service tests and typecheck, then exercise the real
   first-submission route against an isolated backend if the repository's
   existing launch tooling permits it without touching the packaged runtime.
5. Re-read the diff and persisted test evidence, update this verification
   record, commit with the required `dsw-33987` prefix, and push the main
   delivery branch to `myhexin`.

## Verification record

- `packages/overlay`: `bun test --timeout=0
  test/workspace-active-directory.test.ts` passed 28 tests with 129
  assertions. The focused regression changes the live Composer projection
  while anonymous allocation is pending, then proves the first two write
  requests are anonymous Project creation and Mission wake and that the wake
  body retains `hexin/gpt-5.6-sol`.
- `packages/overlay`: `bun run typecheck` passed.
- Documentation verification passed 70 tests with 1,188 assertions across
  historical links, product single-source contracts, and document health.
- `packages/opencorvus`: the focused existing positive Mission persistence
  contract passed 1 test with 8 assertions, proving the request model is
  stored before the initial wake and reused by later natural wakes. A broader
  run passed its product assertions but three unrelated cleanup phases hit
  Windows `EBUSY` while removing owned temporary fixture directories; the
  focused rerun completed cleanly.
- Real isolated acceptance used the current source backend on
  `127.0.0.1:17878`, Vite Overlay on `http://localhost:5173/`, and dedicated
  `OPENCORVUS_HOME` under `.scratch/anonymous-mission-model-e2e`. The page was
  connected through visible Network settings, selected `hexin/gpt-5.5`, added
  the `general` Mission Skill, and submitted once from the directory-free
  Composer.
- Read-only SQLite verification after that one submission found exactly one
  anonymous Project and one Mission root Session. The Session metadata and
  first user message both persisted `hexin/gpt-5.5`; no failed empty Project
  or missing-model response occurred.
- The real screenshot was personally reviewed: the single anonymous Project
  contains the running Mission, the Conversation shows live Mission output,
  and the Composer still displays `hexin/gpt-5.5` without an error surface or
  duplicate Project.
- The isolated browser tab, Vite process tree, backend process tree, and owned
  supervisor were stopped after acceptance. Ports 5173 and 17878 were verified
  released. The user's packaged backend on port 7878 was not restarted or
  mutated.
