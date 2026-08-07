# Multica Import Runtime Adapter And Planning Closure Repair

Date: 2026-07-22
Status: Proposed; implementation not started
Owner: Codex

## Recall

### User request

The user supplied failed Task `tsk_f89caf290001DAaVEyYPfov1qd`, asked for the
root cause, then asked how the problem should be handled during Multica import and
requested a repair plan.

### Acceptance criteria

- Multica import must preserve an explicit, evidence-backed OpenCorvus runtime
  template selection for every source Agent instead of projecting every Agent as a
  generic delegated worker.
- A virtual workflow containing Goal-scoped work must be importable only when the
  same workflow contains an executable Requirements-to-Architect planning closure
  before its Goal-scoped consumers.
- A task-only Multica Squad must remain representable without inventing Requirements,
  Architect, Goals, or General-package inheritance.
- Preview and import must use the same strict mapping bytes and mapping digest, and an
  invalid mapping must produce no package write.
- The old `agent_goal_concurrency` mapping shape must be deleted, not accepted through
  compatibility or converted through fallback logic.
- The production-shaped regression must prove that the re-imported Squad creates the
  active spec snapshot and goal plan through the existing typed adapters before Goal
  work starts; a Markdown or interactive artifact is not acceptable evidence.

### Hard constraints

- Do not weaken `manage_task(add_goal)` or make it create a spec snapshot or plan.
- Do not parse an Agent-authored document artifact into Engine requirement, spec, plan,
  or Goal rows.
- Do not add a host-side route bypass, workflow state machine, retry gate, hidden
  General Agent, synthetic message, or inactive-package resource inheritance.
- `prompt_profile.active` and `PromptProfileResolver` remain the only active package
  selection and runtime projection sources.
- Runtime-role selection is an explicit importing-Agent judgment over complete source
  evidence. The host must not keyword-map source names, roles, descriptions, Skills,
  member order, concurrency, or leader identity to a runtime template.
- Preserve one source Agent UUID to one target projected Agent identity. Do not clone a
  source Agent into both Requirements and Architect identities.
- Existing installed packages are not silently rewritten. Replacement requires the
  existing explicit uninstall lifecycle followed by a fresh preview and import.
- Do not restart, refresh, stop, or otherwise interfere with the running OpenCorvus or
  Overlay process.
- Preserve unrelated worktree changes. Any implementation commit subject must start
  with `dsw-33987` and be pushed to the `myhexin` remote without bypassing hooks.

### Sources read

- `AGENTS.md`
- Runtime Task, Session, Message, Part, Artifact, Goal, and Agent invocation evidence
  for `tsk_f89caf290001DAaVEyYPfov1qd`
- `C:/Users/10132/.local/share/opencorvus/log/2026-07-22T114916-31816-1.log`
- Installed package
  `C:/Users/10132/.config/opencorvus/expert-squads/multica/multica-803e727476bc4fce9e6efca5dc24adea/expert-squad.jsonc`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-09-external-expert-squad-schema-base-role.md`
- `specs/records/2026-07/2026-07-11-platform-runtime-external-goal-team.md`
- `specs/records/2026-07/2026-07-14-multica-expert-squad-import.md`
- `specs/records/2026-07/2026-07-19-multica-complete-catalog-roster-repair.md`
- `specs/records/2026-07/2026-07-20-multica-import-repair-dialog.md`
- Multica import, Expert Squad registry/resolver, runtime-template registry, dispatch
  adapter, Requirements, Architect, Goal lifecycle, package manager, route, Skill, SDK,
  and focused test sources listed below.

### Whole-repository search evidence

The pre-plan search covered `MulticaOpenCorvusMappingSchema`,
`agent_goal_concurrency`, `base_role`, `delegated-worker`, `RuntimeTemplateID`,
`multica_preview`, `multica_import`, `virtual_workflows`, and the exact
`no active task contract/spec snapshot` error across production code, tests, generated
artifacts, current architecture, and July records.

Relevant call-point disposition:

| Surface | Current evidence | Disposition |
| --- | --- | --- |
| `expert-squad/multica-import.ts` mapping schema | Carries MCP replacements, per-Agent concurrency, and virtual workflows, but no runtime-template selection. | Replace `agent_goal_concurrency` with one strict `agent_projections` map containing `base_role` and `goal_concurrency`. |
| `validateMapping()` | Validates complete source-Agent coverage, workflow references, dependencies, and cycles only. | Validate complete projection coverage and executable planning closure for every workflow that contains Goal-scoped nodes. |
| `packageFiles()` | Hardcodes every imported projection to `base_role: "delegated-worker"`. | Emit the exact mapping-selected runtime template and document the reviewed adapter table in package provenance. |
| `multica_preview` / `multica_import` Orchestrator tools | Expose the current mapping schema and describe only concurrency, workflow, and MCP repair. | Expose and describe the exact runtime-template mapping contract; preserve digest equality and no-replacement semantics. |
| Built-in `multica-import` Skill | Instructs the importing Agent to map concurrency and task/Goal scope independently, but supplies no adapter decision. | Require evidence review and explicit runtime-template choice; prohibit name/role keyword inference and invented planning roles. |
| Generated built-in Skill payload | Contains the tracked copy of the old Skill. | Regenerate from the canonical Skill source and verify byte parity. |
| Server Multica routes | Reuse `MulticaOpenCorvusMappingSchema`. | Preserve route ownership and strict body handling; regenerate OpenAPI and SDK types for the replacement shape. |
| Multica importer tests | Fixtures use `agent_goal_concurrency`; the main fixture has a Goal node but no Requirements or Architect projection. | Split fixtures into valid task-only and valid planned-delivery mappings and add negative closure cases. |
| `virtual-workflow-protocol.test.ts` | Pins concurrency to the old map and only rejects derivation from source runtime limits. | Pin both runtime template and concurrency to the new explicit map, plus absence of host keyword inference. |
| Skill, route, and generated-payload tests | Pin old prompt text and request bodies. | Replace with the new strict mapping and adapter-evidence assertions. |
| `runtime-template-id.ts` / `runtime-template-registry.ts` | Own the exact host runtime-template Application Binary Interface (ABI) and adapter descriptions. | Reuse as the only allowed `base_role` vocabulary; do not create a Multica-specific role enum. |
| Requirements and Architect adapters | Already own typed spec-snapshot and goal-plan registration. | Preserve and exercise them; do not duplicate their writes in the importer or Goal tool. |
| `goal-lifecycle-tools.ts` | Correctly rejects Goal creation without active spec snapshot and plan. | Preserve unchanged and use its rejection as a negative regression oracle. |
| Expert Squad Registry / `PromptProfileResolver` | Validate and project the selected package's exact `base_role`; external selection replaces General projection. | Preserve unchanged; the repaired manifest supplies the missing adapters. |
| Package manager / uninstall route | Multica import uses `replace: false`; explicit uninstall replaces active references with General before deletion. | Preserve. Use uninstall then re-import for already installed affected packages. |
| Historical 2026-07-14 import record | Records the old deliberate all-delegated-worker decision. | Preserve as historical evidence; supersede it with this new record and current architecture after implementation. |

No sub-Agent was used because the user did not request delegation or parallel Agents.

## Causal diagnosis

### Observable failure

Task `tsk_f89caf290001DAaVEyYPfov1qd` started under General and then selected imported
Squad `multica-803e727476bc4fce9e6efca5dc24adea`. A Requirements-named imported worker
published artifact `art_f89d77235001rxz2izQ2q3daQ3`, but two subsequent
`manage_task(add_goal)` calls returned `no active task contract/spec snapshot`. No Goal,
run, or task-scoped Agent outcome was created, and the final re-dispatch ended without
the delegated worker's typed terminal submission.

### Direct trigger

The artifact was ordinary interactive-document output from the
`delegated_worker` adapter. It did not and could not call the Requirements adapter's
typed registration tools, so no canonical Engine spec snapshot existed. The same
package had no Architect adapter capable of registering the typed Goal graph and
active plan required before `add_goal`.

### Deep design cause

Multica import preserves source role text only inside Agent prompts while
`packageFiles()` unconditionally writes `base_role: "delegated-worker"` for every
source Agent. At the same time, the mapping permits Goal-scoped workflow nodes. The
import contract can therefore declare planned delivery that the generated package has
no runtime capability to establish.

### Why the previous path did not root-fix it

Redispatching the Requirements-named worker repeated the same adapter contract. Calling
`add_goal` earlier could only expose the missing data-integrity prerequisite. Treating
the document title as a contract would create a second, untyped source of truth. The
failure is established at package generation time and must be repaired there.

## Proposed single-source mapping contract

Replace the old field; do not add a sibling field:

```jsonc
{
  "mcp_replacements": [],
  "agent_projections": {
    "<requirements-source-agent-uuid>": {
      "base_role": "requirements",
      "goal_concurrency": "single"
    },
    "<architect-source-agent-uuid>": {
      "base_role": "architect",
      "goal_concurrency": "single"
    },
    "<build-source-agent-uuid>": {
      "base_role": "build",
      "goal_concurrency": "disjoint_goals"
    }
  },
  "virtual_workflows": {
    "planned-delivery": {
      "label": "Planned delivery",
      "description": "Create the typed contract and plan before Goal execution.",
      "nodes": {
        "requirements": {
          "source_agent_id": "<requirements-source-agent-uuid>",
          "dispatch_scope": "task",
          "description": "Register the canonical requirements snapshot.",
          "depends_on": []
        },
        "architecture": {
          "source_agent_id": "<architect-source-agent-uuid>",
          "dispatch_scope": "task",
          "description": "Register the typed Goal graph and plan.",
          "depends_on": ["requirements"]
        },
        "implementation": {
          "source_agent_id": "<build-source-agent-uuid>",
          "dispatch_scope": "goal",
          "description": "Implement one registered Goal.",
          "depends_on": ["architecture"]
        }
      }
    }
  }
}
```

`base_role` must use the existing `RuntimeTemplateID` vocabulary. The importing Agent
chooses it from the complete visible source roster, member roles, descriptions,
instructions, Skills, and MCP evidence. The adapter does not infer it. The mapping
digest binds both `base_role` and `goal_concurrency`, so any runtime-contract change
requires a new preview.

## Planning-closure integrity rules

For each virtual workflow independently:

1. If every node is task-scoped, no planning role is invented; all-delegated task-only
   Squads remain valid.
2. If any node is Goal-scoped, the workflow must contain a task-scoped node whose
   mapped `base_role` is `requirements` and a task-scoped node whose mapped
   `base_role` is `architect`.
3. The Architect node must transitively depend on a Requirements node.
4. Every Goal-scoped node must transitively depend on an Architect node.
5. A label such as `Requirements`, `Design`, or `Architect` proves nothing. If the
   source evidence does not establish distinct Agents able to own the exact typed
   contracts, preview remains non-importable until the source Squad is corrected.
6. One source Agent cannot fill two projections. This preserves source identity and
   prevents the same prompt from carrying two incompatible typed terminal contracts.

These are package-data integrity rules over an immutable guidance graph, not a runtime
workflow engine. They add no active workflow, current step, status, auto-advance, or
persisted execution state.

## Implementation plan

1. Add failing importer regressions for the production shape: a Goal workflow whose
   Agents are all delegated workers, a valid Requirements/Architect/Build mapping, a
   valid task-only delegated mapping, and a role-name keyword false positive.
2. Replace `agent_goal_concurrency` with strict `agent_projections` and source
   `base_role` validation from `RuntimeTemplateID`; delete the old shape and old error
   wording.
3. Extend `validateMapping()` with per-workflow transitive planning-closure validation
   and exact diagnostics. Keep all validation before package-manager writes.
4. Generate manifest projections from `agent_projections`, include the reviewed
   source-Agent-to-runtime-adapter table in package provenance, and bind it through the
   existing mapping digest.
5. Update Orchestrator tool descriptions and the canonical Multica import Skill so the
   importing Agent makes an evidence-backed adapter decision and does not infer from
   names, leader identity, order, or runtime limits.
6. Regenerate the built-in Skill payload, OpenAPI document, JavaScript SDK types/client,
   and any checked generated artifacts from their canonical sources.
7. Update current Expert Squad extension architecture to supersede the old
   all-delegated Multica projection decision while preserving external-package
   isolation and universal Build's scheduler-only status.
8. Run focused unit, route, payload, SDK, architecture, and documentation tests; inspect
   the complete diff for old-field residue and duplicate mapping sources.
9. Run a real isolated end-to-end import and Task execution, visually inspect the Task
   conversation/Goal evidence if the Overlay delivery surface changes, then commit and
   push only after the exact production path passes.

## Existing installed package disposition

The affected package is already installed under its canonical source-derived ID, and
Multica import intentionally uses `replace: false`. After the code repair:

1. Explicitly uninstall
   `multica-803e727476bc4fce9e6efca5dc24adea`; the existing uninstall contract replaces
   exact active references with General before removing the package.
2. Run `multica_catalog` again and confirm the exact source Squad UUID is now
   `installed: false`.
3. Build and review the new `agent_projections` mapping from the complete source
   evidence. For this development Squad, Requirements, design/architecture, and coding
   members must map to their exact typed contracts only if their instructions establish
   those responsibilities.
4. Preview until the mapping is blocker-free, then import with the latest source and
   mapping digests.
5. Activate the re-imported package explicitly and start a new Task. The failed Task is
   retained as immutable incident evidence.

There is no in-place manifest rewrite, legacy-shape conversion, alias, or automatic
reactivation.

## Validation plan

### Focused contract tests

- `bun test packages/opencorvus/test/expert-squad/multica-import.test.ts`
  - old `agent_goal_concurrency` is rejected;
  - missing/unknown source-Agent projection is rejected;
  - unknown runtime template is rejected;
  - runtime-template changes alter `mappingDigest`;
  - generated manifest preserves the exact selected `base_role` and concurrency;
  - a Goal workflow without Requirements/Architect closure is rejected before writes;
  - Architect-before-Requirements and Goal-before-Architect graphs are rejected;
  - valid planned delivery and task-only delegated delivery both import;
  - source naming alone never changes or validates a runtime adapter.
- `bun test packages/opencorvus/test/expert-squad/virtual-workflow-protocol.test.ts`
- `bun test packages/opencorvus/test/skill/multica-import-skill.test.ts`
- `bun test packages/opencorvus/test/skill/builtin-payload-generation.test.ts`
- `bun test packages/opencorvus/test/server/expert-squad-routes.test.ts`

### Runtime integration

- Import from a real local HTTP Multica fixture through `multica_preview` and
  `multica_import`, then load the resulting package through the real Registry and
  `PromptProfileResolver`.
- Select the imported package for a fresh Task and dispatch its mapped Requirements
  Agent through the real Requirements adapter. Assert a canonical active spec snapshot,
  not only artifact text.
- Dispatch its mapped Architect through the real Architect adapter. Assert the active
  plan and typed Goal rows bind to that spec snapshot.
- Dispatch the mapped Goal worker and assert the Goal-scoped Session and terminal
  outcome are visible.
- Assert the run contains no `no active task contract/spec snapshot`, has non-empty
  Goals and outcomes, and reaches terminal Task/Session evidence.
- Repeat with a task-only all-delegated Squad and assert it completes directly without
  fabricated spec, plan, or Goals.

Mocked schema, canned tool results, string screenshot references, and package-file
inspection are supporting tests only; they are not the real end-to-end acceptance.

### Generated and repository checks

- `bun run ./packages/opencorvus/script/generate-builtin-skill-payload.ts`
- `bun run ./script/generate.ts`
- `bun run api:routes-check`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
- `rg -n "agent_goal_concurrency" packages specs`
- `git diff --check`

## Non-solutions explicitly rejected

- Auto-creating spec snapshots or plans from `add_goal`.
- Treating an artifact title or Markdown body as a typed Task contract.
- Keeping all imported Agents as delegated workers and asking the scheduler to be more
  careful.
- Injecting hidden General Requirements/Architect Agents into an active external Squad.
- Keyword-mapping `requirements`, `design`, `coding`, or similar source labels in host
  code.
- Accepting both old and new mapping fields.
- Replacing an installed package silently or mutating an active Task's frozen package
  projection.

## Current-task operator repair evidence (2026-07-22)

The user explicitly authorized repairing the already installed Agent Team so failed
Task `tsk_f89caf290001DAaVEyYPfov1qd` can execute. This is a scoped operator repair of
one installed package, not a silent importer migration or a substitute for the
systemic importer work above.

- Active package: `multica-803e3d6b708f47f19c48ef0219d675f3` in the user-global
  `multica` namespace.
- Recoverable pre-change copy:
  `C:\Users\10132\.local\share\opencorvus\repair-backups\2026-07-22-multica-803e3d6b-before-runtime-adapter-repair`.
- Four package files changed: `expert-squad.jsonc`, package `README.md`, the source
  design Agent overlay, and the package Orchestrator overlay.
- Exact runtime projections now resolve as Requirements → Architect → Build →
  Integrity → Visual QA. The immutable guidance graph is task-scoped Requirements,
  task-scoped Architect, then Goal-scoped Build, Integrity, and Visual QA.
- A live request to the running server's Expert Squad catalog for root Session
  `ses_076350d12ffeb5CpbUBuoDQ1y3` returned these exact `base_role`, `session_kind`,
  and `dispatch_adapter_id` projections; no OpenCorvus or Overlay process was
  restarted.
- The failed Task was retried through the native Task retry route. Its previous error
  was cleared and it entered the project queue. At evidence-capture time it was
  waiting for the independently running Phase 02 Task to release the same project's
  serialized execution slot; this queue wait is not treated as end-to-end success.

The queued Task started at `1784730022499` and crossed the former failure boundary:

- Requirements Session `ses_075ccae74ffdlgHtUfGEK5KE0i` ran on the real
  `requirements` channel and created ready snapshot
  `spc_f8a351fb1001FHFwrCkmM1xRNw` with eight parsed requirements.
- Architect Session `ses_075cab611ffeTyqpluBpHKfeh1` ran on the real `architect`
  channel and created active plan `pln_f8a396bc200110A9cAhcOFU7Tz`.
- The plan persisted five Goals with explicit ordering: inventory → shared foundation
  → parallel aggregate/detail pages → final cross-page verification.
- Build Session `ses_075c647daffenN2Hl85M096ZFi` then started on the real `build`
  channel for the first Goal.
- The Task error remained `null`; the former `no active task contract/spec snapshot`
  failure did not recur.

This completes acceptance of the scoped Agent Team repair and proves the current Task
can execute through typed planning into Goal work. The full webpage delivery remains
an independently running Task and is not represented here as terminal product
acceptance until its downstream Build, Integrity, and Visual QA work finishes.
