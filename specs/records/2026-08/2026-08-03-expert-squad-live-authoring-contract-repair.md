# Expert Squad Live Authoring Contract Repair

## Recall

| Item | Evidence |
| --- | --- |
| User request | Use the NVIDIA investment-research case to test automatic Expert Squad generation with the Exa key, run with `openai/gpt-5.6-luna`, explain the repeated authoring errors, cross-audit the failure, then “修复问题，再次复审”. |
| Acceptance criteria | The visible “现场生产专家团” action must stay in an ordinary conversation, load the exact `expert-squad-authoring` production Skill, expose the canonical package definition shape before the first author call, and create a project-scoped Squad without diagnostic-driven schema discovery. Native Mission must retain coordination authority without the author tool. The NVIDIA case must reach an installed Squad receipt on the first substantive author call, after which a new conversation can select that Squad. |
| Hard constraints | Preserve all unrelated work; no stash/reset/restore; no fallback, compatibility field, Host workflow gate, hidden message, second schema, or second package writer. UI acceptance uses the real page and fresh screenshots only; do not add, modify, or run UI automation tests. Non-UI tests assert complete positive tool surfaces, schema transport, SDK/Registry authoring, and installed receipt. Use Exa without printing its key. Commit subjects start with `dsw-33987` and push through normal hooks to `legacy-remote/v0.0.29beta`. |
| Existing records read | `specs/current/architecture/04-extensions.md`; `specs/records/2026-07/2026-07-30-mission-automatic-expert-squad-production-phase.md`; `specs/records/2026-08/2026-08-02-composer-expert-squad-keyboard-and-live-authoring.md`; `packages/opencorvus/src/prompt/core/mission-core.txt`. Current architecture supersedes automatic Mission production: explicit authoring belongs to an ordinary conversation/Task, while Mission holds only launch-time Squad authority. |
| Whole-repository grep | The Composer action writes both `@squad("advanced")` and `@skill("expert-squad-authoring")`; any visible Squad reference routes the submission to Mission. Native conversation runtime already parses visible `@skill` directives and mounts exact production Skills. Mission mounts only Mission Skills. `expert_squad_author` currently sits in the shared primary execution pool, so Mission receives it accidentally. The author AI tool currently exposes only `definition_json: string`, while the canonical manifest Zod schema and Registry closure remain hidden. |
| Live evidence | Mission `662a37de1c4e3ad8`, Session `ses_03a7d02ddffe3Q4KUADAoNdGxo`, model `openai/gpt-5.6-luna`. SQLite recorded zero Engine Tasks, two loads of Mission Skill `general`, zero production Skill loads, and seven author calls: 8, 5, 24, 123 diagnostics, malformed JSON, one empty-workflow diagnostic, then operator abort. No package was installed. Exa `web_search_exa` succeeded; `get_code_context_exa` was unavailable independently of the key. |
| Independent audit | Contract/projection, black-box authorability, and source/runtime reviewers independently agreed that the production Skill was not mounted, the model used validation errors as incremental schema discovery, Mission crossed its Task boundary, and the opaque string ABI amplified the failure. The black-box reviewer also attributed malformed JSON, empty workflow nodes, and unsupported success claims to the model itself. |
| Dirty-worktree evidence | At start: HEAD `8c801af60b7064e839d194b9a5cc21a713ffc526`, branch `v0.0.29beta`, remote already aligned. One pre-existing modified generated artifact exists at `specs/artifacts/portable-expert-squad-template/authoring-skill/SKILL.md`; its changes align the artifact with the already-current runtime Skill and must be preserved. |

## Root cause

The visible action represents two incompatible execution models. Adding
`@squad("advanced")` makes the submit route a Mission, while adding the ordinary
production Skill assumes a native conversation or projected Task scheduler.
The Mission branch correctly removes the ordinary Skill loader, but its shared
primary tool pool incorrectly retains `expert_squad_author`. Luna therefore
received the author tool without the authoring contract.

The tool then hid the complete definition behind `definition_json: string`.
SDK and Registry validation remained authoritative and correctly rejected every
candidate, but their shape was discoverable only after failure. The Skill also
lacked a complete positive definition example and the exact runtime-template
identities needed to survive Registry validation.

## Repair

1. Make “现场生产专家团” select only the exact production Skill. With no Squad
   directive, the existing conversation path remains active, mounts that Skill
   from the visible directive, and retains the author tool.
2. Move `expert_squad_author` out of the shared primary execution pool and into
   the ordinary coding/chat/work pool. Projected Advanced schedulers continue
   to receive it through their explicit package declaration. Mission therefore
   exposes its complete positive coordination surface without authoring
   authority.
3. Replace the string and full-manifest transports with one compact blueprint:
   package identity, scope, inline README/selector/scheduler/Agent prompts,
   Agent projection resources, and workflow topology. The Host deterministically
   owns canonical prompt paths and package-file projection. The model-facing
   Zod schema composes canonical SDK identity/graph/resource leaf schemas and
   the Host-owned runtime-template enumeration, fills omitted empty projection
   lists, and canonicalizes dependency lists before constructing the one SDK
   `ExpertSquadPackageDefinition`. Continue to call the same SDK validator,
   writer, Registry validation, and Manager import; add no second runtime
   schema, validator, or writer.
4. Add a compact complete positive reference definition to the built-in Skill,
   validate that reference through the same SDK and Registry path, and package
   it as a supporting Skill file. It uses only platform/default capabilities
   and canonical Agent prompt paths so it does not imply a private runtime.
5. Update the current architecture and supersede the old live-authoring record
   where their action semantics still claim Mission production.

The first two packaged re-runs after the initial repair remained failed
acceptances, not passes. Luna first omitted canonical empty arrays, emitted
non-canonical `depends_on` ordering, and nested `files`,
`installation_scope`, and `replace` under `manifest`. Defaulting the arrays and
dependency order removed only the first two defects; exposing
`{manifest, files, installation_scope, replace}` still left one very large
manifest wrapper that the model failed to close after long file bodies. The
flat full manifest merely moved that failure under `capability_projection`.
The final model-facing request therefore removes manifest/file-path
bookkeeping altogether while the Host deterministically reconstructs the same
sole SDK definition internally. That compact blueprint immediately eliminated
all structural errors and installed the requested Squad, but its first call
still redundantly projected `websearch` onto the Orchestrator scheduler and was
rejected by Registry before an exact retry succeeded. The final blueprint
therefore fixes scheduler inheritance plus `dispatch_agent` and worker
base-role inheritance as platform facts; authors declare only genuine
package/default resource refs. Exa remains a worker runtime capability selected
through a research base role, not a manifest-owned scheduler tool.

## Positive verification

- Complete Coding and Mission tool surfaces: ordinary conversation owns
  `expert_squad_author`; Mission owns the exact coordination surface.
- Structured author input schema accepts a complete canonical definition and
  the conversation author returns the installed identity, digest, projected
  Agents, workflow topology, file count, and target.
- Built-in authoring Skill payload contains and can load the reference file;
  the reference validates through SDK and Registry.
- Existing explicit Chat Skill SessionLoop test proves a visible
  `@skill("...")` directive mounts and loads the exact Skill.
- Focused non-UI tests, package typecheck/build, API/docs checks, and document
  health checks pass.
- The real packaged page shows the action writing only
  `@skill("expert-squad-authoring")`; submitting stays in Chat, visibly loads
  the Skill, and the NVIDIA authoring request succeeds on its first substantive
  author call with `openai/gpt-5.6-luna`.
- Independent post-fix reviewers inspect contract projection, black-box
  authorability, and runtime/source consistency without sharing draft
  conclusions.

The v6 black-box run used Session `ses_03a1d3ab2ffeDCtpOI1WmJzDeK`, async Task
`tsk_fc5e30d8b001mqriy4IDX1Mw8j`, and exact model
`openai/gpt-5.6-luna`. It proved that one author call could install a complete
package, but independent review rejected it as final acceptance. Its
`fact-check` Agent was an initial frontier even though that adapter requires an
upstream assistant message, the package dropped the original “not investment
advice” boundary, and Luna made an unauthorized global-memory write after the
successful receipt. The exact memory side effect
`mem_fc5e45a76001n7kbv1I5ZmFk3g` was deleted through one explicit corrective
call, with a `deleted: true` receipt and no other corrective mutation.

The repair consequently tells authors to use `deep-research` for independent
public evidence, requires explicit legal/safety/not-advice boundaries in
README, selector, scheduler, and final delivery Agent prompts, and makes the
post-receipt boundary explicit: return the receipt directly without memory,
activation, workflow execution, or another state mutation. Fact-check topology
remains a model-owned authoring decision rather than a Host semantic gate.

The first v7 run then proved the author contract itself on one successful call,
with a valid dependent `fact-check`, all four disclaimer surfaces, and no
post-receipt state mutation. It nevertheless made one invalid preliminary
Skill call by supplying a text-file `limit` without a supporting `file`.
The Skill tool's model-facing `name` description now says that root
`SKILL.md` loading supplies `name` alone and omits `file`, `offset`, and
`limit`. A v8 run verified that this removed the Skill-loading error, but Luna
then misplaced `virtual_workflows` and `extra_files` inside `agents`; the
author schema correctly rejected that malformed call before an exact retry.
Neither partial run is counted as final acceptance.

The v9 candidate used Session
`ses_039fdd855ffedNQix8g4xTjEpf`, async Task
`tsk_fc602669e001FuaEa4Gh24gldn`, and exact model
`openai/gpt-5.6-luna`. The one Session completed with four successful tool
calls and no failures: Skill search, root Skill load, complete reference load,
and exactly one `expert_squad_author`. The installed project package is
`audit-v9/nvidia-investment-research-audit-v9-20260803`, version
`2026.08.03.1`, digest
`187f2f1a14d098eb2d9ba46ceaef182ad5e35d4626e9ddbec9f87d2c16ed4ba8`,
with four projected Agents and eight files. Its workflow starts two independent
`deep-research` frontiers and one `fact-check` node that depends on both.
Independent black-box review rejected this as final acceptance: one
`fact-check` execution can bind only one exact target Session/message, so one
node cannot truthfully verify two independent predecessor messages. The
authoring contract now requires exactly one upstream producer per
`fact-check` node; authors must use separate checkers per message or synthesize
one combined message first. This stays in the Skill and model-facing schema
description, not a Host topology gate. The v9 package's disclaimer, unknown
data, digest, catalog, no-side-effect, and UI evidence otherwise passed.

Final black-box acceptance used Session
`ses_039f3adb1ffe8RdJ7h4ZAqzRN9`, async Task
`tsk_fc60c8e76001Q3j7x2qE1OVWuG`, and exact model
`openai/gpt-5.6-luna`. Without an operator-authored fact-check topology hint,
the revised Skill produced three independent `deep-research` nodes, three
separate `fact-check` nodes that each depend on exactly one research message,
and one final Build Agent that depends only on the three checking results.
Skill search, root Skill load, reference load, and the single
`expert_squad_author` call all completed without error; there were no other
tool calls or child Sessions. The project package is
`audit-v10/nvidia-investment-research-audit-v10-20260803`, version
`2026.08.03.1`, digest
`2a9e001b03536a3e9c8cefeaf4df981d6589a67b594a48181e854c82378395c4`,
with seven projected Agents and eleven files. Independent Registry-ABI digest
calculation matched the receipt; Catalog reported one valid project
installation, no issue or warning, and `base` remained the active identity.
README, selector, scheduler, and final Agent each retain the research-test,
unknown-data, no-fabrication, and not-investment-advice boundaries without
semantic loss. The signed ARM64 App, DMG, and archive matrix passed installer
payload validation. The final packaged page was manually inspected on port
7878: the standalone action produced exactly one blue
`@skill("expert-squad-authoring")` token with no Squad or Mission token and
Online diagnostics.
