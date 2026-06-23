# Agent Skill Mount Matrix

Date: 2026-06-23
Status: Implementation design, revised for YAML mount source

## Task

Design a skill management and mount system where installed/discovered skills form a
pool, and each agent has an explicit mounted skill set. The overlay toolbar must keep a
per-agent skill configuration matrix, highlight pool skills that are not mounted to any
agent, and support manually assigning skills from the pool to agent mount areas.
Compatibility discovery for `.agents`, `.claude`, `.codex`, and `.opencorvus` skills
stays intact, but those skills are unusable until mounted.

## Recall

| Source                                                      | Constraint carried forward                                                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                 | No fallback, no hidden gates, no double source, no hidden skill prompt injection, inspect existing plans before edits.                  |
| `2026-05-21-remove-stage-skill-injection.md`                | Skills must be visible workflows loaded through the `skill` tool. Stage-based hidden injection must not return.                         |
| `2026-05-21-orchestrator-skill-loop-provider-error-fuse.md` | Orchestrator must not inherit generic skill policy; specialist agents own task-specific skill loading.                                  |
| `2026-06-08-frontend-agents-skill-tool.md`                  | Prompt visibility and runtime tool transport must agree; frontend agents get `skill` through exact runtime toolkits where needed.       |
| `2026-06-10-skill-expiry-duplicates.md`                     | Discovery is the single source for expiry and duplicate metadata; overlay consumes server evidence.                                     |
| `2026-06-10-external-skill-directory-parity.md`             | `.claude`, `.agents`, `.codex`, and `.opencorvus` skill roots are one discovery pool.                                                   |
| `2026-06-17-skill-mcp-panel-single-source.md`               | Skill/MCP panels render from shared store data, not panel-local copies.                                                                 |
| `2026-06-16-prompt-profile-expert-squad-switching.md`       | Use one backend-owned profile/compiler source for cross-agent configuration; do not mutate many per-agent fields to simulate a profile. |
| `2026-06-22-prompt-profile-task-session-owner.md`           | Selected task/session scope must not silently fall back to project scope while the root session is unresolved.                          |

## Current State

| Surface              | Evidence                                                                 | Finding                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Discovery            | `packages/opencorvus/src/skill/skill.ts`                                 | `Skill.all()` returns one global pool from builtins, external roots, config paths, and URLs. `Skill.Info.agents` exists but is skill-authored metadata, not operator mount state.                                                                |
| Install/manage       | `packages/opencorvus/src/skill/manager.ts`, `src/server/routes/skill.ts` | `/skill/installed` exposes installed pool metadata and global skill permission policy. It has no per-agent mount shape.                                                                                                                          |
| Prompt injection     | `packages/opencorvus/src/session/system.ts`                              | `SystemPrompt.skills()` lists every compatible, non-denied skill when the agent can call `skill`; no mount matrix participates.                                                                                                                  |
| Runtime tool         | `packages/opencorvus/src/tool/skill.ts`                                  | `SkillTool` independently filters the global pool by permission, platform, frontmatter `agents`, and `required_tools`. This duplicates prompt filtering logic.                                                                                   |
| Turn composition     | `packages/opencorvus/src/session/loop.ts`                                | A model turn resolves tools, then renders `SystemPrompt.skills(agent, availableToolNames)`. The skill policy and `SkillTool` are not fed by a shared resolved skill surface.                                                                     |
| Agent registry       | `packages/opencorvus/src/agent/agent.ts`                                 | Tool surfaces decide whether `skill` exists at all. Orchestrator and Mission intentionally exclude `skill`; requirements, architect, frontend-design, frontend-research, visual-qa, intent-analysis, build can expose it through their surfaces. |
| Config               | `packages/opencorvus/src/config/config.ts`                               | `skills` only stores paths and URLs. Session overlay deliberately excludes permission/tools/MCP; it currently has no skill mount field.                                                                                                          |
| Overlay              | `packages/overlay/src/components/settings/SkillMarketPanel.tsx`          | The Skills panel installs/removes/opens skill sources and imports dropped files. It is not an agent-skill matrix.                                                                                                                                |
| Existing matrix peer | `packages/overlay/src/components/settings/AgentModelsPanel.tsx`          | Per-agent settings already support project/session scope and grouped agent rows; this is the closest UI pattern to reuse.                                                                                                                        |

## Root Cause

The product has a skill pool but no operator-owned mount relation. Runtime behavior is
derived from global discovery, global skill permission, agent tool include/exclude lists,
and skill-authored metadata. That means different agents can see the same installed skill
unless the skill author or hard-coded tool rules happen to exclude them. The overlay can
only manage the pool, so it cannot show or edit the real agent-specific skill surface.

## Decision

Introduce a first-class **Agent Skill Mount** field in each `SKILL.md` frontmatter.
Discovery remains the skill pool. The `mounted_agents` YAML field defines which pool
entries are visible to each agent. The same resolved mount surface feeds both the
model-visible Skill Policy and the `skill` tool search/load results.

Conceptual `SKILL.md` frontmatter shape:

```yaml
---
name: review-workflow
description: Review workflow skill.
agents:
  - requirements
mounted_agents:
  - requirements
  - architect
---
```

Rules:

- Installed skills are not automatically visible to every agent.
- `mounted_agents` is the single project-level source of truth for mounted agents.
- External/user-installed skills start unmounted until the operator mounts them.
- `.agents`, `.claude`, `.codex`, and `.opencorvus` discovery roots all feed the same
  pool. Discovery/import is pool membership only; it never grants runtime use.
- Any discovered, imported, or dropped skill is represented in the pool before it can be
  mounted. A drag/drop-to-agent mutation may import and mount in one typed operation, but
  persistence still remains the imported `SKILL.md` plus its `mounted_agents` YAML field.
- A skill with zero mounted agents is unusable and must be reported as `unmounted` in the
  matrix projection so the toolbar can highlight it.
- A pool skill that is already mounted remains draggable/selectable. The pool row shows
  `mounted_agents`, but mounting the same skill to additional agents is still allowed.
  The same agent-skill relation is stored once; duplicate entries inside `mounted_agents`
  are invalid frontmatter.
- `Skill.Info.agents` becomes a compatibility constraint and search hint, never an
  automatic mount source.
- `required_tools` remains a compatibility constraint; a skill cannot be mounted to an
  agent whose effective tool surface cannot satisfy it.
- Global `permission.skill` remains the trust/approval policy. A denied skill is not
  loadable even if mounted, and the matrix must show that conflict as server evidence.
- Orchestrator and Mission remain non-skill agents unless their tool surface is
  deliberately changed by a separate design.

## Runtime Surface

Create one resolver, for example `AgentSkillMount.resolve(input)`, used by all skill
consumers:

```ts
type ResolvedAgentSkillSurface = {
  agent: string
  scope: "project" | "session"
  tool_available: boolean
  unmounted_pool_count: number
  skills: Array<{
    name: string
    mounted: true
    enabled: boolean
    reason?: "permission_denied" | "platform_incompatible" | "missing_required_tool" | "agent_incompatible"
    location: string
  }>
}
```

The model turn should resolve this once from:

1. session-owned agent identity;
2. effective config, including project config plus root-session overlay when present;
3. resolved tool IDs for that exact model turn;
4. current skill pool metadata.

Then:

- `SystemPrompt.skills()` renders only `surface.skills` where `enabled === true`.
- `SkillTool` searches and loads only the same enabled surface.
- Tool-call metadata records agent, skill name, mount scope, and skill location.
- Unknown mounted skill names, unknown agent ids, or invalid compatibility are hard
  errors surfaced before the model call, not silently ignored.

This eliminates the current double filtering between `session/system.ts` and
`tool/skill.ts`.

## API Shape

Keep existing pool APIs:

- `GET /skill`
- `GET /skill/installed`
- `POST /skill/install`
- `POST /skill/import-file`
- `POST /skill/remove`
- `POST /skill/policy`

Add a read projection for the matrix:

- `GET /skill/mounts?sessionID=...`

Response should include:

- `skills[]`: installed pool entries with trust, risk, duplicate locations, policy.
- each pool skill includes `mounted_agents`, `unmounted`, and warning/conflict metadata
  computed by the backend.
- `agents[]`: known agents, descriptions, mode, hidden/native flags, skill-tool availability.
- `matrix[]`: one row per agent with mounted skill names and server-derived disabled reasons.
- `project_mounts`, computed from `SKILL.md` frontmatter so overlay can show origin
  without guessing.
- `unmounted_count`: total pool skills that have no mounted agents.

For writes, use one typed mutation layer that persists only to `SKILL.md` frontmatter:

- project scope writes the target skill's `mounted_agents` YAML field.
- unmount removes the agent from the same YAML list and preserves an empty list when no
  agents remain, so unmounted state stays visible in the file.
- the mutation validates agent id, skill name, skill-tool availability, platform, and
  required tool compatibility before saving.
- an import-and-mount mutation accepts the same dropped source payload as
  `/skill/import-file`, writes the skill into the pool, resolves all imported skill names,
  validates the target agent, and then writes each imported skill's mount in the same request.

The persistence source remains skill frontmatter. A dedicated route may perform typed
validation, but it must not create another storage location.

## Overlay Matrix

Add a toolbar-owned Agent Skills matrix. The existing skill toolbar entry should open this
matrix-first view, with the pool install/import surface still available inside the same
area or as a secondary tab. The toolbar entry must show a warning badge when
`unmounted_count > 0`.

Layout:

- Left pane: skill pool with search, source/trust/risk/duplicate/policy badges.
- Pool rows with zero mounted agents use a warning treatment and an explicit "unmounted"
  status.
- Right pane: grouped agent mount areas, reusing the Agent Models grouping pattern.
- Each mounted skill is a compact chip with open/details/remove controls.
- Drag a skill from the pool to an agent mount area to mount it.
- Drag a skill file/folder/zip directly to an agent mount area to import it into the pool
  and mount it to that agent through the import-and-mount mutation.
- Drag a mounted chip out or use its remove icon to unmount it.
- Keyboard-accessible mount/unmount buttons must use the same mutation path as drag.
- Conflict states are server-derived: denied policy, incompatible platform, missing required
  tool, agent frontmatter mismatch, or agent cannot call `skill`.
- Settings-panel matrix and toolbar matrix share the same data and mutation path, but
  they are not the same layout target. The settings panel must reserve management-grade
  width for full agent names, keep the skill pool column sticky and highlighted, keep the
  agent header row sticky and highlighted, remove agents that cannot expose the `skill`
  tool, and preserve visible skill row order after mount/unmount responses. Toolbar
  compact mode may rely on horizontal scrolling, but it must still use the same component
  contract rather than a second renderer.
- Matrix pool rows must render a source-directory badge with stable directory-scoped color.
  `.opencorvus`, `.claude`, `.agents`, `.codex`, built-in, and custom source directories
  must not collapse into the same visual treatment, and the color must derive from the
  directory identity rather than row position.

Implementation guidance:

- Use existing Solid/Kobalte primitives for tabs, selects, buttons, tooltips, and rows.
- Do not hand-roll a large fragile drag state machine. If drag becomes more than simple
  HTML drag/drop, choose a Solid-compatible accessible DnD primitive during implementation
  and wrap it in a small local component.
- For large skill pools, use the existing `virtua` dependency to virtualize the pool and
  matrix lists.
- The current `SkillMarketPanel` should remain the pool install/import surface; do not mix
  install source management and per-agent mounting into one component.

## Session And Message Handling

Skill mounts affect prompt and tool availability, so they must follow task/session
ownership rules:

- Matrix edits affect future turns after skill metadata is reloaded.
- Selected task/session views may pass session identity for agent-config resolution, but
  mount persistence remains `SKILL.md` frontmatter rather than session metadata.
- A running model turn uses the turn-scoped resolved skill surface; mid-turn matrix edits
  affect the next turn, not the already-built prompt/tool surface.
- Skill load tool results remain visible normal tool messages. No synthetic messages or
  model-only skill bodies are introduced.

## Migration And Retirement

Implementation should retire, not preserve, the current broad skill visibility behavior:

- Replace `SystemPrompt.skills()` direct `Skill.all()` filtering with the mount resolver.
- Replace `SkillTool` direct global filtering with the same resolved surface.
- Keep `Skill.Info.agents` only as metadata/compatibility.
- Keep `/skill/installed` as the installed pool view.
- Remove tests that assert "all compatible skills are visible to every skill-capable
  agent" and replace them with mount-specific assertions.

## Required Tests

Backend:

- `Skill.Info` and `/skill/installed` expose `mounted_agents` from `SKILL.md` frontmatter.
- Matrix route returns installed skills, agents, effective mounts, and disabled reasons.
- Matrix route returns `.agents`, `.claude`, `.codex`, and `.opencorvus` discovered skills
  in the pool while marking zero-mount skills as unmounted.
- `POST /skill/mount` writes the target skill's `mounted_agents` YAML field.
- `POST /skill/unmount` removes only that agent from the YAML field and keeps the field visible.
- `POST /skill/import-and-mount` writes every imported skill's `mounted_agents` field.
- Mounted skill appears in `SystemPrompt.skills()` for that agent only.
- Unmounted skill cannot be searched or loaded by `SkillTool`.
- Discovered but unmounted compatible skills remain absent from both Skill Policy and
  `SkillTool` results.
- Prompt policy and `SkillTool` use the same resolved surface.
- Orchestrator and Mission do not receive skill policy or skill tool through mounts.
- `Skill.Info.agents` remains a compatibility constraint, not a mount source.

### 2026-06-23 runtime contract audit

Codex review feedback after the first mount implementation found a second `skill` tool entry path:

| Callsite                                                | Status                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ToolRegistry.tools()` registry `SkillTool`             | Must be rebound with the turn-scoped `SkillMount.resolve()` surface.                                                |
| `frontend-research` runtime contract `skill` extra tool | Must be rebound with the same surface; the exact runtime contract must not keep a stale `SkillTool.init()` closure. |
| `frontend-design` runtime contract `skill` extra tool   | Must be rebound with the same surface; required-tool filtering must use the exact per-turn tool list.               |
| `visual-qa` runtime contract `skill` extra tool         | Must be rebound with the same surface; mounted-but-disabled skills stay unavailable.                                |
| MCP or plugin tool named `skill`                        | Must not shadow OpenCorvus skill policy; `skill` is a reserved canonical tool id.                                   |

`SessionLoop.resolveTools()` is the single binding point after registry, MCP, and runtime-contract
tools are merged and switches have been applied. If `skill` exists in the final tool map, it is
replaced by the canonical `SkillTool` initialized with the resolved surface for that exact turn.
This means a model may still attempt `skill({"name":"..."})`, but an unmounted or disabled skill
fails at execution and cannot return full skill content.

### 2026-06-24 overlay refresh audit

The matrix refresh button must not depend on whichever panel last configured the global API
directory. Toolbar panels and the settings dialog pass the active project directory directly into
`SkillMarketPanel`, and `currentDirectory()` applies that directory before every project-scoped
request.

`/skill/mounts` is the single overlay projection for the matrix and skill pool. `loadExtensions()`
and the skill panel reload path must not concurrently call `/skill/installed` and `/skill/mounts`,
because both write `appStore.skills` and the later response can make a successful matrix refresh
look unchanged. `/skill/installed` remains only the installed-pool route for delete/partial-failure
reconciliation.

Overlay:

- Agent Skills panel renders pool + agent matrix from `/skill/mounts`.
- Toolbar skill entry shows a warning badge when the backend reports unmounted pool
  skills.
- Drag/drop mount and button mount call the same mutation helper.
- Dropping a skill source onto an agent mount area imports it into the pool and mounts the
  resolved skill to that agent.
- Unmount updates the row without creating panel-local state drift.
- Denied or incompatible mounted skills render server-provided disabled reasons.
- Existing Skills panel still renders installed pool and import/delete behavior from
  `appStore.skills`.

Visual:

- Capture the new matrix panel in project scope and selected-session scope.
- Verify dense lists do not overlap or resize unexpectedly at compact overlay widths.
- Verify pool rows show stable, distinct source-directory color badges for `.opencorvus`,
  `.claude`, `.agents`, `.codex`, built-in, and custom source directories.

## Non-Goals

- Do not reintroduce stage skill injection.
- Do not auto-detect skills from user text or keywords.
- Do not let skill mounts change agent tools, MCP servers, model, workflow, routing, or
  orchestrator dispatch.
- Do not hide skill loading in synthetic messages.
- Do not use prompt-only instructions to simulate enforcement.
