# Orchestrator Expert Squad Skill

Date: 2026-06-24
Status: Implementation plan

## Goal

Add Orchestrator-owned expert-squad selection and expert-squad skill loading.
Rename the frontend prompt profile to the frontend replica expert squad, rename
the testing prompt profile to the frontend automation debug expert squad, and
add built-in skills that teach the Orchestrator when and how to use those two
expert squads.

### 2026-06-24 User Clarification

The scheduler must own automatic expert-squad adjustment from the user's
request. In this architecture the scheduler is the Orchestrator wake: it reads
the operator request and task evidence, loads only mounted Orchestrator
expert-squad skills through the visible `skill` tool, and calls
`select_expert_squad` before dispatching downstream specialists when the loaded
skill names a different prompt profile.

This is not a host-side keyword classifier, hidden skill injection, fallback
profile selector, workflow branch, or per-agent prompt mutation. If no mounted
expert-squad skill is evidence-backed for the request, the existing explicit
`prompt_profile.active` value remains the source of truth until a later
Orchestrator decision changes it.

## Recall

| Source                                                      | Constraint                                                                                                                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                 | No fallback, no double source, no hidden prompt injection, inspect plans before edits, and test code changes.                                                                                  |
| `2026-06-16-prompt-profile-expert-squad-switching.md`       | Expert squads are prompt profiles compiled by one backend registry. They must not create workflows, routing branches, per-agent prompt mutations, or keyword selection gates.                  |
| `2026-06-22-testing-expert-squad-profile.md`                | The old `testing` profile lives in `PromptProfile.builtIns`; changing its product meaning belongs in that registry and related tests.                                                          |
| `2026-06-23-agent-skill-mount-matrix.md`                    | Skill visibility must go through mounted `SKILL.md` frontmatter and the canonical `skill` tool. Full skill bodies are loaded through visible tool results, not hidden prompt injection.        |
| `2026-06-08-frontend-agents-skill-tool.md`                  | Exact runtime contracts must expose `skill` in the actual runtime tool set, not only in the agent registry.                                                                                    |
| Pre-June orchestrator skill-loop provider error fuse record | The previous Orchestrator skill ban prevented generic skill-loop drift. This task intentionally supersedes that ban with explicit expert-squad skills and a tested Orchestrator skill surface. |

## Impact Inventory

| Surface                          | Call points                                                                                                                   | Action                                                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt profile registry          | `packages/opencorvus/src/agent/prompt-profile.ts`                                                                             | Rename built-in IDs to `frontend-replica` and `frontend-automation-debug`; update default and role-scoped overlays.                          |
| Prompt profile backend tests     | `packages/opencorvus/test/agent/prompt-profile.test.ts`, server/task/session route tests                                      | Update expected IDs, labels, default active profile, config activation, and prompt composition assertions.                                   |
| Orchestrator registry surface    | `packages/opencorvus/src/agent/agent.ts`                                                                                      | Add `skill` and `select_expert_squad` to the Orchestrator declared tool surface.                                                             |
| Orchestrator exact runtime tools | `packages/opencorvus/src/orchestrator/tools.ts`, `packages/opencorvus/src/session/loop.ts` existing finalizer                 | Add `select_expert_squad` and a runtime `skill` placeholder so `SessionLoop` rebinds it to the canonical mounted-skill surface for the turn. |
| Session prompt profile overlay   | `Session.mergeConfigOverlay`, `EffectiveConfig.base`, `PromptProfile.assertKnownProfileID`                                    | Use the existing root-session config overlay as the single selection source.                                                                 |
| Skill builtins                   | `packages/opencorvus/src/skill/skill.ts`, `packages/opencorvus/src/skill/builtin/*.md`                                        | Add two built-in `SKILL.md` files mounted to `orchestrator`; do not add auto-detection or hidden loading.                                    |
| Skill tests                      | `packages/opencorvus/test/skill/skill.test.ts`, `packages/opencorvus/test/tool/skill.test.ts`, agent/session exact-tool tests | Prove built-in skills are mounted to Orchestrator and can be searched/loaded through the canonical `skill` tool.                             |
| Overlay fixtures                 | Prompt profile fixtures under `packages/overlay/test`                                                                         | Update visible fixture rows where tests pin built-in prompt profiles.                                                                        |

## Work Checklist

1. Rename prompt profiles in the single backend registry.
2. Add Orchestrator `select_expert_squad` tool that writes only
   `prompt_profile.active` into the task root session overlay.
3. Add Orchestrator runtime `skill` exposure through the exact contract path.
4. Add built-in skills:
   - `frontend-replica-expert-squad`
   - `frontend-automation-debug-expert-squad`
5. Update tests for renamed profiles, Orchestrator skill visibility, the
   selection tool, and built-in skill loading.
6. Run focused backend and overlay tests, then self-review the changed prompt and
   skill surfaces.

## Acceptance

- The default prompt profile is `frontend-replica`; the old `frontend` built-in
  ID is gone.
- The old `testing` built-in ID is gone and replaced by
  `frontend-automation-debug`.
- Orchestrator prompt discipline makes request-based expert-squad selection a
  scheduler responsibility: load the relevant mounted expert-squad skill
  visibly, then call `select_expert_squad` before dispatch when evidence proves
  a profile switch.
- Orchestrator can call `select_expert_squad` to set the current task root
  session's active prompt profile; unknown profile IDs fail before writing.
- Orchestrator receives the canonical `skill` tool in exact runtime turns and
  sees only mounted enabled skills.
- The two new expert-squad built-in skills are mounted to Orchestrator and are
  loaded only through visible `skill` tool calls.
- No keyword classifier, fallback profile, per-agent prompt mutation, hidden
  skill injection, workflow branch, or route bypass is introduced.
