# Superpowers and Grill Me Built-in Mission Publish

Date: 2026-07-15
Status: Implementation complete; real Mission acceptance iterating after two rejected runs
Owner: Codex

## Recall

### User Request

The user asked to make Superpowers and Grill Me built into OpenCorvus, then test publishing a Mission.

### Acceptance Criteria

- OpenCorvus ships the complete pinned Superpowers skill suite and a working `grill-me` skill as ordinary built-in Skills.
- Superpowers keeps independent `superpowers:<name>` identities, supporting files, scripts, prompts, license, and source provenance. It is not compressed into one synthetic Skill.
- `grill-me` contains the actual one-question-at-a-time interview protocol. It must not ship the upstream wrapper's unresolved `/grilling` dependency.
- Built-in Skill identity is independent from its Windows-safe cache path. Names containing `:` must materialize and load without lossy sanitization or collision.
- Built-in risk metadata reflects installed scripts, agents, references, and templates instead of declaring every built-in low-risk and script-free.
- Runtime availability has one path: the active expert squad manifest grants ordinary Skills and `PromptProfileResolver` projects them into the exact Agent's Skill surface. Inventory or slash-command registration must not bypass that projection.
- The built-in `general` scheduler grants the new Skills to the Orchestrator only. `general-developer` remains unchanged so no second worker grant is introduced.
- A real isolated Mission is first published through `POST /mission/wake` with `promptProfile: "general"`, dispatches a normal Task, loads a named new Skill through the visible `skill` tool, reaches terminal status, and passes an explicit local acceptance command.
- Focused tests, documentation health checks, TypeScript typecheck, build, generated-source freshness, `git diff --check`, independent review, commit, and git-cc push all pass.

### Hard Constraints

- No fallback, compatibility alias, name guessing, hidden message, gate, state machine, second active field, or inactive-package resource scan.
- Superpowers and Grill Me are ordinary Skills, not expert squads, plugins, selectors, or expert-squad payload packages.
- The only active expert-squad selection source remains `prompt_profile.active`; the only production Skill projection owner remains `PromptProfileResolver`.
- No runtime download or update path. Upstream content is vendored at fixed commits and generated into the binary at build time.
- Do not restore deleted pre-June `docs/superpowers/**` records or create a parallel spec tree.
- Do not create a git worktree, use `git reset`, overwrite unrelated dirty changes, or interfere with existing OpenCorvus/Overlay processes.
- Mission acceptance must use an isolated sidecar on a random port and a temporary project; it must not restart or reuse the user's running application.
- Benchmark cleanup must settle process-owned live execution, stop the isolated server, dispose the global scheduler and instance scopes, then close the database; disposing instances while live schedulers still own work is forbidden.
- Mission benchmark model selection is explicit. Its isolated home owns a deterministic local-provider catalog and closes its SQLite (Structured Query Language database engine) handle before deleting that home.
- Test timeouts are measured from last activity. Playwright, if needed, is launched with Node, never Bun.
- Mission Task wait activity includes persisted Task update timestamps, not only status labels, so active execution progress refreshes the inactivity deadline.
- Current unrelated dirty file at task start: `specs/records/2026-07/2026-07-15-message-transcript-visual-language-repair.md`. This task does not edit or stage it.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-08-expert-squad-project-open-payload-release.md`
- `specs/records/2026-07/2026-07-08-expert-squad-release-schema-audit.md`
- `specs/records/2026-07/2026-07-14-multica-expert-squad-import.md`
- `packages/opencorvus/src/skill/skill.ts`
- `packages/opencorvus/src/skill/manager.ts`
- `packages/opencorvus/src/skill/mounts.ts`
- `packages/opencorvus/src/skill/default-skill-ref.ts`
- `packages/opencorvus/src/command/index.ts`
- `packages/opencorvus/src/session/command-exec.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/expert-squad/builtin/general/expert-squad.jsonc`
- `packages/opencorvus/script/benchmark/mission-benchmark.ts`
- `packages/opencorvus/test/skill/skill.test.ts`
- `packages/opencorvus/test/expert-squad/multica-general-projection.test.ts`
- `packages/opencorvus/test/mission/wake-route.test.ts`
- Pinned upstream Superpowers `v6.1.1`, source commit `d884ae04edebef577e82ff7c4e143debd0bbec99`, MIT License.
- Pinned upstream `mattpocock/skills`, audited commit `e9fcdf95b402d360f90f1db8d776d5dd450f9234`, MIT License.

### Whole-Repository Search Evidence

- `rg -n -i "superpowers|grill[-_ ]me|grillme" . --glob '!node_modules/**' --glob '!.git/**'`
  - The only tracked Superpowers reference is the historical-doc test that forbids restoration of deleted pre-June `docs/superpowers/**` records. No Grill Me runtime source exists.
- `rg -n -uu -i "superpowers|grill[-_ ]me|grillme" --glob '!node_modules/**' --glob '!.git/**' .`
  - `.gitignore` ignores `.superpowers`; runtime traces and retired worktree copies are not authoring sources.
- `rg -n "src/skill/builtin|skill/builtin|default_skill_refs|multica-import|research-report" packages/opencorvus/src packages/opencorvus/test`
  - `Skill.builtins()` and `Skill.install()` are the current built-in Skill authority; General's Multica grant is the direct production-projection precedent.
- `rg -n "source: \"skill\"|Add skills as invokable commands|Skill.get" packages/opencorvus/src packages/opencorvus/test`
  - `Command.state()` currently turns every `Skill.all()` entry into an invokable command, while `SessionCommand.command()` does not resolve the active production Skill surface. This is a proven projection bypass.
- `rg -n "Mission|mission|publish|wakeMission|/mission/wake" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test`
  - Mission publish is the first `POST /mission/wake`; later wakes resume the same `(project, directory, missionID)` Mission.
- `rg -n "tool|message|trace|report|session|skill|acceptance" packages/opencorvus/script/benchmark/mission-benchmark.ts`
  - The existing benchmark already starts an isolated random-port server, uses temporary home/project directories, performs two real wakes, resets inactivity timeout on observed activity, waits for terminal Task/Mission settlement, and runs an explicit acceptance command. It does not yet assert a named Skill tool call.
- `rg -n "TodoWrite|Task tool|spawn_agent|wait_agent|close_agent|git worktree|fallback" <pinned Superpowers skills>`
  - The upstream suite requires an OpenCorvus port for tool names and explicit worktree authorization. Raw fallback and unauthorised worktree instructions cannot be shipped into this project.

### Independent Agent Feedback

- Built-in/Skill audit: model these capabilities as ordinary built-in Skills; preserve all Superpowers supporting files and pinned MIT provenance; separate Skill identity from a SHA-256 (Secure Hash Algorithm 256-bit) cache key; flatten Grill Me's wrapper dependency into one `grill-me` port; correct built-in risk metadata; and eliminate the slash-command projection bypass before claiming runtime acceptance.
- Expert-squad architecture audit: inventory is not availability. General must explicitly grant the Skills to its scheduler and `PromptProfileResolver` must remain the single production projection owner. Do not change `prompt_profile.active`, worker grants, or expert-squad payloads.
- Mission audit: Mission publish is `POST /mission/wake`. Existing focused Mission tests passed 49/49 and Overlay transport tests passed 41/41. Real acceptance should reuse `mission-benchmark.ts`, which already implements activity-based timeout and isolated sidecar ownership, but must be extended to send an explicit prompt profile and prove the named Skill tool call.

## Root-Cause Analysis

The surface request sounds like a file import, but three existing contracts make that insufficient:

1. `Skill.install()` uses the Skill identity directly as a cache directory. Superpowers' canonical namespace contains `:`, which is valid in `SkillNameSchema` but invalid in a Windows directory segment. Lossy character replacement would create identity collisions.
2. Superpowers is a suite with supporting files and cross-Skill references. Importing only `SKILL.md` files, or collapsing the suite into one document, would silently break its runtime contract.
3. OpenCorvus currently exposes every inventory Skill as a slash command without consulting the active resolved projection. Adding new built-ins while retaining that route would make ungranted Skills executable and violate the resolver's single-source authority.

The repair therefore changes the built-in distribution model once, removes the bypass, and validates the production path instead of adding special cases for two names.

## Design

### Built-in authoring and generated runtime source

- Keep human-reviewable built-in source trees under `packages/opencorvus/src/skill/builtin/**`.
- Add one generator-owned descriptor module that embeds every built-in Skill and supporting file. Existing `research-report` and `multica-import` move to the same descriptor path so runtime registration has one implementation.
- Store source commit, upstream path, license, and local-port notes as installed supporting provenance files. Runtime never downloads upstream content.
- Generate TypeScript string literals for every Skill and supporting file. Vendored source extensions are data, not TypeScript module imports, and the authoring tree is excluded from the package compiler graph.
- Add generated-source freshness tests and wire generation into the existing build-artifact command.

### Identity and cache materialization

- Keep exact runtime identities `superpowers:<upstream-name>` and `grill-me`.
- Derive the cache directory from the full identity with SHA-256. The identity remains in frontmatter and resolver references; the hash is storage only and cannot become an alias or identity source.
- Install every declared supporting file below that derived directory with contained relative paths.

### OpenCorvus port boundary

- Keep all 14 Superpowers skills as independent identities and preserve their internal cross-references.
- Replace upstream host-specific tool assumptions with current OpenCorvus tool vocabulary and explicit one-layer Agent delegation.
- Remove fallback instructions. Worktree operations require explicit user authorization; without it the Skill reports the blocked operation instead of changing workspace strategy.
- Publish one `grill-me` Skill whose body is ported from upstream's canonical `grilling` protocol, because the upstream `grill-me` file is only a harness-specific wrapper.

### Production projection

- General's scheduler `default_skill_refs` grants `multica-import`, all `superpowers:*` Skills, and `grill-me`.
- `general-developer.default_skill_refs` remains empty.
- Remove automatic Skill-to-command registration. User-visible Skill inventory and production `skill` tool access continue through existing catalog/mount surfaces and the resolved active projection; no slash path bypass remains.

### Mission acceptance

- Extend the existing Mission benchmark with an explicit `--prompt-profile` input and a required Skill evidence input.
- Send `promptProfile: "general"` on both wakes.
- After terminal Task settlement, read each real persisted Task transcript and require a completed `skill` tool part whose input names the requested Skill. The Task transcript contains the Task scheduler Orchestrator and its delegated worker sessions; the evidence must come from the scheduler Orchestrator projection, while `general-developer.default_skill_refs` remains empty.
- Record the evidence in the benchmark report and reject the run if it is absent, even when the artifact acceptance command succeeds.
- Treat terminal Task facts as the Task lifecycle source. A normal scheduler-to-worker Task completed through `complete_task` has no engine run, so it has no run-level evaluation projection. The benchmark must not wait for or invent one; acceptance is the conjunction of completed Mission Task facts, persisted exact Skill evidence, Mission state reconciliation, and the explicit local verification command.
- Run the benchmark in its existing temporary project/random-port mode with `--no-keep`; do not attach to the current application process.

## Call-Point Inventory and Disposition

| Call point | Disposition |
| --- | --- |
| `src/skill/skill.ts::builtins/install/state` | Replace manual two-file imports with the generated descriptor registry; hash cache directories; install complete supporting trees. |
| `src/skill/manager.ts::installed/riskFor` | Measure the materialized built-in directory so scripts/references/templates are reported truthfully. |
| `src/command/index.ts::state` | Delete automatic `Skill.all()` to command projection. No compatibility route remains. |
| `src/session/command-exec.ts` | Retain ordinary command/MCP behavior; no Skill special case is added because Skill-derived commands are removed at the source. |
| `src/expert-squad/builtin/general/expert-squad.jsonc` | Add exact scheduler default Skill refs; keep worker refs empty. |
| `src/expert-squad/prompt-profile-resolver.ts` | Keep implementation unchanged; add real General grant/isolation coverage. |
| `script/generate-build-artifacts.ts` | Generate the built-in Skill descriptor before build. |
| `script/benchmark/mission-benchmark.ts` | Add explicit General profile input and persisted Task-session-tree named-Skill tool evidence. Preserve inactivity-based timeout and isolation; accept only an actual completed tool part, not tool registry visibility. |
| `test/skill/skill.test.ts` | Cover identities, cache keys, provenance, supporting files, cross-references, and Grill Me protocol. |
| `test/expert-squad/multica-general-projection.test.ts` | Generalize expected scheduler grants; retain empty worker grant assertion. |
| `test/expert-squad/prompt-profile-resolver.test.ts` | Cover active General grants and inactive/non-owner isolation. |
| `test/command/**` or focused command test | Assert unprojected inventory Skills are no longer auto-registered commands. |
| `test/benchmark/mission-benchmark.test.ts` | Cover prompt-profile forwarding, named Skill evidence success, and missing-evidence rejection. |
| `specs/current/architecture/04-extensions.md` | Document built-in inventory, General manifest grants, resolver production authority, and absence of a slash bypass. |

## Verification Plan

1. Run the built-in Skill generator and freshness test.
2. Run focused Skill, Skill manager, command, General projection, resolver, Skill tool, Mission route, and Mission benchmark unit/integration tests.
3. Run the isolated real-model Mission benchmark with `promptProfile=general`, a request that requires `superpowers:verification-before-completion`, named Skill evidence, and an explicit artifact verification command.
4. Inspect the report, persisted tool part, Task/Mission terminal states, and produced artifact manually.
5. Run documentation health tests, OpenCorvus typecheck, build, and `git diff --check`.
6. Perform an independent exact-diff review, repair findings, rerun affected checks, commit with `dsw-33987`, and push `v0.0.4beta` to `myhexin`.

## Progress

- [x] Read current architecture, historical records, source, tests, and upstream repositories.
- [x] Complete whole-repository call-point inventory and three independent read-only audits.
- [x] Record the root cause, single-source design, and acceptance plan before implementation.
- [x] Implement the built-in descriptor/source generator and vendored ports.
- [x] Repair cache materialization, risk metadata, projection, and slash bypass.
- [x] Extend Mission benchmark evidence and add regressions.
- [x] Pass focused built-in, projection, Skill tool, generator freshness, and benchmark regressions.
- [ ] Run real isolated Mission publish acceptance and secondary review.
- [ ] Commit and push the completed delivery to git-cc.

### Real Mission iteration evidence

- Run 1 (`mission-bench-mrltpg66`, Task `tsk_f64…`) proved the original benchmark cleanup disposed instance state while live task-loop ownership was still unwinding. It also exposed a worker memory-input schema failure. The run was rejected after a real inactivity timeout; it is not acceptance evidence.
- Run 2 (`mission-bench-mrlv0984`, Task `tsk_f650da2870016gPAoNodPU3FwJ`) persisted a completed exact `skill` tool call for `superpowers:verification-before-completion` in scheduler session `ses_09af22c75ffeHYykE3a4DLcan6`, then delegated the implementation worker. The scheduler later dispatched a redundant evidence-only worker and stopped making progress. The benchmark correctly rejected it after 600000 ms without Task activity.
- Run 2 cleanup still logged `task loop completion hook observed failure: Cannot enter an instance while global instance disposal is in progress`. The direct trigger was a queue completion hook that remained process-owned after session abort and re-entered the project while `Instance.disposeAll()` had started. The benchmark now records every observed Mission Task identifier, explicitly interrupts those task loops, aborts process-owned execution, and awaits `awaitTaskLoopIdle(taskID, idleTimeoutMs)` before scheduler/instance disposal. This uses the benchmark's activity-based timeout rather than a process-start deadline.
- The Task request now states the missing natural-language completion boundary: one implementation worker, then direct Task completion from its submitted evidence. This corrects the scheduler prompt that allowed a redundant evidence-restatement delegation; it does not introduce a host gate or worker-count enforcement mechanism.
- Run 3 (`mission-bench-mrlvls0t`, Task `tsk_f651ac29f001b1KtSK1IMIZzYs`) proved the corrected one-worker path: exact Skill use, one implementation worker, real file edits, `bun test`, and terminal `completed`. It was rejected because the benchmark still waited for an evaluation projection. `/tasks` showed no `run`, and `taskItems()` only projects `evaluation` from `findActiveRunForTask` or `findLatestRunForTask`; this normal Task therefore cannot produce the awaited value. Cleanup completed without the prior task-loop/instance race, validating the settlement repair. The benchmark now removes run-level evaluation from this normal-Task acceptance contract instead of adding a synthetic evaluation or alternate path.

### Codex secondary review feedback

- A whole-port `rg` review found nine remaining uses of “gate” in Superpowers review/checklist prose. Even where the upstream meaning was only a heading, shipping that wording would reintroduce the project's prohibited workflow-gate concept through Agent instructions. The port replaces those terms with focused review, decision check, or evidence protocol language and adds a generated-payload regression covering every Superpowers Skill and supporting file.
