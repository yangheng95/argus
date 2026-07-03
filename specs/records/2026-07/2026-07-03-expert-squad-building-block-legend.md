# Expert Squad Building Block Legend

Date: 2026-07-03

Status: implemented for documentation/diagram update.

Glossary:

- A2A means Agent-to-Agent.
- API means Application Programming Interface.
- DB means Database.
- LLM means Large Language Model.
- MCP means Model Context Protocol.
- UI means User Interface.

## Recall

### User Request

The user asked: "更新图例，用积木图的形式形象展示专家团架构在opencorvus基建上如何工作".

### Acceptance Criteria

- Update the expert-squad legend/diagram so it looks like a building-block assembly instead of a prompt-only wiring line.
- The diagram must show how expert squads sit on the OpenCorvus infrastructure base:
  - OpenCorvus keeps one Orchestrator-led task spine, one agent family, one evidence/data base, and distinct extension axes.
  - A selected expert squad is a `PromptProfile` block.
  - The `PromptProfile` block contributes role prompt overlays and, per the 2026-07-03 capability-profile design, a scheduler capability projection.
  - `select_expert_squad` remains the visible selection/write path; no host keyword routing, hidden routing, gate, fallback, or second source.
  - Model and executor selection stay independent; MCP exposure must be explicit capability data, not an implicit side channel.
- Remove or supersede stale prompt-only legend wording in the touched diagram surfaces.
- Keep changes scoped to diagram/docs plus this record/index. Do not modify OpenCorvus runtime code in this pass.
- Visually verify the updated HTML/diagram with a rendered screenshot and inspect it for overlap/readability.

### Hard Constraints

- No fallback or compatibility wording.
- No gate/door mechanism.
- No hidden routing, hidden message fork, or keyword classifier.
- Do not create a new worktree.
- Existing dirty source changes are not part of this task and must not be reverted or staged accidentally.
- If the current code is still prompt-only, the diagram must not falsely claim that the runtime implementation is already accepted.

### Sources Read

| Source | Finding carried forward |
| --- | --- |
| `AGENTS.md` | Requires Recall before edits, no fallback/gates, no careless patching, scoped changes, and visual verification for visual artifacts. |
| `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md` | Expert-squad changes require landed design records, callpoint inventory, single source of truth, and focused validation. |
| `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md` | Required inventory covers prompt profiles, built-in expert-squad skills, Orchestrator prompt/tool surfaces, and tests. |
| `specs/README.md` | New records belong under `specs/records/YYYY-MM/**`; task artifacts stay under `specs/artifacts/**`. |
| `specs/records/2026-07/README.md` | Monthly index must link this record. |
| `specs/records/2026-07/2026-07-03-expert-squad-capability-profile.md` | Supersedes prompt-only expert-squad framing with `PromptProfile = role prompt overlays + capability projection`; implementation is still recorded as pending. |
| `specs/records/2026-07/2026-07-02-single-agent-vs-opencorvus-clear-drawio.md` | Current Draw.io artifact still contains prompt-only wording that should be corrected if touched. |
| `specs/records/2026-07/2026-07-02-agent-team-investment-drawio.md` | Previous investment diagram was deleted/superseded; this pass should not resurrect that artifact. |
| `specs/records/2026-06/2026-06-30-agent-team-html-architecture-diagram.md` | Existing HTML map was built to be click-to-expand and later gained an expert-squad wiring section, but that section was explicitly prompt-only. |
| `specs/current/architecture/17-agent-team-infrastructure.html` | Current visible legend and wiring section repeatedly say expert squads only change prompt/tools remain unaffected. |
| `specs/current/architecture/README.md` | The HTML file is the current architecture overview diagram. |
| `specs/artifacts/tv2ainvest.md` | Active task artifact is a frontend replica prompt, not the architecture diagram source for this request. |

### Repository Search Evidence

| Command | Finding |
| --- | --- |
| `rg -n "PromptProfile|builtIns|prompt_profile|frontend-replica|frontend-innovate|expert-squad|select_expert_squad|mounted Orchestrator expert-squad|skill tool" packages/opencorvus/src packages/opencorvus/test specs -l` | Expert-squad surfaces span prompt-profile source/tests, Orchestrator tools/prompt, built-in skills, skill/mount code, current architecture docs, and records. |
| `rg -n "frontend-replica-expert-squad|frontend-innovate-expert-squad|frontend-automation-debug-expert-squad|builtin-skills|required_tools|mounted_agents" packages/opencorvus/src packages/opencorvus/test -l` | Built-in selector skills and skill registry/mount tests remain relevant single-source surfaces. |
| `rg -n "requiredBuiltInTargetMatrix|built-in registry pressure|overlay target|prompt-profile" packages/opencorvus/test/agent packages/opencorvus/test/server -l` | Prompt-profile tests pin built-ins and catalog behavior; code behavior is not being changed in this pass. |
| `rg -n "map-legend|专家团|prompt overlay|prompt only|只换|TOOLS 臂|capability|能力|积木|PromptProfile|select_expert_squad" specs/current/architecture/17-agent-team-infrastructure.html specs/artifacts/opencorvus-single-agent-vs-agent-team.drawio specs/records/2026-07/2026-07-02-single-agent-vs-opencorvus-clear-drawio.md specs/records/2026-07/2026-07-03-expert-squad-capability-profile.md` | The HTML and Draw.io artifact contain stale prompt-only language; the July 3 capability-profile record is the source for the new block metaphor. |
| `rg -n "DEFAULT_PROMPT_PROFILE_ID|capability_projection|capability_profile_id|projection_hash|projected_agents|effectiveCapability|projectOrchestratorTools|dispatchableAgents" packages/opencorvus/src/agent/prompt-profile.ts packages/opencorvus/src/orchestrator/tools.ts packages/opencorvus/src/skill/mounts.ts packages/opencorvus/test/agent/prompt-profile.test.ts` | At the time of this diagram pass, source still showed `DEFAULT_PROMPT_PROFILE_ID = "frontend-replica"` and no landed capability-projection symbols. The default-profile portion was later superseded by `2026-07-03-generic-build-evidence-gate-removal.md`; capability projection remains a separate design. |

### Independent Agent Feedback

No fresh sub-agent was spawned because the current user request did not ask for independent agents or parallel delegation. This pass carries forward the independent-agent feedback already recorded in `2026-07-03-expert-squad-capability-profile.md`: capability projection must be a real `PromptProfile`-owned single source, same-turn tool-table changes are impossible, `select_expert_squad` must create visible continuation evidence, and UI/SkillMount surfaces must not invent a separate local filter.

## Root Findings

1. The existing visual language is stale for the requested concept.
   - The HTML map says "专家团只换一层领域 prompt".
   - The expert-squad wiring SVG says only the prompt arm changes.
   - The Draw.io comparison says PromptProfile overlay changes prompt only.

2. The 2026-07-03 capability-profile record changed the intended architecture model.
   - Expert squads should be presented as `PromptProfile` building blocks with role prompt overlays and scheduler capability projection.
   - `prompt_profile.active` remains the single selected-squad source.
   - Effective tools/skills/projected agents are derived from the selected profile's capability projection.

3. Runtime code is not proven complete in this turn.
   - The diagram can communicate the design and prevent stale prompt-only understanding.
   - It must not claim runtime implementation or E2E acceptance that has not been verified here.

## Implementation Plan

1. Re-read this Recall before editing diagram files.
2. Update `specs/current/architecture/17-agent-team-infrastructure.html`:
   - Replace prompt-only summary text with building-block wording.
   - Convert the expert-squad wiring section into a building-block assembly diagram.
   - Update click-through drawer text so each block explains its source and boundaries.
   - Preserve visual restraint and avoid dense box piles.
3. Update `specs/artifacts/opencorvus-single-agent-vs-agent-team.drawio` only to remove the stale prompt-only overlay label and replace it with concise building-block wording.
4. Update `specs/records/2026-07/README.md` with this record.
5. Validate:
   - Parse the Draw.io XML.
   - Run a script syntax check for the HTML drawer script.
   - Render the HTML with a real browser path, save screenshots, inspect them, and iterate if text overlaps or the block diagram reads poorly.
   - Run `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`.
   - Run `git diff --check`.

## Non-Goals

- Do not change `PromptProfile`, Orchestrator tools, skill registry, SkillMount, overlay UI, or SDK/API snapshots in this pass.
- Do not present the capability-projection runtime as accepted implementation.
- Do not create another architecture authority outside the existing current HTML and dated record.

## Implementation Log

2026-07-03:

- Updated `specs/current/architecture/17-agent-team-infrastructure.html`:
  - Replaced the main prompt-only expert-squad language with a `PromptProfile` building-block metaphor.
  - Rebuilt the second expert-squad SVG from a linear prompt-only wiring diagram into a building-block assembly diagram:
    visible selection, mounted selector skills, `PromptProfile.builtIns`, prompt overlays, scheduler capability projection, root session overlay, and the OpenCorvus infrastructure base.
  - Updated click-through drawer entries for selector skills, `select_expert_squad`, root overlay, prompt overlays, scheduler capability projection, and infrastructure boundary.
  - Kept a visible caveat in the Frontend Replica drawer text that this page is a diagram/legend update aligned to the capability-profile design, not runtime implementation acceptance.
- Updated `specs/artifacts/opencorvus-single-agent-vs-agent-team.drawio`:
  - Replaced the stale "PromptProfile Overlay only changes prompt" text with concise building-block wording.
- Updated `specs/records/2026-07/README.md` with this record.

## Verification

- Stale wording scan:
  - `rg -n "只换|只热插|只有 prompt|prompt-only|PromptProfile Overlay|不受专家团|不改 workflow|不改 tools|tool / agent / model / MCP 全部不变|TOOLS / AGENT / MODEL / MCP / WORKFLOW 全部不变|does not change tools|changes future prompt composition only" specs/current/architecture/17-agent-team-infrastructure.html specs/artifacts/opencorvus-single-agent-vs-agent-team.drawio specs/records/2026-07/2026-07-03-expert-squad-building-block-legend.md`
  - Result: no stale prompt-only wording remains in the HTML or Draw.io artifact; remaining hits are this record's historical/problem statement.
- Draw.io XML parse:
  - `[xml](Get-Content -Raw -LiteralPath 'specs/artifacts/opencorvus-single-agent-vs-agent-team.drawio')`
  - Result: passed.
- HTML drawer script syntax:
  - `node -e "const fs=require('fs'); const raw=fs.readFileSync('specs/current/architecture/17-agent-team-infrastructure.html','utf8'); const m=raw.match(/<script>([\\s\\S]*)<\\/script>/); if(!m) throw new Error('script block missing'); new Function(m[1]); console.log('drawer script syntax ok')"`
  - Result: passed.
- Playwright visual verification, started by Node:
  - Full screenshot: `.scratch/expert-squad-building-block-legend/full.png`.
  - Building-block section screenshot: `.scratch/expert-squad-building-block-legend/building-block-section.png`.
  - Capability drawer screenshot: `.scratch/expert-squad-building-block-legend/capability-drawer.png`.
  - Layout audit: `.scratch/expert-squad-building-block-legend/layout-audit.json`.
  - Result: `hasHorizontalScroll: false`, `overflowCount: 0`; manual screenshot review found the building-block diagram readable with no obvious overlap.
- Drawer interaction:
  - Clicked `[data-detail="wiring-tool-arm"]`.
  - Result: drawer opened with title `Scheduler capability projection` and the new capability-projection body text.
- Documentation tests:
  - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 19 pass, 0 fail.
  - `bun test packages/opencorvus/test/script/document-health.test.ts`: 46 pass, 0 fail.
- Whitespace check:
  - `git diff --check -- specs/current/architecture/17-agent-team-infrastructure.html specs/artifacts/opencorvus-single-agent-vs-agent-team.drawio specs/records/2026-07/2026-07-03-expert-squad-building-block-legend.md specs/records/2026-07/README.md`
  - Result: passed.

## Residual Boundary

This pass intentionally did not modify runtime code. Repository search before implementation showed the current checked `PromptProfile` source still lacked landed `capability_projection` symbols. Therefore this record accepts only the diagram/legend update, not runtime capability-profile implementation.
