# 2026-05-21 Remove Stage Skill Injection

## Problem

The current skill system still has a stage-routed path:

- `runAgentSession` accepts `skillsStage` / `skillTaskSignals`.
- `composeSystemPrompt` calls `resolveStageSkills`.
- `resolveStageSkills` injects matched skill bodies into the hidden system prompt.
- `stage` controls required-tool ownership and stage invariants.
- Build can complete without an auditable `skill` tool call because the host
  may inject skill content invisibly.

That conflicts with the intended model: skills are agent-visible workflows that
agents search and load through the `skill` tool. Stage labels must not be a
host-side routing mechanism.

## Call Sites

- `packages/opencorvus/src/agent/runner.ts`
  - Owns `skillsStage`, `skillTaskSignals`, `resolveStageSkills` composition,
    and build tool switches derived from `requiredTools`.
- Stage callers:
  - `packages/opencorvus/src/build/agent.ts`
  - `packages/opencorvus/src/architect/agent.ts`
  - `packages/opencorvus/src/frontend-design/agent.ts`
  - `packages/opencorvus/src/intent-analysis/agent.ts`
  - `packages/opencorvus/src/requirements/agent.ts`
- Skill metadata and rendering:
  - `packages/opencorvus/src/skill/skill.ts`
  - `packages/opencorvus/src/skill/manager.ts`
  - `packages/opencorvus/src/tool/skill.ts`
- Built-in skills:
  - `packages/opencorvus/src/skill/builtin/webpage-generate.md`
  - `packages/opencorvus/src/skill/builtin/image-generate.md`
  - `packages/opencorvus/src/skill/builtin/research-report.md`
- Tests:
  - `packages/opencorvus/test/engine/skill-inject.test.ts`
  - `packages/opencorvus/test/agent/runner-tool-scope.test.ts`
  - Agent tests that assert `skill` is visible to planning stages.
- Docs:
  - `docs/product/*/opencorvus/skills.md`
  - `packages/web/src/content/docs/*/skills.mdx`

## Decision

Delete the stage-routed injection mechanism instead of trying to repair it:

- Remove `skillsStage` and `skillTaskSignals` from `runAgentSession`.
- Remove hidden system-prompt skill body injection from the runner.
- Remove stage invariants and required-tool ownership logic from
  `engine/skill-inject.ts`; keep URL signal helpers if still useful.
- Keep `auto_detect` metadata for search/listing and future ranking, but it no
  longer injects prompt content.
- Keep `required_tools` as descriptive skill metadata only; it no longer gates
  Build success or opens gated tools.
- Remove `stage` from accepted skill metadata and skill search output.
- Ensure the Build agent has visible `skill` tool access and receives the
  generic Skill Policy list through the normal session system prompt.

## Acceptance

- No production code references `skillsStage`, `skillTaskSignals`,
  `resolveStageSkills`, `loadStageSkills`, `STAGE_INVARIANTS`, or stage-owned
  required-tool logic.
- Build tool scope tests assert `skill` is enabled for build sessions.
- Skill tests assert stage frontmatter is ignored/absent from public metadata.
- Docs no longer describe stage-owned required tools or hidden stage injection.
- Targeted tests and typecheck pass.
