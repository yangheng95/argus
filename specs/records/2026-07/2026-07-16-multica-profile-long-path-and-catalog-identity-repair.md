# Multica profile long-path and catalog identity repair

## Recall

### Original request

The user supplied a real Overlay screenshot showing `POST /mission/wake` failing with HTTP 400 because the composer sent unknown prompt profile `multica-803e3d6b708f47f19c48ef0219d675f3` for `D:\yerui\code\7X24Agent\nova-vibecoding-template-0716-2\nova-vibecoding-template`. The request is to investigate and repair the failure, not to suppress the error dialog.

### Acceptance criteria

1. A Multica package whose canonical project path exceeds the legacy Windows path limit can be staged by every OpenCorvus-owned Git process used by task startup and checkpointing.
2. The composer exposes expert-squad options, active identity, and projected Skills only when the loaded catalog belongs to the exact current directory/session/refresh identity.
3. Switching project/task scope clears the previous catalog synchronously while the new catalog is pending; submitting a Mission cannot reuse a profile from the previous catalog.
4. A task terminal edge invalidates the project expert-squad catalog because task work can install, replace, or remove project packages.
5. The backend keeps strict `PromptProfileResolver.assertKnownProfileID` validation. No unknown-ID fallback, alias, auto-install, auto-activation, or cross-project package lookup is introduced.
6. Focused regressions cover the Windows Git command contract, real long-path staging on Windows, catalog identity projection, canonical project-directory scope, and terminal-edge invalidation.
7. An isolated real Overlay page is exercised with Node-launched browser tooling and a task-scoped screenshot is manually reviewed. The user's running OpenCorvus/Overlay process is not restarted, refreshed, or stopped.
8. Specs indexes, document health, focused typechecks/tests, `git diff --check`, a second review, a `dsw-33987` commit, and a `legacy-remote` push are completed without staging unrelated worktree changes.

### Hard constraints

- Preserve `.opencorvus/expert-squads/<namespace>/<id>` and manifest `id` as the only package/identity sources. `prompt_profile.active` and `PromptProfileResolver` remain the only active projection path.
- Fix the Git toolchain and catalog ownership directly. Do not add a host gate, state machine, retry route, fallback profile, compatibility alias, shortened Multica identity, silent package provisioning, or hidden/synthetic message.
- Use the existing `activeProjectDirectory()` service as the canonical Overlay directory projection instead of creating another settings/task directory branch.
- Keep catalog state atomic: catalog identity, squad options, projected Skills, and active ID are one snapshot rather than independently mutable signals.
- All edits stay in the Windows host main worktree. No worktree, reset, stash, destructive recovery, or intervention in the live Overlay process.
- Preserve all unrelated dirty files. The current shared worktree contains an in-progress Mailbox batch, including unrelated edits in `packages/overlay/src/main.tsx`.

### Sources read before implementation

- `AGENTS.md`
- `specs/README.md` and `specs/records/2026-07/README.md`
- `specs/current/architecture/01-agents.md`, `04-extensions.md`, `05-config.md`, and `99-principles.md`
- `specs/records/2026-07/2026-07-05-expert-squad-catalog-stale-session-scope-repair.md`
- `specs/records/2026-07/2026-07-11-stale-project-expert-squad-repair.md`
- `specs/records/2026-07/2026-07-14-multica-expert-squad-import.md`
- `specs/records/2026-07/2026-07-15-multica-mission-multi-squad-parallel-import.md`
- `packages/opencorvus/src/{engine/git.ts,util/git.ts,snapshot/index.ts,expert-squad/prompt-profile-resolver.ts,server/routes/mission.ts}` and their focused tests
- `packages/overlay/src/{main.tsx,components/ChatComposer.tsx,services/expert-squad.ts,services/expert-squad-scope.ts,services/task-directory.ts,services/project-directory.ts}` and their focused/browser tests
- The complete `browser:control-in-app-browser` skill instructions for isolated visible-page acceptance
- Git for Windows release notes documenting that long-path handling is disabled by default and may be enabled per invocation with `-c core.longPaths=true`

### Whole-repository search evidence

Before this plan was written, `rg` inventories covered `multica-803e3d6b708f47f19c48ef0219d675f3`, `Unknown prompt profile`, `PromptProfileResolver`, `assertKnownProfileID`, `mission/wake`, `refreshExpertSquads`, `activeExpertSquad`, `expertSquadCatalogRequestKey`, `expertSquadCatalogDirectory`, `markExpertSquadCatalogStale`, `activeProjectDirectory`, every production import of `util/git`, every `core.longpaths`/`core.longPaths` occurrence, direct `Process.run`/`Process.spawn` Git invocations, and the related unit/browser tests.

| Call-point cluster | Disposition |
| --- | --- |
| `packages/opencorvus/src/util/git.ts` | Make the shared Git argv builder the single per-process owner of `core.longPaths=true`; retain timeout/result behavior. |
| `engine/git.ts`, `project/{project,vcs}.ts`, `worktree/**`, `config/config.ts`, `build/agent.ts`, `orchestrator/build-tool.ts`, and archive owners | Retain their existing shared-wrapper calls. They receive the Windows-safe process configuration without per-caller branches. |
| `snapshot/index.ts` | Remove duplicate `core.longpaths` arguments and persisted repository configuration; use the shared argv builder for the one stdin-piped `cat-file` process. Preserve snapshot-specific autocrlf/safecrlf/symlink/quotepath settings. |
| `skill/manager.ts` | Apply the same shared argv builder to resolved-executable clone/pull calls so no production `Process.run` Git path bypasses the configuration. |
| `server/routes/mission.ts` and `expert-squad/prompt-profile-resolver.ts` | Retain strict exact-project validation unchanged; the observed HTTP 400 is a correct final invariant. |
| `overlay/services/expert-squad-scope.ts` | Replace the settings/task directory fork with canonical `activeProjectDirectory()` while preserving pending/session scope semantics. |
| `overlay/main.tsx` catalog loader | Replace three independent composer signals with one request-key-owned catalog snapshot; expose it only for the exact current key and invalidate it on task completion. Preserve unrelated Mailbox edits in the same file. |
| `ChatComposer.tsx` | Retain as a controlled component. It consumes the exact current snapshot and does not become a second catalog owner. |
| `ExpertSquadPanel.tsx`, import/install/config services | Retain existing project writes and explicit stale invalidation; no parallel discovery or activation path. |
| Focused unit/source/browser tests | Extend owners to prove process argv, real Windows long-path add, scope identity mismatch, terminal invalidation, and rendered stale-selection removal. |

### Observed evidence and causal chain

1. The failing target project currently contains no package with manifest ID `multica-803e3d6b708f47f19c48ef0219d675f3`; the exact package exists in older `0715` project directories. Cross-project lookup would violate project package ownership.
2. The root session `ses_09495cba4ffeOE2UEQUSHJNj4S` belongs to the screenshot directory. Its task snapshot is `general`, while its session config overlay still records `multica-803e3d6b708f47f19c48ef0219d675f3`.
3. The 2026-07-16 runtime log records both the original and retry task failing in `EngineGit.prepare` with `Filename too long` on the imported package's MCP (Model Context Protocol) JSONC path. The full path is 264 characters.
4. Git for Windows does not enable long paths by default. OpenCorvus's general Git wrapper omitted the per-process setting, while Snapshot carried several local copies of it; therefore normal EngineGit staging failed even though Snapshot anticipated the platform constraint.
5. The composer stores squad options, Skills, and active ID independently from the catalog request identity. A valid scope change leaves the previous values visible until the replacement request resolves, and task completion does not mark the catalog stale even though task work can change project packages.
6. Mission wake validates the stale supplied ID against the exact current project and correctly returns `Unknown prompt profile`. Treating that last error as the root would hide both the Git failure and the stale frontend ownership.

### Independent agent feedback

No independent agent was commissioned. The user did not request sub-agents, and the active multi-agent policy prohibits delegation unless explicitly requested. This investigation instead uses direct filesystem, database, runtime-log, Git-history, source-call-point, and official Git for Windows evidence.

### Baseline and delivery state

- Branch: `work-v0.0.7beta-yr-0716`; initial task HEAD: `d8d857fd5`.
- `git fetch legacy-remote work-v0.0.7beta-yr-0716` showed the local branch two commits ahead of the legacy remote branch.
- The required pre-change push reached the repository hook. Workspace typechecks passed, but `api:routes-check` rejected unrelated, already-dirty Mailbox routes because their generated OpenAPI/SDK surface was not yet committed. This repair will not overwrite or absorb that parallel batch; final push must be retried after the shared hook surface converges.

## Repair design

### Git process configuration

Export one pure Git argv builder that accepts an optional resolved executable and returns `<git> -c core.longPaths=true ...args`. The shared `git()` wrapper, Snapshot's stdin-piped `cat-file`, and managed-Skill clone/pull use it. Snapshot deletes every local long-path argument and the repository-persistent config write, leaving one per-process source without mutating user/project Git configuration.

### Composer catalog snapshot

Define an atomic composer catalog snapshot containing `requestKey`, squad options, projected Skills, and effective active ID. A pure projection returns the snapshot only when its `requestKey` exactly equals the current `expertSquadCatalogRequestKey`; otherwise it returns the shared empty snapshot immediately. Successful loads replace the snapshot atomically. User selection can update only the current snapshot and only to an ID present in its options.

The request identity already includes directory, project/session ownership, and refresh token. A task busy-to-idle edge calls `markExpertSquadCatalogStale()` before the existing follow-up request, so package changes made by task work trigger a fresh catalog. This is data ownership/invalidation, not a submit gate.

## Verification plan

1. Add unit tests for the shared Git argv builder and the actual `Process.run` argv.
2. On Windows, create an isolated temporary repository with a tracked path longer than 260 characters and prove shared `git(["add", ...])` succeeds without changing global or project Git configuration.
3. Prove Snapshot and managed Skill Git calls consume the shared argv source and contain no local long-path configuration.
4. Add pure catalog-snapshot tests for exact identity, mismatch-to-empty behavior, and selection isolation.
5. Extend scope tests for canonical active-project directory ownership and source tests for terminal-edge invalidation.
6. Run focused OpenCorvus/Overlay tests and typechecks, document-health checks, `git diff --check`, then an isolated Node-launched rendered browser regression with a goal-scoped screenshot and manual visual review.
7. Re-read the Recall and diff, inspect overlap with the Mailbox batch, commit only this repair with `dsw-33987`, and push the current branch to `legacy-remote` after hooks pass.

## Implementation and verification record

Implemented on 2026-07-16:

- `util/git.ts` now owns one per-process `core.longPaths=true` argv fragment. EngineGit, project/VCS, worktree, archive, build, Snapshot, and managed Git Skill operations consume that source. Snapshot's seven duplicate arguments and persisted repository config write were deleted; its stdin-piped `cat-file` process now uses the same argv builder.
- The Overlay composer now consumes one atomic catalog snapshot keyed by the exact catalog request identity. A directory, session, or refresh-key mismatch immediately projects the shared empty snapshot, so a previous project's options, active ID, and production Skills cannot remain selectable while the replacement request is pending or failed.
- Expert-squad catalog directory ownership now delegates to `activeProjectDirectory()`, matching Mission wake and the other project-scoped Overlay services.
- Every selected-task busy-to-idle edge invalidates the expert-squad catalog before the existing once-per-task follow-up-suggestion guard. This covers package changes from later messages in the same task as well as the first completion.
- Mission wake and `PromptProfileResolver` were not changed. Unknown or removed project profiles remain strict errors if a non-Overlay caller explicitly submits one.

Verification:

| Surface | Result |
| --- | --- |
| Shared Git process/real Windows path | 12 tests passed, including actual staging of a path longer than 260 characters and proof that no local `core.longPaths` config was persisted. |
| EngineGit prepare/complete | 10 scenarios passed with a Windows-appropriate 20-second per-test budget. The first concurrent run hit the suite's default 5-second timeout while Snapshot also saturated the process supervisor; the serial rerun passed all 86 assertions. |
| Snapshot | The focused real `very long filenames` regression passed. A concurrent whole-file run exceeded the 180-second command budget and is not reported as a full-suite pass. |
| Managed Git Skill | 15 tests passed with 61 assertions. |
| Overlay catalog/scope | 22 tests passed with 109 assertions, including exact request identity, absent-ID rejection, canonical directory ownership, and terminal invalidation ordering. |
| Type safety | `packages/opencorvus` and `packages/overlay` typechecks passed. |
| Rendered browser | The Node-launched browser suite passed 3/3 after the fixture was updated for the concurrently landed Mailbox event stream. It verified the stale catalog becomes Chat-only, the old profile is absent from the outgoing Chat payload, draft text and attachment survive, and English/Chinese selector popup rendering remains readable. |

Accepted visual evidence:

- `.scratch/composer-stale-expert-squad-cleared.png`
- `.scratch/composer-expert-squad-draft-preserved.png`

Manual review confirmed the first screenshot exposes only the Chat intent after invalidation; the removed Multica/Development Flow option is absent, while the draft, attachment, model control, send control, and desktop layout remain intact. The second screenshot confirms the pre-invalidation `Builtin/General` selection and draft geometry. Both screenshots came from the isolated fixture page; the user's running Overlay was not touched.
