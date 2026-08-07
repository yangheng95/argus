# Built-in Taste Skill Prism Pilot

Status: Implemented
Date: 2026-08-03
Owner: Codex

## Recall

### User request

- Make <https://github.com/Leonxlnx/taste-skill> an OpenCorvus built-in frontend Skill.
- The initial request for automatic integration into frontend-derived Agents was explicitly narrowed: add the Skill to the built-in inventory without automatic runtime-template integration, and pilot it in Mirror Prism.

### Acceptance criteria

- `design-taste-frontend` is a reviewable source directory under `packages/opencorvus/src/skill/builtin/**` and is embedded by the canonical generated built-in Skill payload.
- The built-in Skill is self-contained at runtime and ships its license and provenance; it never downloads GitHub content at runtime.
- The adaptation retains the upstream design-read, contextual design dials, anti-template discipline, mature design-system preference, visual hierarchy, motion/accessibility, redesign-audit, and rendered pre-flight review principles.
- OpenCorvus repository constraints supersede incompatible upstream defaults. The built-in adaptation does not require mobile delivery, dark mode, React, Next.js, Tailwind, placeholder assets, fallback behavior, simulated randomization, or a marketing-page-only scope.
- Only Prism Agent `mirror-design-page-designer` receives `default/skill/design-taste-frontend` through its manifest `default_skill_refs`.
- No runtime-template, resolver, Chat/Work default, other Expert Squad, or other Prism Agent gains an automatic grant.
- Prism package revision, generated Expert Squad payload, generated built-in Skill payload, current architecture, and positive non-User Interface contract tests agree.

### Hard constraints

- Preserve `PromptProfileResolver` as the only effective projection owner and `prompt_profile.active` as the only active Expert Squad source.
- Do not add implicit `base_role`-to-Skill inference, a second Skill inventory, fallback, compatibility alias, Host gate, keyword router, hidden message, or state machine.
- Keep Prism original AInvest `greenfield_original` authority and desktop-only delivery scope. Taste guidance cannot override AInvest product/design authority, Product Requirements, or accepted Prism evidence.
- Do not add, modify, update, or run User Interface automation tests. This task changes package/Skill projection rather than a rendered product page, so acceptance uses positive non-UI inventory, Registry, Resolver, and payload contracts.
- Preserve the proposed Prism complete-subsystem closure record and all unrelated work.
- Commit subjects use `dsw-33987` and delivery pushes to `myhexin/v0.0.29beta` without bypassing hooks.

### Sources read

- Root `AGENTS.md`.
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md` and its complete checklist.
- `specs/README.md`, `specs/current/architecture/04-extensions.md`, and `specs/records/2026-08/README.md`.
- `2026-08-03-prism-complete-subsystem-closure.md`, `2026-08-03-prism-universal-ainvest-convergence.md`, and `2026-08-03-prism-original-product-design-authority.md`.
- Current Prism manifest and its package/resolver contract tests.
- Built-in Skill source, generator, generated payload, inventory tests, and projection resolver.
- Upstream Taste Skill repository read-me documentation, default v2 `skills/taste-skill/SKILL.md`, `gpt-tasteskill`, and Massachusetts Institute of Technology (MIT) License as publicly available on 2026-08-03.

### Repository search results

Executed:

```text
rg -n --hidden --glob '!node_modules' --glob '!dist' "taste|frontend.*skill|derived agent|derive.*agent|spawn.*agent|skill.*projection|built-in skill|builtin skill" .
rg -n "frontend-design|frontend-research" packages/opencorvus/src --glob '*.ts' --glob '*.md'
rg -n "default_skill_refs|default skill|derived.*skill|base_role.*skill|skill.*base_role" specs/current specs/records
rg -n "frontend-design|default_skill_refs" expert-squads/mirror/prism packages/opencorvus/test/expert-squad
```

Findings:

- Built-in Skill authoring source is `packages/opencorvus/src/skill/builtin/**`; the generated payload is the only embedded runtime copy.
- Ordinary built-in inventory does not grant execution. Prism must explicitly name a default Skill ref in the exact Agent projection.
- Prism has one `frontend-design` Agent, `mirror-design-page-designer`; its current `default_skill_refs` is empty.
- `PromptProfileResolver` already projects manifest-declared default Skill refs into the worker, Skill mount matrix, system prompt, Skill tool, and active catalog. No resolver change is required.
- Upstream default v2 is contextual but declares landing/portfolio/redesign scope and excludes dashboards/data tables/multi-step product UI. Its mobile, placeholder fallback, fixed framework, and universal dark-mode defaults conflict with Prism and repository constraints. A verbatim copy would be either inert or harmful in the Prism pilot.

### Independent Agent feedback

No sub-Agent was started. The user did not request parallel or independent Agents, and current collaboration policy prohibits unsolicited delegation. Final acceptance includes a separate local diff review after tests.

## Design

Create one MIT-licensed OpenCorvus adaptation named `design-taste-frontend`. Its source owns general visual judgment only. Prism package prompts and evidence remain the domain authority, so the Skill reads the active brief, accepted Product Requirements, selected design system, and task scope before applying any guidance.

The Skill uses four phases:

1. infer the page/product job, audience, evidence, constraints, and design language;
2. set contextual variance, motion, and density values without treating defaults as configuration authority;
3. implement a coherent system with mature primitives, deliberate hierarchy, non-repeating composition, real assets, accessible interaction, and restrained motion;
4. open the real desktop result, inspect task-scoped screenshots, fix visible defects, and repeat until the accepted design contract is met.

The Prism manifest explicitly grants the Skill only to `mirror-design-page-designer`. The package revision becomes `2026.08.03.5`; revision `2026.08.03.4` already belongs to the concurrent complete-subsystem closure release. No other projection changes.

## Verification plan

- `bun packages/opencorvus/script/generate-builtin-skill-payload.ts`
- `bun packages/opencorvus/script/generate-expert-squad-payload.ts`
- `bun test packages/opencorvus/test/skill/builtin-taste-skill.test.ts`
- `bun test packages/opencorvus/test/skill/builtin-payload-generation.test.ts`
- `bun test packages/opencorvus/test/expert-squad/mirror-prism-package.test.ts`
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts`
- `bun test packages/sdk/js/test/mirror-prism-authoring.test.ts packages/sdk/js/test/mirror-prism-collaboration.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`

## Results

- Added the self-contained `design-taste-frontend` built-in Skill source, Massachusetts Institute of Technology license, provenance, generated payload, and positive inventory/materialization contracts.
- Advanced Prism to `2026.08.03.5` and granted `default/skill/design-taste-frontend` only through `mirror-design-page-designer.default_skill_refs`; resolver and runtime templates remain unchanged.
- Regenerated both canonical payload modules.
- Built-in Skill tests passed: 5 tests, 16 expectations, 0 failures.
- Prism package tests passed: 8 tests, 356 expectations, 0 failures, including exact Registry and Resolver projection for every Prism Agent.
- Expert Squad payload tests passed: 8 tests, 88 expectations, 0 failures.
- Software Development Kit authoring and collaboration tests passed: 4 tests, 147 expectations, 0 failures.
- Historical-document links passed: 2 tests, 2 expectations, 0 failures; document health passed: 60 tests, 1,142 expectations, 0 failures.
- OpenCorvus package and repository-wide typechecks passed; `git diff --check` passed.
- No User Interface automation test was added, changed, updated, or run; this change has no rendered User Interface delivery surface.
