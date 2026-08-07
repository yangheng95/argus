# Conversational Expert Squad authoring mode selection

## Recall

### Original request

Synchronize and verify the conversation-driven Expert Squad creation flow. The authoring Skill must name the existing SDK, explain Goal mode, ask whether the user wants Goal-mode authoring, and default to non-Goal mode.

### Acceptance criteria

1. The conversation asks about Goal mode before choosing agents, runtime templates, or workflow topology unless the user already made the choice explicitly.
2. The question explains that Goal mode creates durable, independently accepted Goals with canonical requirements/plan lineage, dependencies, and Goal-scoped delivery evidence.
3. Non-Goal mode is the recommended default. It uses direct Agent dispatch and `virtual_workflows: {}` without fabricating Requirements, Architect, spec, plan, or Goal lifecycle work.
4. Goal mode is opt-in. Its package projects real `requirements` and `architect` adapters before Goal-scoped nodes so canonical spec and plan data can be created.
5. The Skill explicitly uses `@opencorvus-ai/sdk/expert-squad-authoring` to render/write the source package, then the generated client to validate and explicitly import it. It does not instruct an Agent to handwrite the final package tree.
6. The generated portable authoring artifact, English/Chinese authoring documentation, current architecture, and focused tests agree on the same two-mode contract.
7. Registry, Resolver, SDK, manifest identity, installation, and active-profile sources remain unchanged; no host gate, state machine, fallback, compatibility path, or second authoring implementation is added.

### Hard constraints

- Preserve unrelated concurrent worktree changes and stage only this task's files.
- Keep `goal_concurrency` explicit manifest metadata in both modes; it does not itself enable Goal mode.
- Keep `virtual_workflows` required as an explicit record. `{}` means direct non-Goal dispatch; a non-empty graph is binding after selection.
- Do not restart or refresh OpenCorvus/Overlay.

### Sources read

- `AGENTS.md`
- current architecture chapters `01-agents.md`, `04-extensions.md`, and `99-principles.md`
- Multica simple-Squad stability record
- Expert Squad development SDK record
- portable template generator, generated authoring Skill, portable tests, SDK authoring implementation/tests, and English/Chinese Agents and SDK documentation
- `skill-creator` Skill

### Full-repository grep results

| Surface | Disposition |
| --- | --- |
| `renderAuthoringSkill()` | Replace mandatory-workflow guidance with a conversation-first Goal-mode choice and explicit SDK write/validate/import lifecycle. |
| generated `authoring-skill/SKILL.md` | Regenerate from the single generator; never edit the generated artifact independently. |
| portable template human tutorial | Explain the two modes and make SDK materialization the creation path. |
| `portable-template.test.ts` | Assert the question, Goal definition, non-Goal default, empty workflow, typed Goal adapters, and SDK subpath. |
| English/Chinese `agents.mdx` | Document the same conversation choice before the SDK example. |
| English/Chinese SDK reference | Define the two authoring modes beside the Node-only authoring API. |
| `04-extensions.md` | Record the conversation and SDK responsibility boundary as current architecture. |
| Registry/Resolver/protocol/SDK authoring code | Preserve existing single sources; empty workflows and SDK writing already support the desired modes. |

## Root cause

The runtime now correctly supports simple direct-dispatch Squads, but the conversation-facing portable authoring Skill still requires at least one workflow. That stale instruction recreates the same over-modeling during Squad creation. It also mentions only Registry validation and does not identify the SDK writer that owns package materialization, leaving conversational Agents likely to handwrite the package tree.

## Design

The authoring conversation makes one explicit product choice before topology:

- **Non-Goal mode (default):** agents are directly dispatchable, `virtual_workflows` is `{}`, and no canonical spec/plan/Goal lifecycle is invented.
- **Goal mode (opt-in):** durable Goals require canonical requirements and plan lineage, so the package must project typed requirements and architect owners before exact Goal-scoped workflow nodes.

Both modes create one `ExpertSquadPackageDefinition` and materialize it only through `writeExpertSquadPackage` from `@opencorvus-ai/sdk/expert-squad-authoring`. Runtime semantic validation remains `client.expertSquad.validateFolder`; installation remains an explicit `importFolder` call.

## Verification

1. Regenerate the portable template from its repository generator and verify zero generated drift after a second run.
2. Run portable template and SDK authoring tests.
3. Run documentation health, historical-link, and product single-source tests.
4. Run TypeScript, API route, documentation, generated-artifact, and diff checks.
5. Inspect the final staged patch for unrelated concurrent content before commit and legacy remote push.

## Forward test

Following the `skill-creator` validation guidance, an isolated read-only Agent received only the generated authoring Skill and a realistic request to create a two-Agent customer-support Squad. It naturally responded by:

- explaining both modes before topology;
- recommending non-Goal mode and stating it would be used without explicit opt-in;
- mapping the simple case to direct dispatch with `virtual_workflows: {}`;
- reserving typed requirements/architect adapters and binding Goal-scoped workflow nodes for explicit Goal mode;
- describing one `ExpertSquadPackageDefinition` written by `writeExpertSquadPackage`, then validated and explicitly imported through the generated client.

The forward test did not edit the repository or receive the expected answer, implementation diagnosis, or test assertions.

## Verification results

- Portable template plus SDK authoring tests: 31 passed, 0 failed.
- Portable template after final documentation correction: 10 passed, 0 failed.
- Virtual-workflow protocol, historical links, and product documentation single-source tests: 31 passed, 0 failed.
- The official `skill-creator` validator passed the generated `authoring-skill` after supplying PyYAML from an isolated temporary dependency directory; no system Python environment was mutated.
- Two consecutive final generator runs produced the same artifact diff SHA-256: `16aa0da9565d7e3e55ec8bfa36e4922ab735f505ec7a1250ace22d4393e0f1f1`.
- Repository typecheck, API route inventory, API documentation freshness, and Astro documentation checks passed with zero errors.
- The combined document-health run reached 86 passes and one unrelated failure because a concurrent task added `2026-07-22-p0-server-settled-deletion-lifetime.md` to the monthly index while leaving that file untracked. This task preserves and excludes that concurrent file instead of staging it as part of the authoring repair.
