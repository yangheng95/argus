# Frontend Innovate Design Philosophy

## Recall

- User request: search webpage design materials, tutorials, principles,
  courses, and popular Claude Code (CC) design plugins; form a complete
  frontend design philosophy; replace the placeholder `frontend-innovate`
  prompt and skill material; use webpage redesign as an end-to-end case, such
  as redesigning an existing Uniform Resource Locator (URL) from aesthetic,
  professional, and convenient perspectives.
- Acceptance:
  - `frontend-innovate` remains the existing expert-squad path:
    `PromptProfile.builtIns["frontend-innovate"]`,
    `frontend-innovate-expert-squad.md`, visible `skill`, and
    `select_expert_squad`.
  - No new `frontend_innovate` workflow tool, hidden profile injection,
    host-side keyword classifier, fallback reader, or parallel design-resource
    source is added.
  - The prompt/skill must translate aesthetic, professional, and convenient
    requests into observable design obligations: user task, page job,
    information architecture, visual hierarchy, design-system reuse,
    accessibility, interaction states, content, performance, screenshots, and
    end-to-end verification.
  - A webpage redesign case must exercise source URL investigation,
    design-resource manifest handoff, multiple directions, selected direction,
    Build, Visual QA (Quality Assurance), and Integrity evidence.
  - Tests must cover prompt/skill content and runtime expert-squad selection
    through the existing Orchestrator path.
- Hard constraints:
  - No fallback, no double source, no workflow gate, no synthetic messages.
  - `design_resource_manifest` remains the single semantic index for design
    resources.
  - Frontend Design remains a one-shot task-scoped handoff owner, not a repair
    loop and not a Build substitute.
  - Build consumes the selected handoff; Visual QA reviews rendered product
    evidence; Integrity reviews completion evidence.
  - Browser Preview evidence is implementation verification, not source design
    material.
  - Playwright must run through Node sidecar paths on Windows.
  - Default frontend replica scope stays desktop-only unless the current user
    explicitly authorizes mobile/tablet/multi-end work.
- Disk records read:
  - `AGENTS.md`
  - `specs/README.md`
  - `specs/records/2026-07/README.md`
  - `specs/records/2026-06/2026-06-29-frontend-innovate-expert-squad.md`
  - `specs/records/2026-07/2026-07-01-expert-squad-concrete-prompts.md`
  - `packages/opencorvus/src/agent/prompt-profile.ts`
  - `packages/opencorvus/src/skill/builtin/frontend-innovate-expert-squad.md`
  - `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
  - `packages/opencorvus/src/prompt/core/frontend-design-core.txt`
  - `packages/opencorvus/src/frontend-design/schema.ts`
  - `packages/opencorvus/src/frontend-design/output-tools.ts`
  - `packages/opencorvus/test/agent/prompt-profile.test.ts`
  - `packages/opencorvus/test/tool/skill.test.ts`
  - `packages/opencorvus/test/orchestrator/tools.test.ts`
- Whole-repository grep performed:
  - `rg -n "frontend[-_ ]?innovate|frontendInnovate|innovate" .`
  - `rg -n "frontend_research|frontend_design|visual_qa|integrity|preview evidence|Playwright sidecar|design system|frontend" specs packages AGENTS.md`
  - `rg -n "Anti-Slop Review|anti-slop|product-grade|enterprise polish|quality bar|beautiful|professional|convenient|美观|专业|便捷|design philosophy|frontend design" packages/opencorvus/src packages/opencorvus/test specs/records/2026-07 -S`
  - `rg -n "design_directions|selected_design_direction_id|anti_slop_review|rejected-traits|direction" packages/opencorvus/src packages/opencorvus/test -S`
- External design sources reviewed:
  - W3C WCAG (Web Content Accessibility Guidelines) 2.2:
    `https://www.w3.org/TR/WCAG22/`
  - WAI-ARIA (Web Accessibility Initiative - Accessible Rich Internet
    Applications) Authoring Practices:
    `https://www.w3.org/WAI/ARIA/apg/`
  - Nielsen Norman Group usability heuristics:
    `https://www.nngroup.com/articles/ten-usability-heuristics/`
  - Nielsen Norman Group visual hierarchy and Gestalt proximity articles:
    `https://www.nngroup.com/articles/visual-hierarchy-ux-definition/`,
    `https://www.nngroup.com/articles/gestalt-proximity/`
  - Material Design 3 foundations: `https://m3.material.io/foundations`
  - Apple Human Interface Guidelines:
    `https://developer.apple.com/design/human-interface-guidelines`
  - IBM Carbon Design System: `https://carbondesignsystem.com/`
  - Microsoft Fluent 2: `https://fluent2.microsoft.design/`
  - GOV.UK Design System and service manual user-needs guidance:
    `https://design-system.service.gov.uk/`,
    `https://www.gov.uk/service-manual/user-research/start-by-learning-user-needs`
  - web.dev Learn Accessibility and Web Vitals:
    `https://web.dev/learn/accessibility`,
    `https://web.dev/articles/vitals`
  - Figma design systems material:
    `https://help.figma.com/hc/en-us/sections/14548397990423-Introduction-to-design-systems`,
    `https://www.figma.com/blog/design-systems-102-how-to-build-your-design-system/`
  - Baymard Institute research methodology and guidelines:
    `https://baymard.com/research/methodology`,
    `https://baymard.com/product/ux-best-practice-guidelines`
  - Claude Code official `frontend-design` plugin skill:
    `https://raw.githubusercontent.com/anthropics/claude-code/main/plugins/frontend-design/skills/frontend-design/SKILL.md`
  - Popular Claude Code design-skill landscape surveys and directories:
    `https://snyk.io/articles/top-claude-skills-ui-ux-engineers/`,
    `https://github.com/wilwaldon/Claude-Code-Frontend-Design-Toolkit`,
    `https://composio.dev/content/top-design-skills`,
    `https://www.claudedirectory.org/plugins/frontend-design`
- Independent agent feedback:
  - Codebase explorer: `frontend-innovate` is profile plus mounted skill plus
    `select_expert_squad`; do not add a new agent/tool/workflow. Update prompt,
    skill, and tests. Existing `tool.skill` test still expected stale
    `Anti-Slop Review` text.
  - Visual pipeline explorer: do not bypass `design_resource_manifest`,
    `frontend_design` one-shot handoff, Visual QA registered evidence, Browser
    Preview target/evidence artifacts, Node sidecar Playwright, or
    `VisualEvidenceBundle`.
  - Design research agent: translate "beautiful/professional/convenient" into
    user task, information architecture, hierarchy, consistency,
    accessibility, performance, copy, states, and screenshot-backed evidence.

## Design Philosophy

Frontend Innovate should not be a prompt that asks agents to make a page
"beautiful" or "professional". It should force agents to decompose those words
into evidence-backed design obligations:

1. **Task before appearance.** Name the user, the page job, the primary path,
   secondary paths, failure states, and the information priority before visual
   choices.
2. **Subject-grounded identity.** Distinctive visual choices must come from the
   product domain, audience, content, and resources, not from default Artificial
   Intelligence (AI) design palettes or decoration.
3. **System before novelty.** Reuse the target project's design tokens,
   components, icon set, type scale, spacing scale, and mature libraries before
   adding new visual language.
4. **Hierarchy as usability.** Layout, spacing, contrast, typography, grouping,
   labels, and controls must make the main task easier to see and complete.
5. **Accessibility from the first sketch.** Keyboard reachability, focus,
   semantic roles, color contrast, target size, error recovery, reduced motion,
   and assistive-technology behavior are design inputs.
6. **Convenience as path quality.** A convenient page reduces decision effort,
   preserves user control, exposes system status, supports recognition over
   recall, and handles loading, empty, error, permission, and success states.
7. **Professional as consistency and trust.** Professional delivery means
   coherent component families, durable data/state behavior, precise copy,
   measured performance, and no fake controls or static screenshots presented
   as interaction.
8. **Evidence before acceptance.** Completion requires rendered screenshots,
   interaction proof, accessibility checks, and build/test evidence tied to the
   same selected design direction.

The Claude Code frontend-design plugin and community design-skill landscape are
useful calibration sources, not dependencies. They converge on three useful
lanes: creative direction that avoids generic Artificial Intelligence (AI)
visual habits, searchable design intelligence for patterns and style systems,
and accessibility/compliance review. OpenCorvus must adapt those ideas to its
stricter architecture: design distinctiveness is allowed only after task,
system, accessibility, and verification evidence are explicit.

## Implementation Plan

1. Add this record and index it in `specs/records/2026-07/README.md`.
2. Extend `PromptProfile.builtIns["frontend-innovate"]` overlays so every role
   receives the design philosophy in role-specific, executable terms.
3. Extend `frontend-innovate-expert-squad.md` with:
   - design philosophy contract;
   - external-source calibration;
   - existing URL webpage redesign flow;
   - end-to-end evidence standard for aesthetic, professional, and convenient
     redesign requests.
4. Update stale tests that expected the old visible `Anti-Slop Review` phrase.
   Keep the existing structured `anti_slop_review` field/tool names unchanged
   in this task to avoid a schema-wide rename that is outside the prompt/skill
   request.
5. Add tests that assert the profile and skill now contain the new philosophy
   axes and the existing URL redesign end-to-end flow.
6. Strengthen the existing Frontend Innovate runtime fixture so the case is an
   existing URL redesign with source investigation, HTML material, selected
   direction, screenshot evidence, accessibility/user-task proof, Visual QA,
   and Integrity.

## Benchmark

- Input: an existing URL and HTML material for a complex product page redesign.
- Output: one Frontend Innovate expert-squad flow that loads the skill,
  selects the profile, investigates the source URL, creates a
  manifest-backed Frontend Design handoff with at least two directions,
  implements the selected direction through Build, and reviews the rendered
  product through Visual QA and Integrity.
- Timeout: use normal targeted test execution; when long-running browser
  automation is involved, it must use inactivity timeout semantics rather than
  process-start elapsed time.
- Passing criteria:
  - prompt/profile tests pass;
  - skill search/load test passes;
  - Frontend Design contract tests pass;
  - targeted Orchestrator Frontend Innovate flow passes;
  - specs link health passes for the new record;
  - manual review confirms no new fallback, hidden profile route, workflow
    branch, or parallel design-resource source.
