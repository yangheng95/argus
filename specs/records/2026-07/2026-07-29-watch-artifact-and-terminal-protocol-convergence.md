# Watch Artifact and Terminal Protocol Convergence

## Recall

### User request

- Deeply distinguish algorithm/protocol defects from infrastructure defects in the completed
  Mirror Watch task `tsk_fa967691a001blOLSh3ofJBz4L`.
- Verify the claimed origin of Mirror Watch expert-survey `schema_version=2` against the package
  authority and restore the sole V1 contract.
- Determine whether Prism Watch and the JavaScript Software Development Kit (SDK) expose the
  same class of problem.
- Repair every exposed problem precisely and systemically.

### Acceptance

- Mirror Watch expert publication rejects the complete set of producer-contract violations in
  one diagnostic response and keeps one package-owned schema/version authority.
- Prism Watch no longer transports its three inter-agent domain contracts through unconstrained
  `artifact_publish` JSON. Each producer has one package-owned typed publisher and each
  dependent producer consumes the exact predecessor Artifact.
- SDK authoring documentation and repository authoring tests state and verify the same rule:
  an Artifact consumed by another declared workflow node uses a package-owned codec and typed
  publisher; generic publication remains valid only for terminal, non-reused evidence.
- Orchestrator completion instructions make pending blocking Goals explicit non-completion
  evidence. The fix remains a prompt/data-flow repair and does not add a Host completion gate or
  workflow state machine.
- Task Debug Info distinguishes retained idle coordination Sessions from executing work and
  exposes activity that happened after Task terminal time without falsifying timestamps.
- Focused tests, package loading, JavaScript SDK authoring round-trip, TypeScript checks,
  documentation health checks, independent review, commit, and `legacy-remote` push all pass.

### Hard constraints

- Preserve every parallel worktree change. Do not reset, stash, restore, broadly format, or
  broadly stage caller-owned files.
- Do not restart or otherwise manipulate a running OpenCorvus or Overlay process.
- Do not add a Host route gate, fallback, compatibility reader, state machine, or keyword lint.
- Keep package-local Artifact schema versions separate from Task Artifact schema versions and
  OpenTest result protocol versions.
- Use the current main worktree and commit subjects beginning with `dsw-33987`.

### Evidence read

- Immutable SQLite inspection of
  `/Users/yangheng/.local/share/opencorvus/opencorvus.db` for the supplied Task.
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-28-goal-attempt-shutdown-retry-convergence.md`
- Mirror Watch manifest, agent prompts, typed publishers, aggregation library, and tests.
- Mirror Prism manifest, Watch prompts, package tools, authoring tests, and SDK materializer.
- Orchestrator task description, core prompt, lifecycle tools, completion decision Artifact,
  Agent invocation ledger, Workbench board, and Overlay Task Debug Info formatter.

### Repository-wide call-point inventory

| Contract or API | Call points and disposition |
| --- | --- |
| `mirror-watch/expert-survey` | Expert agent prompt and `publish-expert-survey` remain the sole producer; aggregate-report remains the sole consumer. Replace first-error validation with one complete diagnostic result. Keep the package-owned protocol at V1; the proposed V2 had no package authority and is not retained as an alias. |
| `prism/source-observation-brief` | Requirements analyst generic `artifact_publish` is replaced by `prism/shared/publish-source-observation-brief`. Architect discovers and reads the exact Artifact, then passes its exact locator to its typed publisher. |
| `prism/source-observation-plan` | Architect generic `artifact_publish` is replaced by `prism/shared/publish-source-observation-plan`. Researcher must discover and read the exact plan before research and pass its locator to its typed publisher. |
| `prism/competitor-research` | Researcher generic `artifact_publish` is replaced by `prism/shared/publish-competitor-research`; optional files remain exact immutable Task Artifact refs with a stable typed resource-role map. Downstream PRD requirements consume the Catalog Artifact unchanged. |
| `EngineArtifactPublishInputSchema` and `artifact_publish` | Keep the platform schema generic. It owns canonical JSON transport and provenance, not domain semantics. Do not add domain names or workflow routing to Plugin Host code. |
| `validateExpertSquadPackageDefinition` and SDK authoring | Keep manifest/file structural validation generic. Strengthen the documented authoring invariant and repository package tests instead of guessing prompt semantics through keyword validation. |
| `complete_task` | `task-lifecycle-tools.ts` remains the lifecycle writer and completion-decision Artifact remains the audit record. Strengthen the Orchestrator prompt/tool description so pending blocking Goals, undispatched Goals, unresolved terminal attempts, and live prompt owners are explicit non-completion evidence. Do not add a Host completion lock. |
| Goal status | `deriveGoalStatus`, `goalStatusByID`, Task description, Task Context, and Workbench Goal projection already derive pending correctly. Preserve this single source. |
| Agent invocation DAG | `task-event.ts` remains the durable Session ledger projection. Preserve idle rows as real facts; Task Debug Info will classify them as retained idle coordination rather than executing nonterminal work. |
| `task.activity.updated` | Preserve the maximum real Session/status timestamp. Add `task.time.completed` and an explicit post-terminal activity diagnostic rather than clamping or rewriting history. |

### Independent agent feedback

No sub-agent was used because the user did not request delegated or parallel agents, and the
current collaboration contract forbids unsolicited delegation.

## Causal analysis

The repeated aggregate-report calls were not a filesystem or database outage. The old expert
producers emitted inconsistent V1 payload shapes and handed report assembly model-authored paths.
The consumer therefore discovered contract failures one at a time and the model attempted path
probes and retries. The validation repair strengthens the sole package-owned V1 contract with
exactly `{vote, resource_roles}`; the proposed Mirror Watch V2 had no authority and was an
invented version rather than a global or package-local SDK schema.

Prism Watch exposes the same semantic Application Binary Interface (ABI) weakness without the
same observed retry trace: three dependent workflow nodes currently publish free-form JSON under
well-known type strings. Platform canonical-JSON validation proves transport shape but cannot
prove the producer and consumer agree on domain fields. The repair belongs in the package through
shared codecs and typed tools, while the generic Plugin/SDK transport remains domain-neutral.

The completed Task with six pending Goals is a scheduler decision defect. Durable storage and the
Goal projection retained the truth. The completion protocol failed to turn that visible truth into
an unambiguous completion rule. A Host-side rejection would be a workflow gate and would still
leave the scheduler reasoning defect intact, so the repair belongs in the Orchestrator prompt,
tool description, and regression tests.

The two idle delegated Sessions are retained coordination ownership, not executing workers.
Treating every non-terminal Session status as active work made Task Debug Info ambiguous. Likewise,
activity after completion is a useful inconsistency signal and must be labelled, not hidden by
clamping timestamps.

## Implementation

1. Make Mirror Watch expert validation collect deterministic field, vote, analysis, resource,
   and identity violations before rejecting publication.
2. Add one Prism Watch domain-contract module and three thin typed publication tools; project one
   tool to each exact producer and update prompts/readme/version.
3. Add real package-tool success-chain tests, structured error-contract coverage, and SDK
   round-trip assertions.
4. Amend SDK authoring comments/skill documentation with the dependent-Artifact typed-publisher
   boundary, without runtime keyword checks.
5. Amend Orchestrator completion instructions/tool descriptions and focused prompt tests.
6. Improve Task Debug Info classifications and tests without changing the underlying ledger.
7. Run focused tests, typecheck, documentation health, diff review, commit, and push.

## Result

- Mirror Watch package revision `2026.07.29.2` keeps expert-survey at schema version 1 and returns
  all independently detectable resource/content violations from one typed publication attempt.
- Prism package revision `2026.07.29.1` projects three typed Watch publishers backed by one
  package codec. A real same-Task projected-worker test proves valid brief → plan → research
  publication and fail-loud rejection of predecessor question-coverage drift.
- SDK authoring guidance reserves generic model publication for terminal evidence that no
  declared workflow node consumes. The SDK remains domain-neutral and adds no prompt keyword
  checker or Host workflow gate.
- Orchestrator completion guidance now treats every non-passed blocking Goal as direct
  non-completion evidence and requires an explicit Goal lifecycle decision before Task
  completion.
- Task Debug Info preserves actual Session timestamps while separating retained terminal-Task
  idle ownership and enumerating post-terminal activity.
- Mirror Watch, Prism, SDK authoring, Orchestrator prompt/tool, Overlay debug, documentation
  health, and repository TypeScript checks pass.
