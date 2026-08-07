# Prism RequirementSet handoff lifecycle

## Recall

- User request: monitor the real Prism Mission on port `6888`, directly inspect the canonical SQLite database, and immediately repair evidence, path, persistence, duplicate-pollution, or deadlock defects while tolerating non-critical omissions.
- Acceptance: one Requirements Agent Turn registers the Task-wide requirements and decisions, ends normally, and lets the Requirements adapter persist exactly one immutable `requirement_set` artifact. The returned `domain_artifact_refs` identity is then passed unchanged to Architect. The Requirements worker must never be asked to return an artifact that cannot exist until after its Turn ends.
- Hard constraints: keep Mirror Prism policy in the Expert Squad package rather than global core; do not add a host gate, fallback, compatibility path, retry loop, synthetic message, or Task-current RequirementSet selector; preserve unrelated dirty-worktree changes.
- Read sources: `AGENTS.md`, `specs/current/architecture/13-agent-communication-matrix.md`, `specs/current/architecture/15-agent-facts-and-turns.md`, `packages/opencorvus/src/orchestrator/requirements-stage.ts`, `packages/opencorvus/src/requirements/agent.ts`, the installed and source Mirror Prism Orchestrator prompts, and canonical SQLite rows for Mission `c3c74a65eaf04ed7` / Task `tsk_f9b8c62c50013fZLDnmBoHnE1n`.
- Full-repository search: `RequirementSet`, `register_requirement`, `requirements-analyst`, exact artifact references, and Architect handoff were searched across core, package, tests, current architecture, and July records. Core already has the single correct lifecycle in `requirements-stage.ts`: a normal worker result is persisted after `RequirementsAgent.run`, then the returned fact references contain `artifact:<RequirementSet id>`. The Prism package is the contradictory caller.
- Independent-agent feedback: none; the user did not request delegation and this investigation remained single-agent.

## Failure evidence

At `2026-07-26T00:50:24+08:00`, Task `tsk_f9b8c62c50013fZLDnmBoHnE1n` terminal-failed with no Goals and no `requirement_set` row.

- Requirements Session `ses_06466acd9ffd8pQjs2OVvMW0w5` successfully called `register_requirement` for `REQ-1` through `REQ-11` and registered the foundational decisions.
- Dispatch tool part `prt_f9b993033001i9nIJn03lqMkch` instructed the worker to “Return the exact persisted RequirementSet artifact ref”.
- That ref could not exist during the worker Turn: `packages/opencorvus/src/orchestrator/requirements-stage.ts` persists the snapshot only after `RequirementsAgent.run` returns normally.
- The worker therefore called `request_orchestrator_decision` instead of ending normally. The adapter correctly returned a coordination handoff and intentionally skipped persistence.
- The Orchestrator then created a second Requirements Session `ses_06463a3aeffeJzjOx5qWZG1Tpl` to retrieve the nonexistent artifact. That recovery also handed off, and the Orchestrator failed the Task through request `art_f9b9d5c8c001DPPmgHnhPHMWTB`.

This is a circular package protocol, not an optional-field completeness issue and not a storage lookup defect.

## Repair

The Mirror Prism Orchestrator package must describe the actual adapter lifecycle:

1. Dispatch Requirements once with inputs and expected requirement/decision content only.
2. Let the worker end with its visible narrative summary after successful registration.
3. Let the adapter persist the immutable RequirementSet after normal Turn completion.
4. Read the exact `artifact:<id>` from the completed `dispatch_agent` tool result and pass it unchanged to Architect.
5. Never ask the worker to emit, retrieve, predict, or recover that post-Turn artifact identity.

Missing `domain_artifact_refs` after a normal completed dispatch remains a real persistence failure. It must be exposed, not worked around through another Requirements dispatch.

## Regression

- Package tests must assert both Orchestrator prompt surfaces contain the post-Turn lifecycle and explicitly forbid asking the worker for the artifact identity.
- The generated Expert Squad payload must be regenerated from the source package.
- The installed project package must be replaced through the canonical Expert Squad import route before a new real Mission verifies one Requirements Session, one `requirement_set` artifact, and a same-ref Architect dispatch.

## Cross-squad and SDK authoring closure

The repository-wide Goal-mode package scan found the same adapter pair in Frontend Replica, Frontend Innovate, Mirror Watch, Prism, and WuJiang/MirrorTest. Their runtime adapters share the correct core lifecycle, but only Prism now explained the post-Turn identity boundary; the others could still induce the same invalid dispatch reason through package-local Orchestrator judgment.

The same concise lifecycle is therefore recorded in every Goal-mode package Orchestrator prompt. SDK runtime types and validation remain unchanged because they already carry exact artifact refs and validate the single Requirements→Architect topology. The English and Chinese SDK authoring references now explain the lifecycle so new packages do not recreate the circular request. One repository test enumerates every Goal-mode package and rejects a missing lifecycle statement.
