## Agent Abstraction Convergence

Date: 2026-06-24
Status: Implementation plan

### Goal

Collapse agent maintenance to two abstract classes:

- `host`: orchestrator-owned coordinator
- `worker`: every other agent identity

Role-specific differences must become explicit metadata flags on one backend
registry instead of separate pseudo-types copied across `agent.ts`,
`agent-runtime-metadata.ts`, `prompt-profile.ts`, and skill-mount UI data.

This batch also promotes `integrity` to a mounted-skill worker and introduces
an explicit flag for roles that must not accept operator skill mounts or appear
in the skill matrix.

### Recall

| Source                                                         | Constraint                                                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                    | No fallback, no double source, inspect plans before edits, write tests for every behavior change.                          |
| `specs/new-arch/01-agents.md`                                  | Orchestrator is the only lifecycle decision host; integrity owns final acceptance.                                         |
| `specs/new-arch/08-agent-tool-adapter.md`                      | Specialist agents use ToolRegistry; integrity review/output tools are runtime extras.                                      |
| `specs/new-arch/2026-06-23-agent-skill-mount-matrix.md`        | Matrix is a single backend projection; incompatible or non-skill agents must be server-derived, not guessed in overlay.    |
| `specs/new-arch/2026-06-24-orchestrator-expert-squad-skill.md` | Mounted skill visibility must go through canonical `skill` tool and mounted `SKILL.md` frontmatter.                        |
| `packages/opencorvus/src/agent/runner.ts`                      | Worker agents already share one runner; orchestrator is explicitly the host of that abstraction, not another worker shape. |

### Impact Inventory

| Surface                 | Evidence                                                                                                                                         | Required change                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent registry          | `packages/opencorvus/src/agent/agent.ts`                                                                                                         | Stop treating role-specific metadata as ad hoc per-file knowledge; add shared role metadata fields such as `archetype` and `skill_mountable`.                         |
| Role contract           | `packages/opencorvus/src/agent/role-contract.ts`                                                                                                 | Promote this file into the single source for role metadata consumed by registry, runtime metadata, prompt profiles, and skill matrix.                                 |
| Runtime metadata        | `packages/opencorvus/src/session/agent-runtime-metadata.ts`                                                                                      | Derive worker/host session sets from the shared role metadata instead of maintaining parallel hard-coded lists. Preserve explicit non-agent session kinds separately. |
| Prompt profile targets  | `packages/opencorvus/src/agent/prompt-profile.ts`                                                                                                | Derive prompt-profile target groups from the shared role metadata instead of hand-maintained target arrays.                                                           |
| Skill matrix backend    | `packages/opencorvus/src/skill/mounts.ts`                                                                                                        | Return explicit `skill_mountable` and reject mount/unmount for roles with the flag disabled.                                                                          |
| Skill matrix overlay    | `packages/overlay/src/services/extensions.ts`, `packages/overlay/src/components/settings/SkillMarketPanel.tsx`                                   | Filter by backend `skill_mountable` instead of inferring from `skill_tool_available`.                                                                                 |
| Integrity skill surface | `packages/opencorvus/src/agent/agent.ts`, `packages/opencorvus/src/integrity/static-tools.ts`, `packages/opencorvus/src/integrity/team-agent.ts` | Integrity must remain a worker with runtime extra review tools while also exposing canonical `skill` for mounted skill search/load.                                   |
| API/schema/docs         | `packages/opencorvus/src/server/routes/app.ts`, generated SDK/OpenAPI/docs                                                                       | New agent metadata fields must be reflected in public schemas.                                                                                                        |
| Tests                   | agent, integrity, skill-route, skill-tool, prompt-profile, runtime-metadata tests                                                                | Pin the new single-source metadata behavior and matrix visibility contract.                                                                                           |

### Current Problem

The codebase already has one real abstraction boundary:

- orchestrator host
- worker runner

But several files still treat agent names as if they were separate runtime
types:

- `agent.ts` registers role config and tool surfaces
- `agent-runtime-metadata.ts` repeats role lists for runtime behavior
- `prompt-profile.ts` repeats role lists for profile targeting
- `skill/mounts.ts` and overlay matrix infer panel visibility from tool
  availability instead of an explicit operator-mount policy

That duplication is why adding or changing one role, such as `integrity`,
requires touching many parallel lists and ad hoc UI filters.

### Decision

1. Keep only two agent abstractions in shared metadata:
   - `host`
   - `worker`
2. Extend the shared role contract with explicit booleans instead of inventing
   more agent classes:
   - `skill_mountable`
   - `prompt_profile_target`
   - `runtime_contract_required`
   - `exact_runtime_contract`
   - `live_runtime_continuation`
   - `agent_owned_session_kind`
3. `integrity` stays a `worker`, not a third special class. Its special review
   behavior remains runtime extra tools layered on top of the worker surface.
4. Mount-panel visibility uses `skill_mountable`, not `skill_tool_available`.
   A role may technically expose the `skill` tool while still being hidden from
   operator mount UI and rejected by mount mutations.

### Concrete Shape

Role metadata source:

```ts
type AgentArchetype = "host" | "worker"

type PromptProfileTargetMode = "none" | "user" | "builtin"

type AgentRoleContract = {
  id: AgentRoleID
  archetype: AgentArchetype
  description: string
  promptEditable: boolean
  defaultPromptRequired: boolean
  promptConfigMode: "override" | "append" | "none"
  promptProfileTarget: PromptProfileTargetMode
  skillMountable: boolean
  agentOwnedSessionKind: boolean
  runtimeContractRequired: boolean
  exactRuntimeContract: boolean
  liveRuntimeContinuation: boolean
}
```

Agent registry output:

- `Agent.Info` exposes `archetype` and `skill_mountable`
- `integrity.tools.include` contains preview-repair tools plus canonical
  `skill`
- roles with `skill_mountable=false` are hidden from `/skill/mounts` panel rows
  and rejected by mount/unmount/import-and-mount mutations

### Expected Skill Flag Policy

Initial explicit `skill_mountable=false` roles:

- `orchestrator`
- `mission`
- `coding`
- `coding-assistant`
- `general`
- `explore`
- `control`
- `compaction`
- `title`
- `summary`

Initial explicit `skill_mountable=true` roles:

- `build`
- `requirements`
- `architect`
- `frontend-design`
- `frontend-research`
- `intent-analysis`
- `integrity`
- `fact-check`
- `deep-research`
- `goal-workload-analyst`
- `visual-qa`

This preserves mounted-skill support only on specialist workers whose job
includes scoped workflows or evidence playbooks.

### Acceptance

- `AgentRoleContract` becomes the single backend source for agent abstraction
  metadata consumed by registry, runtime metadata, prompt-profile targets, and
  skill matrix projection.
- The codebase exposes at most two abstract classes for agent identities:
  `host` and `worker`.
- `integrity` is a `worker` with canonical `skill` support and still keeps its
  runtime review/consensus extras.
- Skill mount mutations fail loudly for `skill_mountable=false` roles.
- `/skill/mounts` and the overlay settings matrix omit non-mountable roles by
  backend flag, not by front-end guesses.
- Tests cover the new flag, derived metadata lists, integrity skill visibility,
  and mount rejection for hidden roles.
