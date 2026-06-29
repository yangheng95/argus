# 2026-06-29 Frontend Innovate Expert Squad

Status: implemented and validated

## Goal

Add a Frontend Innovate expert squad for product-grade and enterprise-grade
webpage design work.

The squad must help the Orchestrator choose an existing homogeneous workflow in
which:

- design screenshots, HTML, Figma material, and related design artifacts are
  gathered as explicit design resources;
- frontend-design reads those resources and produces competing design
  directions before selecting a final handoff;
- the handoff records adversarial review against shallow generic output,
  product readiness, design-system fit, interaction semantics, and visual
  evidence;
- Architect and Build consume the handoff to implement the webpage through
  normal goals and build sessions;
- Visual QA and Integrity review the implemented page from real rendered
  evidence before completion.

This capability must not add a new `frontend_innovate` workflow tool, agent
kind, hidden routing branch, or fallback input path. It must reuse the current
expert-squad mechanism: mounted Orchestrator skill plus
`select_expert_squad`, then existing `frontend_research`, `frontend_design`,
`requirements`, `architect`, `build`, `visual_qa`, and `integrity` tools.

## Recall

### User Request

The user asked for a Frontend Innovate expert group that can read design
screenshots, HTML design feeling, Figma designs, and similar resources; use
multiple build-style brainstorming passes to produce design drafts; prevent
sloppy shallow outputs through adversarial review; converge on an
enterprise/product-grade webpage design; then delegate child tasks to implement
the webpage. The user also required a complex long-running goal, deep
investigation of current code and impact, a detailed complete goal, and
independent agent investigation-implementation-review adversarial cooperation.

The active objective was later edited to explicitly add "防止slops" to the
brainstorm/review requirement. This record treats shallow generic design output
as a first-class rejection target.

### Acceptance Criteria

- A dated plan with this Recall exists under `specs/records/2026-06/`.
- Frontend Innovate is exposed through one expert-squad source:
  `PromptProfile.builtIns["frontend-innovate"]` plus
  `frontend-innovate-expert-squad.md`, selected by visible Orchestrator
  `skill` and `select_expert_squad`.
- No `frontend_innovate` agent, tool, workflow branch, route bypass, hidden
  prompt injection, keyword classifier, compatibility alias, fallback profile,
  or synthetic message path is introduced.
- Design resources are not treated as an informal union of attachments,
  system artifacts, Figma materialization, and browser evidence. The
  implementation must define a single design-resource manifest contract before
  agents consume those resources as Frontend Innovate context.
- Unknown design material types must fail explicitly instead of continuing as
  generic octet-stream input.
- HTML is documented and tested as a first-class design material where the
  existing materializer already recognizes it.
- Frontend Design remains the handoff owner; Build consumes the design handoff
  and does not acquire a second webpage/design evidence path.
- The Frontend Innovate profile must pressure Frontend Research, Frontend
  Design, Requirements, Architect, Build, Visual QA, Integrity, and direct
  sessions toward product-grade design alternatives, convergence rationale,
  implementation ownership, rendered evidence, and anti-slop review.
- Tests must cover the visible skill selection path, built-in profile/catalog
  exposure, built-in skill registration/search/load, design-resource manifest
  creation/read failure modes, and prompt/profile pressure.
- At least one runtime-level test must execute the Orchestrator skill plus
  `select_expert_squad` path rather than only asserting prompt text.
- Specs indexes remain healthy after this record is added.

### Hard Constraints

- No fallback or compatibility logic.
- No double source for expert squad, resource, tool, role, or message truth.
- No host-side keyword classifier or workflow branch that teaches the model
  which route to take.
- No hidden or synthetic messages; visible tool calls and durable artifacts are
  the observable path.
- No new sub-agent infrastructure path. Role differences must stay
  declarative.
- Do not make Build re-own source design evidence collection.
- Do not use temp screenshots, localhost URLs, stale screenshots, DOM text, or
  self-reported design prose as final visual evidence.
- Do not modify unrelated dirty worktree files or revert user changes.
- Do not create a new git worktree for this task.

### Read From Disk Before Edits

| Source | Relevant constraint |
| --- | --- |
| `AGENTS.md` | No fallback, no multi-source design, no host-side gates, specs under root `specs/`, Recall required before implementation, tests required for code changes. |
| `specs/current/architecture/01-agents.md` | Orchestrator is the only task lifecycle decision maker. Frontend Design owns visual/source handoff, Build implements, Visual QA/Integrity review. |
| `specs/current/architecture/08-agent-tool-adapter.md` | Tool visibility is single-source through `AgentToolPool`; prompts cannot create a second tool surface. |
| `specs/current/architecture/09-verification-evidence.md` | Browser preview evidence and verification evidence are durable artifact surfaces, not UI-only claims. |
| `specs/current/architecture/11-agent-oop-protocol.md` | New agent roles must extend current data contracts; do not invent a class/mailbox runtime. |
| `specs/current/architecture/13-agent-communication-matrix.md` | A2A coordination and observable messages are durable artifacts/events, not direct hidden peer messages. |
| `specs/current/architecture/14-agent-runtime-mode.md` | Runtime modes are prompt/session/tool/context contracts, not separate class families. |
| `specs/records/2026-06/2026-06-21-frontend-design-research-adversarial-repair.md` | Frontend Design must avoid unproven static skeletons and must record implementation-ready handoff evidence. |
| `specs/records/2026-06/2026-06-23-incremental-frontend-result-tools.md` | Frontend Design output uses incremental collector tools and a small finalizer; do not reintroduce a giant payload. |
| `specs/records/2026-06/2026-06-24-orchestrator-expert-squad-skill.md` | Expert squads are prompt profiles selected by visible Orchestrator skills, not workflow branches. |
| `specs/records/2026-06/2026-06-29-frontend-design-visual-evidence-capture-mode.md` | Visual evidence must carry structured capture mode and submit-grade diagnostics. |
| `specs/records/2026-06/2026-06-29-frontend-replica-tool-ownership-prompt.md` | Browser preview proof ownership stays with Build and Visual QA, not Orchestrator skill text. |
| `packages/opencorvus/src/agent/prompt-profile.ts` | Built-in expert squads are registered here and composed into role prompts. |
| `packages/opencorvus/src/skill/builtin/frontend-replica-expert-squad.md` | Existing expert-squad skill frontmatter and dispatch discipline pattern. |
| `packages/opencorvus/src/skill/builtin/frontend-automation-debug-expert-squad.md` | Existing automation/debug expert-squad skill pattern. |
| `packages/opencorvus/src/frontend-design/schema.ts` | Existing frontend template schema already has component reuse, material inventory, visual contract, iteration notes, and implementation phases. |
| `packages/opencorvus/src/frontend-design/output-tools.ts` | Existing collector/finalizer is the canonical frontend-design output surface. |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt` | Orchestrator prompt already owns expert squad scheduling through visible skill selection. |

### Whole-Repository Search Evidence

Commands run before this record:

```bash
rg --files specs | rg "(frontend|design|agent|tool|orchestrator|visual|build|operator|side-by-side|verification|architecture|README)"
rg -n "frontend[-_]design|frontend[-_]research|frontend[-_]replica|expert[-_ ]squad|PromptProfile|select_expert_squad|frontend_innovate|innovate|innovation|figma|screenshot|html|visual|browser_preview" packages/opencorvus/src packages/opencorvus/test packages/overlay/test specs/current specs/records/2026-06 --glob "!**/target*"
rg -n "Agent\.get\(|run.*Session|create.*Tools|submit_frontend_template|update_frontend_|inspect_frontend_result_status|frontend_design|frontend-design" packages/opencorvus/src/frontend-design packages/opencorvus/src/orchestrator packages/opencorvus/src/agent packages/opencorvus/test/frontend-design packages/opencorvus/test/orchestrator packages/opencorvus/test/agent
rg -n -e "frontend-replica-expert-squad" -e "frontend-automation-debug-expert-squad" -e "frontend-automation-debug" -e "Object.keys\(PromptProfile\.builtIns\)" -e "profiles.map\(\(profile\) => profile.id\)" packages/opencorvus/test packages/opencorvus/src packages/overlay/test packages/web/src -S
rg -n "FrontendTemplateFinalSchema|iteration_notes|implementation_phase|visual_consistency_contract|material_inventory|completeness_review|open_questions|component_reuse_plan|baseline_replacement_plan" packages/opencorvus/src/frontend-design/schema.ts packages/opencorvus/src/frontend-design/output-tools.ts packages/opencorvus/test/frontend-design -C 2
```

Findings:

- No existing `frontend-innovate` profile, skill, tool, or agent exists.
- Existing expert squads are `frontend-replica` and
  `frontend-automation-debug`.
- Existing expert-squad selection already has tests in prompt profile,
  Orchestrator tool, SkillTool, SessionLoop extra tools, server config, and
  overlay profile UI surfaces.
- Existing Frontend Design schema can express competing design directions
  through material inventory, component reuse plan, baseline replacement plan,
  visual consistency contract, implementation phase outcomes, open questions,
  and at least two iteration notes.
- Existing local material handling recognizes HTML in code but the public
  frontend_design material schema text does not explicitly list HTML.
- Existing resource semantics are split across attachments, system artifacts,
  Figma materialization, webpage evidence, decision log, and browser preview
  artifacts; Frontend Innovate needs a manifest single source to avoid
  reintroducing multi-source input semantics.

### Independent Agent Feedback

Three read-only agents were spawned and then closed. They did not edit files,
commit, or delegate further.

| Agent | Feedback |
| --- | --- |
| Infrastructure explorer | Implement Frontend Innovate as `PromptProfile` + mounted Orchestrator skill + `select_expert_squad`. Do not add a new agent/tool/session/workflow path unless a new independent terminal contract is truly required. Reuse Frontend Design handoff, Build, decision log, and conversation projection. |
| Resource explorer | Create a single `design_resource_manifest` engine artifact to index screenshots, HTML, Figma material, and related resource relationships. Bytes can remain in AttachmentStore/artifact roots, but semantic resource lookup must not be a scattered union. Unknown material types must fail explicitly; Figma must stay MCP-materialized without REST/screenshot fallback. |
| Verification explorer | Prompt/profile tests are necessary but insufficient. Add runtime tests that execute visible skill loading plus `select_expert_squad`, and later cover Orchestrator/frontend-design/multi-build/Visual QA/Integrity observable message flow. Avoid synthetic messages, hidden profile selection, fake evidence, and build self-reported acceptance. |

## Design

### Expert Squad Shape

Frontend Innovate is a prompt-profile expert squad:

- built-in profile id: `frontend-innovate`;
- built-in skill name: `frontend-innovate-expert-squad`;
- mounted only to `orchestrator`;
- required tool: `select_expert_squad`;
- selected only through visible `skill` result and
  `select_expert_squad({ profile_id: "frontend-innovate" })`.

It is not a new workflow tool. It changes future prompt composition for
existing roles so the homogeneous workflow behaves differently without adding a
second scheduler.

### Role Pressure

The profile overlays should pressure roles as follows:

- Orchestrator: select the squad for product/enterprise webpage design,
  screenshot/HTML/Figma design synthesis, multi-direction ideation, and
  anti-slop design review tasks; dispatch existing evidence/design/build/review
  tools.
- Frontend Research: extract product intent, information architecture,
  interaction states, market/design references, and evidence gaps from source
  pages and design artifacts.
- Frontend Design: inspect design resources, produce multiple named design
  directions, adversarially reject shallow/sloppy drafts, and record final
  convergence in existing frontend template fields.
- Requirements: turn the selected product design into observable product,
  UX (User Experience), accessibility, and evidence requirements.
- Architect: decompose the selected design into implementable component/data
  goals without losing design-system ownership.
- Build: implement from the selected design handoff, not from a new invented
  layout, and verify rendered behavior. When the operator explicitly asks for
  multiple Build brainstorming drafts, each Build child task is a bounded
  prototype for one named direction and remains evidence for selection, not a
  second source of final truth.
- Visual QA: review real rendered product quality, interaction semantics,
  brand/product polish, and evidence-backed visual defects.
- Integrity: reject delivery when design convergence, implementation evidence,
  or anti-slop review is missing.

### Design Resource Manifest

Add a task-scoped design-resource manifest artifact before Frontend Innovate
agents consume design inputs. The manifest is an index, not byte storage.

Entry fields:

- `id`
- `kind`: `image`, `html`, `css`, `json`, `markdown`, `figma_context`,
  `figma_screenshot`, `figma_metadata`, `figma_variables`, `webpage_capture`,
  `browser_preview_evidence`
- `intent`: `visual_reference`, `design_source`, `interaction_reference`,
  `design_tokens`, `implementation_reference`, `verification_evidence`
- `origin`: `attachment`, `material`, `figma_mcp`, `webpage_evidence`,
  `browser_preview`
- `mime`
- `sha256`
- `canonical_ref`
- `materializer`
- `related_entries`
- `artifact_paths`
- `viewport`
- `region`
- `created_at`

This manifest can be introduced first for local materials/Figma/URL materialized
by the `frontend_design` Orchestrator tool. Later code can tighten other design
surfaces to read the same manifest only. No fallback reader should be added.

### Anti-Slop Contract

Frontend Innovate design output must reject shallow design drafts before handoff.
The profile/skill should require:

- at least two competing named design directions;
- explicit tradeoff comparison against enterprise/product design criteria;
- a selected direction with convergence rationale;
- material inventory tied to actual resources;
- component/library reuse decisions tied to installed packages or existing
  project components;
- interaction states and density/spacing/typography constraints;
- adversarial review notes naming what was rejected as shallow, generic, or
  unfit for the product;
- real rendered verification after implementation.

These requirements must be expressed through the existing frontend template
collector fields, not a second design-draft payload. The collector therefore
owns three structured fields:

- `design_directions`, written by `update_frontend_design_direction`;
- `selected_design_direction_id`, written by
  `select_frontend_design_direction`;
- `anti_slop_review`, written by `update_frontend_anti_slop_review`.

The finalizer must reject a submitted template that registers directions but
does not select one, or selects an id that was never registered.

## Implementation Checklist

1. Added this spec record and updated `specs/records/2026-06/README.md`.
2. Added `frontend-innovate` built-in prompt profile.
3. Added `frontend-innovate-expert-squad.md` and registered it in `Skill`.
4. Updated Orchestrator core prompt to name the new expert-squad selection
   criteria while preserving visible skill selection.
5. Added focused tests for profile registry, built-in skill registration,
   SkillTool search/load, SessionLoop mounted skill visibility, server profile
   catalog, and Orchestrator profile selection.
6. Added the first design-resource manifest schema/helper and tests for supported
   local material classification, HTML support, and unknown-type rejection.
7. Wired manifest creation into the existing `frontend_design` tool input
   materialization path without adding a second agent input route.
8. Extended the existing frontend template output contract with structured
   design directions, selected direction, and anti-slop review tools/report
   sections.
9. Ran targeted tests and typecheck.
10. Performed a second review for multi-source/fallback/synthetic-message drift.
11. Commit and push only owned changes if hooks pass and unrelated dirty files
    do not block the push.

## Implementation Summary

- `frontend-innovate` is now a built-in prompt profile, selected only through
  the visible Orchestrator `skill` and `select_expert_squad` tools.
- `frontend-innovate-expert-squad.md` is mounted as an Orchestrator skill with
  no new workflow tool, agent kind, route, hidden message path, or profile
  alias.
- `design_resource_manifest` is now an engine artifact kind and the semantic
  source of design resources for `frontend_design` materialized local HTML,
  Figma MCP resources, URL captures, and browser preview evidence.
- Unknown local material extensions and explicit materialization failures now
  abort before Frontend Design analysis instead of continuing with a loose
  generic MIME value.
- Frontend Design now has incremental tools for competing design directions,
  selected direction, and anti-slop review; ordinary Frontend Design remains
  valid without this contract, while Frontend Innovate mode requires it.
- The runtime fixture executes visible expert-squad skill selection,
  `select_expert_squad`, Frontend Research, manifest-backed Frontend Design,
  three Build sessions for bounded drafts/final implementation, Visual QA, and
  Integrity.

## Validation Plan

Commands run:

```bash
bun install
bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "frontend innovate expert squad"
bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "frontend_design materializes Figma references|select_expert_squad"
bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "frontend_design rejects any explicit materialization failure|frontend_design rejects material paths that only share the project root prefix|frontend innovate expert squad"
bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "frontend_design rejects URL screenshot capture failure|frontend_design rejects any explicit materialization failure|frontend_design rejects material paths that only share the project root prefix"
bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "frontend_design materializes Figma references|select_expert_squad|frontend innovate expert squad"
bun test packages/opencorvus/test/frontend-design/schema.test.ts packages/opencorvus/test/frontend-design/output-incremental-tools.test.ts packages/opencorvus/test/frontend-design/prompt.test.ts packages/opencorvus/test/frontend-design/design-resource-manifest.test.ts
bun test packages/opencorvus/test/agent/prompt-profile.test.ts packages/opencorvus/test/tool/skill.test.ts packages/opencorvus/test/skill/skill.test.ts
bun test packages/opencorvus/test/agent/agent.test.ts
bun test packages/opencorvus/test/session/extra-tools.test.ts packages/opencorvus/test/server/config-routes.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts packages/opencorvus/test/frontend-design/agent-process.test.ts
bun test packages/overlay/test/prompt-profile-config.test.ts
cd packages/overlay; node test/browser-runner.mjs test/browser/prompt-profile-panel.test.ts
cd packages/overlay; node test/browser-runner.mjs test/browser/prompt-profile-selector-browser.test.ts
bun run --cwd packages/opencorvus typecheck
git diff --check
```

The combined command
`bun test packages/opencorvus/test/agent/prompt-profile.test.ts packages/opencorvus/test/tool/skill.test.ts packages/opencorvus/test/skill/skill.test.ts packages/opencorvus/test/agent/agent.test.ts packages/opencorvus/test/session/extra-tools.test.ts packages/opencorvus/test/server/config-routes.test.ts`
hit Bun's default 5s per-test window in a few config/skill initialization
tests. The same files or timed-out tests passed when run in smaller batches.
This is a test-runner batching limit, not a Frontend Innovate assertion
failure; it should be addressed by the broader inactive-timeout test harness
work, not by adding product logic.

Remaining honest gap: the new long-chain fixture covers visible skill
selection, Frontend Research, Frontend Design, multiple Build sessions, Visual
QA, and Integrity in one runtime path. A2A response transport and final task
terminal completion are covered by existing focused tests, not by this single
Frontend Innovate fixture.
