# Base Default Expert Squad

Date: 2026-08-01

Status: Revised, implemented, and accepted after operator review.

## Recall

| Item | Details |
| --- | --- |
| User requirement | Add a built-in Expert Squad named `base`, make it the default Expert Squad, include the necessary Agent identities, and state clearly that it is the convenient version of `advanced`. Replace the requirements-architecture-development planning chain with a Planner Agent and do not base development on Goal or Delivery Slice planning. The user initially confirmed that every package identity may derive from the platform `build` runtime template. Independent Goal-control-plane review later proved that Build's implementation user prompt contradicts the read-only Researcher, Planner, and Tester ownership, so that runtime choice is superseded while the four-role product contract remains unchanged. |
| Acceptance criteria | `Config.Info.parse({})` materializes `prompt_profile.active = "base"`; a fresh project resolves the embedded `base` package without payload provisioning; Base projects the exact Researcher, Planner, Developer, and Tester identities through Explore, Delegated Worker, Build, and Delegated Worker runtimes respectively; the sole binding workflow is Researcher then Planner then Developer then Tester; the canonical handoffs are `base/research-report`, `base/implementation-plan`, `base/development-report`, and `base/test-report`; neither the Base manifest nor its package prompts require RequirementSet, ContractGraph, Goal, Delivery Slice, Requirements, Architect, or workload-analysis facts; `advanced` remains independently selectable as the full team; uninstall reference replacement uses `base`; the catalog and Overlay describe Base as Advanced's convenient composite version. |
| Hard constraints | Preserve all concurrent worktree changes. Do not add an alias, fallback, selector-only filter, second active-profile field, Host workflow gate, state machine, hidden message, Goal projection, or compatibility path. `prompt_profile.active` remains the sole active identity and `PromptProfileResolver` remains the sole runtime projection owner. The package is embedded because the default must resolve before project payload provisioning. UI automation tests must not be added, changed, or run; the visible catalog/default result must be checked in the real Overlay and inspected by screenshot. Non-UI changes require positive contract tests. Commit subjects use `dsw-33987` and push to `legacy-remote`. |
| Existing worktree | Branch `v0.0.27beta` at `36182b6e1f9cf58a757580383fa372823727c63f`, initially one commit ahead of `legacy-remote/v0.0.27beta`, with extensive concurrent Delivery Slice, Expert Squad installation, SDK, OpenAPI, documentation, and Overlay edits. The pre-change push ran typecheck successfully but was blocked by concurrent tracked OpenAPI drift after Goal event removal. No concurrent file is stashed, reset, restored, deleted, broadly formatted, or broadly staged. |
| Sources read | Root `AGENTS.md`; `specs/current/architecture/01-agents.md` and `04-extensions.md`; embedded Advanced manifest, README, selector, scheduler and registry entry; `agent/prompt-profile.ts`; Config prompt-profile schemas; Resolver catalog default projection; Expert Squad uninstall route and Overlay service; SDK authoring topology validation and writer; payload generator; Build runtime template, tool pool and dispatch input; Advanced, Registry, prompt-profile, config-route, global-config-route, portable-template, and lifecycle tests. |
| Whole-repository grep | Exact searches covered `DEFAULT_PROMPT_PROFILE_ID`, `ADVANCED_EXPERT_SQUAD_ID`, every source `prompt_profile.active` default, `builtInPackageSources`, catalog `default`, uninstall `replacementID`, explicit `advanced` Tasks, all tests asserting Advanced/default behavior, `base_role: "build"`, workflow topology, payload generation, README/selector documentation, and generated OpenAPI/SDK literals. Explicit Advanced selections remain Advanced; only default/fallback-replacement semantics change to Base. |
| Independent Agent feedback | No independent Agent was requested. Current collaboration policy prohibits inferred sub-agent spawning; the primary Agent performs the implementation and second semantic review. Operator review rejected the original two-Agent closure because it conflated investigation with planning and omitted a testing identity, then corrected “review-oriented” to “composite.” |

## Decision

`base` is a second embedded package and the single default prompt profile. It is
not a renamed Advanced, an alias for Advanced, or a subset projected from Advanced.
It owns a complete self-contained package tree and exact projection:

```text
base-researcher (explore) -> base-planner (delegated-worker) -> base-developer (build) -> base-tester (delegated-worker)
```

The Researcher performs read-oriented repository and relevant external research
and publishes one canonical `base/research-report` Artifact. The Planner reads
and selects that report and publishes one canonical `base/implementation-plan`
Artifact without editing product files. The Developer reads and selects the plan,
implements the bounded change, and publishes `base/development-report`. The
Tester independently reads the complete handoff, executes proportionate checks
and real-page visual review when applicable, and publishes `base/test-report`.
The Orchestrator judges the final diff and evidence and owns Task completion.

The Base workflow does not produce or consume Goal-derived planning facts. Only
the Developer uses Build implementation semantics. Research uses Explore, while
planning and independent testing use Delegated Worker so their read-only ownership
is not overridden by Build's implementation request.

Advanced remains the full package for requirements engineering, architecture,
evidence investigation, complex interface delivery, and independent specialist
review. Base's selector positively describes bounded repository delivery that
benefits from one concise planning pass. It directs genuinely complex work to
an exact better-matching installed Squad or Advanced through ordinary catalog
selection, never a Host keyword route.

## Call-point disposition

| Surface | Disposition |
| --- | --- |
| `packages/opencorvus/src/agent/prompt-profile.ts` | Change the sole materialized default from `advanced` to `base`; keep the schema and `PromptProfile.activeID` unchanged. |
| `packages/opencorvus/src/expert-squad/builtin/index.ts` | Add the SDK-authored Base embedded source and `BASE_EXPERT_SQUAD_ID`; keep Advanced as an independent embedded package. |
| `packages/opencorvus/src/expert-squad/builtin/base/**` | Maintain the self-contained manifest, README, selector, and Orchestrator prompt; add Researcher and Tester prompts; narrow Planner to research-backed planning; make Developer publish a development handoff. |
| `packages/opencorvus/src/server/routes/expert-squad.ts` | Replace the uninstall replacement literal/type with the canonical Base identity; preserve the concurrent project-over-global resolution implementation. |
| `packages/overlay/src/services/expert-squad.ts` | Send and type the Base replacement identity; preserve concurrent installation-scope settings work. |
| `PromptProfileResolver` | No new branch or fallback. Its existing embedded-package discovery and `DEFAULT_PROMPT_PROFILE_ID` catalog field resolve Base through the same path. |
| Mission and explicit `advanced` call sites | Preserve. They intentionally select the full Advanced bootstrap/authoring contract and are not default semantics. |
| Generated OpenAPI/SDK | Regenerate through repository commands after source/default schemas converge; do not hand-edit generated files. |
| `specs/current/architecture/01-agents.md`, `04-extensions.md`, `14-agent-runtime-mode.md`, `99-principles.md` | Record the non-Goal Researcher-to-Planner-to-Developer-to-Tester composite delivery contract. Preserve concurrent Delivery Slice edits. |
| Non-UI tests | Add one focused Base package projection test and update only positive default/catalog/uninstall expectations that truly describe default semantics. Explicit-Advanced contract tests remain Advanced. |
| Overlay | No component fork or UI-only filter. Use the existing catalog/settings surface; perform real-page interaction and screenshot review without creating or running UI automation tests. |

## Validation plan

1. Load both embedded packages through the real Registry and prove Base's exact
   four-Agent typed projection and three dependency edges.
2. Resolve scheduler and worker capabilities from an empty config and prove the
   effective package is Base, with Researcher, Planner, Developer, and Tester
   carrying distinct identities and role-compatible adapter contracts.
3. Exercise all four dispatch schema inputs without Goal fields and prove the
   exact research, planning, development, and testing Artifact handoffs.
4. Exercise catalog and uninstall replacement positive contracts with Base as
   the default/replacement identity while Advanced remains selectable.
5. Regenerate tracked OpenAPI/SDK/build artifacts using canonical commands and
   run focused Registry, Resolver, config-route, global-config, package, and
   generated-artifact tests; then typecheck, API route check, docs check, and
   document-health suites.
6. Open the real Overlay Expert Squad surface, confirm Base is displayed as the
   default convenient Advanced variant and Advanced remains available, capture a
   task-bound screenshot, and inspect it manually.
7. Perform a final semantic diff review, stage only task-owned paths/hunks, commit
   with `dsw-33987`, push `v0.0.27beta` to `legacy-remote`, and verify remote equality.

## Implementation outcome

- Revised the self-contained embedded `base` package to the exact
  `base-researcher (explore) -> base-planner (delegated-worker) -> base-developer (build) -> base-tester (delegated-worker)` workflow.
- Added the canonical research, planning, development, and testing
  Artifact handoffs and enabled the Researcher Explore projection's explicit
  web research tools plus Developer and Tester Browser evidence tools.
- Made `base` the single materialized default and uninstall replacement while
  retaining `advanced` as the independently selectable full Expert Squad.
- Regenerated the OpenAPI, SDK, portable template, payload, and API reference
  artifacts from their canonical generators.
- Updated the current architecture and bilingual product documentation to
  distinguish Base's non-Goal convenience flow from Advanced's full workflow.

## Codex review correction

The first implementation incorrectly treated repository investigation as a
Planner responsibility and omitted a testing identity. This
was not implied by replacing Advanced's requirements-architecture-development
chain with a Planner. The revised single source defines one composite chain with
separate evidence collection, planning, implementation, and testing while retaining the user's
non-Goal and Build-derived constraints. The previous two-Agent topology is
superseded and must not remain in manifest, prompts, tests, docs, or architecture.

## Validation evidence

- Positive Base package, Registry, Resolver/default, config-route, global-config,
  portable-template, uninstall, Advanced, Overlay lifecycle, and generated build
  artifact contracts passed.
- The revised Base package contract passes four focused cases proving the exact
  four-Agent roster, three dependency edges, four canonical Artifact types,
  role-compatible adapter identity for every Agent, Researcher web tools, and Developer
  plus Tester Browser projections. The combined built-in Registry suite passes
  70 tests with 748 assertions.
- `bun run typecheck`, `bun run api:routes-check`, and `bun run docs:check` passed.
- Historical-link, document-health, and product-doc single-source suites passed.
- A source Overlay and source backend were run against an isolated portable
  home. Manual interaction showed two available built-ins, Base as `Effective
  active`, Advanced still available, and the Base Agent detail listing Base
  Researcher, Base Planner, Base Developer, and Base Tester with `Base role:
  build`; browser diagnostics contained no warnings or errors.
- Manually inspected screenshots are stored at
  `specs/artifacts/base-default-expert-squad-catalog.png` and
  `specs/artifacts/base-default-expert-squad-agents.png`.

During an earlier read-oriented scheduler-resolution check, importing the runtime
from the repository directory opened the existing runtime database; schema
refresh reached a WAL checkpoint and then stopped on a database lock before
journal-mode replacement. No retry, unlock, process restart, or recovery action
was attempted. All subsequent runtime checks used isolated temporary projects.
