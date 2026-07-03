# 2026-07-03 Agent Team Product Vision Roadmap

Status: planning record.

## Glossary

- AI means Artificial Intelligence, the model-assisted capability layer.
- API means Application Programming Interface, the callable contract between modules or services.
- CC means Claude Code, Anthropic's coding-agent product mode referenced by the user.
- CI/CD means Continuous Integration and Continuous Delivery, the automated build, test, release, and deployment flow.
- CR means Code Review, the human or agent review of a change before merge.
- DB means Database, the durable storage layer.
- E2E means End-to-End, verification through the real user-facing path rather than a mocked contract.
- GUI means Graphical User Interface, the visible interactive app surface.
- IDE means Integrated Development Environment, the project editing and execution workspace.
- LLM means Large Language Model, the model that reasons and calls tools.
- MCP means Model Context Protocol, the protocol for exposing external tools and resources to agents.
- PR means Pull Request, the merge proposal used by hosted Git platforms.
- QA means Quality Assurance, review and verification work against explicit evidence.
- UI means User Interface, the visual and interactive controls users operate.
- UX means User Experience, the end-to-end quality of the user's workflow.

## Recall

### User Request

The user asked to slightly refine the OpenCorvus vision and supplied this
roadmap:

- Goal: as agent team infrastructure, support extension and many task families:
  research, design, coding, debug, test, deployment, and similar development
  work.
- Positioning: local + cloud IDE that supports many development scenes and
  gradually expands into a full-stack development tool. Different scenarios
  should activate different expert, tool, and skill combinations. New needs
  should be adaptable with small configuration changes.
- Current state: infrastructure design has converged around skill, tool, MCP,
  memory, goal, parallelism, and related capabilities; the framework has early
  multimodal text/vision capability; expert squads have been implemented and
  validated in frontend replica work.
- Product shape: one entry, with CC/Codex mode for everyday AI-assisted
  development and autonomous workflow mode for predictable orchestrated work,
  such as research -> design -> coding -> debug -> test -> deploy, CR ->
  review -> merge -> release, translation, and refactoring. Predictable
  scenario workflows should automate 70-80% of the work around the clock, with
  humans handling the remaining 20-30%. Unpredictable work stays in human-led
  CC/Codex mode.
- Difficulties: lack of multi-scenario validation, unresolved product-form
  design, and insufficient developer support.
- Validated scenarios: screenshot-to-full-stack meeting booking page,
  Kimi-based TV webpage generation without visual validation, high-fidelity
  visual-first 7x24 TV frontend replica, and high-fidelity full-stack 7x24 TV
  / ETF webpage replica.
- Roadmap: July perfect frontend replica; August frontend research ->
  original webpage design; September automated frontend debug/test; October
  and later expand into other stacks and development scenes.

### Acceptance Criteria

- Preserve the user's original vision and timeline while making it more
  actionable.
- Clarify the two product modes and when each is appropriate.
- Connect the vision to the current architecture: Orchestrator, expert squads,
  PromptProfile capability projection, tools, skills, MCP, memory, goal,
  evidence, and executors.
- Turn "small configuration changes" into a concrete scenario-onboarding
  package without adding fallback, keyword routing, hidden messages, host-side
  gates, or a fixed state machine.
- Add monthly roadmap deliverables and measurable acceptance signals.
- Keep this as a dated planning record, not current runtime authority.

### Hard Constraints

- No fallback, compatibility branch, dual source, hidden message fork, keyword
  router, fixed host pipeline, or lifecycle gate.
- Orchestrator remains the only task-level scheduler and lifecycle owner.
- Expert squads are selected visibly and project role prompts plus scheduler
  capability surfaces through PromptProfile; they are not host-side classifiers.
- Autonomous workflow means LLM-orchestrated, evidence-backed task execution,
  not a hard-coded state machine.
- CC/Codex mode and autonomous workflow mode share the same project, evidence,
  executor, and task infrastructure rather than becoming separate products.
- This project is not a JavaScript-only or TypeScript-only tool; scenario
  expansion must keep the platform generic.
- Specs and planning records live only under the root `specs/` tree.

### Sources Read

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/README.md`
- `specs/current/architecture/17-agent-team-infrastructure.html`
- `specs/current/architecture/18-webpage-replica-agent-workflow.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-01-frontend-innovate-design-philosophy.md`
- `specs/records/2026-07/2026-07-02-agent-team-investment-drawio.md`
- `specs/records/2026-07/2026-07-02-single-agent-vs-opencorvus-clear-drawio.md`
- `specs/records/2026-07/2026-07-03-expert-squad-capability-profile.md`
- `specs/artifacts/tv2ainvest.md`

### Whole-Repository Search Evidence

| Command | Finding |
| --- | --- |
| `rg --files specs \| rg "(README\|roadmap\|vision\|architecture\|规划\|路线\|frontend\|autonomous\|workflow\|expert\|squad\|tv2ainvest)"` | Current relevant sources are the current architecture index, agent team map, webpage replica workflow chapter, July frontend/expert-squad records, and the `tv2ainvest` artifact. |
| `rg -n "愿景\|路线规划\|roadmap\|vision\|autonomous workflow\|CC/Codex\|Codex模式\|Claude Code\|agent team\|Agent Team\|全栈开发\|多场景\|前端复刻\|前端项目调研\|自动化debug\|部署" specs packages AGENTS.md README.md -S` | No existing single roadmap record covers the user's latest product vision. Existing references cover agent team architecture, frontend replica records, CC/Claude Code executor positioning, and frontend innovate design research. |
| `rg -n "agent team\|Agent Team\|expert squad\|专家团\|skill matrix\|配置矩阵\|MCP\|memory\|GUI\|workflow\|agent family\|skill" specs packages docs README.md` | The platform concepts already exist across architecture, records, docs, source, tests, and the public README; this record should synthesize them instead of inventing a new runtime model. |

### Independent Agent Feedback

No new sub-agent was spawned because the available sub-agent tool policy allows
spawning only when the user explicitly asks for sub-agents, delegation, or
parallel agent work. This record carries forward relevant prior independent
feedback from `2026-07-02-single-agent-vs-opencorvus-clear-drawio.md`: keep the
architecture contrast clear, show Codex / Claude Code / OpenCorvus as coding
executors rather than the whole system, keep Build Agent separate from
executors, keep Integrity as review evidence rather than lifecycle authority,
and avoid planner, acceptance-agent, gate, hidden-routing, and fixed-pipeline
wording.

## Refined Product Thesis

OpenCorvus should be positioned as a local + cloud development IDE built around
an agent team substrate. The durable product value is not one particular
frontend replica workflow; it is the ability to repeatedly package new
development scenarios as expert-squad capability profiles, skills, tools,
evidence contracts, and UI projections on the same orchestration base.

The platform should expose one product entrance with two working modes:

| Mode | Primary user behavior | Best-fit task shape | Product promise |
| --- | --- | --- | --- |
| CC/Codex mode | Human leads the session, asks questions, reviews edits, steers tools, and makes local decisions. | Ambiguous, exploratory, one-off, or fast interactive development. | A stronger everyday coding assistant inside the project workspace, with access to OpenCorvus evidence, memory, tools, and executors. |
| Autonomous workflow mode | Human states the objective, constraints, acceptance criteria, and target scenario; agent team runs evidence-backed work until a terminal decision or explicit blocker. | Predictable multi-stage work with known evidence and acceptance shape. | Automate about 70-80% of repeatable work around the clock; humans handle intent clarification, high-impact product judgment, merge/release ownership, and genuinely novel tradeoffs. |

The two modes must not become two separate systems. They should share the same
task storage, project identity, artifact evidence, executor registry, skill
catalog, MCP integration, memory, goal model, and review surfaces. The
difference is product posture: manual steering versus scenario-packaged
autonomy.

## Strategic Positioning

OpenCorvus is not merely a single-agent coding assistant and not merely a
frontend clone tool. The long-term product should be:

1. A project-aware IDE surface for local and cloud development.
2. A task orchestration kernel that turns user intent into visible, durable,
   evidence-backed agent work.
3. A configurable expert-squad platform where new scenarios are added by
   changing a bounded scenario package, not by rewriting the scheduler.
4. A quality system that makes completion claims traceable to requirements,
   runtime evidence, screenshots, tests, review records, and delivery artifacts.
5. A full-stack development assistant that gradually expands from frontend
   replica/design into backend, testing, debug, deployment, CR/release, data,
   and document workflows.

The product story should stay sober: OpenCorvus does not replace developers.
It compresses the repeatable 70-80% of predictable workflows and gives
developers better evidence, better review surfaces, and better continuation
state for the remaining 20-30%.

## Scenario Package Model

"Only a small configuration change" should mean a new scenario can be onboarded
through a bounded package:

| Package part | Purpose | Single-source rule |
| --- | --- | --- |
| PromptProfile | Defines the expert squad, role-scoped prompt overlays, and scheduler capability projection. | Active profile is selected through visible profile state; no keyword classifier. |
| Skill set | Provides selector skill plus production workflow guidance for the scenario. | Skills describe how to use the scenario; they do not replace runtime tools. |
| Tool / MCP contract | Names required first-class tools and external MCP resources. | Tool availability is projected from the active profile, not duplicated in UI filters. |
| Evidence schema | Defines required artifacts, screenshots, checks, logs, test output, and review records. | Acceptance claims must cite evidence rows or files, not prose alone. |
| Workflow hint | Describes the usual sequence and rework loops. | It is a hint for Orchestrator reasoning, not a host state machine. |
| UI projection | Shows the right panels, task scope, evidence, diagnostics, and review records for that scenario. | UI reads backend evidence and capability projection; it does not invent local availability. |
| Benchmark | Provides representative tasks and measurable acceptance criteria. | A benchmark pass is not enough until the delivered artifacts receive second review. |

This package model is the bridge from current frontend-replica validation to
future backend, testing, deployment, and cross-stack tasks.

## Capability Ladder

The current validated work forms a useful ladder:

| Stage | What it proves | Remaining gap |
| --- | --- | --- |
| Screenshot-to-full-stack meeting booking page | Agents can generate a complete usable app from visual reference and requirements. | Needs stronger source evidence and interaction/visual verification discipline. |
| Kimi-based TV webpage generation without visual validation | Multi-stage project generation can produce frontend + backend structure. | Visual parity and runtime evidence were not yet first-class. |
| High-fidelity visual-first 7x24 TV frontend replica | The frontend replica expert-squad path can prioritize rendered parity and visual QA. | Needs stable task-scoped evidence, component-goal discipline, and false-green prevention. |
| High-fidelity full-stack 7x24 TV / ETF replica | The workflow can combine visual fidelity with data/backend implementation obligations. | Needs broader page families, stronger benchmark coverage, and productized operator UX. |

The next product step is not to claim generality prematurely. It is to turn
frontend replica into the first truly productized scenario package, then use
that template to grow adjacent scenarios.

## Roadmap

### July 2026: Frontend Replica 1.0

Goal: make frontend replica the first reliable, benchmarked autonomous workflow
scenario.

Deliverables:

- Source evidence pipeline that consistently binds reference screenshot, DOM,
  computed style, source components, layout geometry, assets, and runtime
  screenshots to task scope.
- One-component-per-goal decomposition for clone work by default, with enough
  goals to avoid all-in-one false completion.
- Component Interaction Matrix for every clickable, hoverable, focusable,
  expandable, sortable, filterable, chart, table, map, tooltip, popover, modal,
  drawer, and navigation element.
- Build consumption of frontend research, frontend design, rendered reference,
  visual QA feedback, and Integrity feedback as explicit context channels.
- Visual QA and Integrity reports backed by registered evidence/check rows.
- Rendered-vs-reference acceptance that prevents screenshot wrappers, blank
  filler geometry, stale evidence, and `no_project_diff` false green results.
- Product-facing task panels that let developers inspect requirements, goals,
  build sessions, visual evidence, and review conclusions without reading raw
  logs first.

Acceptance signals:

- At least three distinct TradingView-like pages complete with source-backed
  region evidence, implementation files, screenshots, and interaction tests.
- Each accepted task has requirement-to-goal-to-evidence traceability.
- Visual differences are either repaired or explicitly marked `[未达成]` with
  evidence and root cause.
- No accepted run depends on mocked E2E results, canned Visual QA, hidden
  fallback, or unverified screenshot text.
- Regression tests cover the root failure modes found in July records.

### August 2026: Frontend Research To Original Design

Goal: expand from "replicate a known page" to "research, design, and implement
an original webpage or redesign".

Deliverables:

- Frontend Innovate scenario package: design-resource research, product intent,
  user task analysis, information architecture, visual direction, accessibility,
  interaction states, and implementation handoff.
- Design resource manifest as the single semantic index for external design
  references, project design systems, screenshots, and source materials.
- Multi-direction design exploration with explicit rejection reasons and one
  selected direction that Build can implement.
- Existing-URL redesign flow that can analyze a page and produce an original
  design without copying brand visuals or losing task structure.
- Browser-backed verification for rendered design, interaction states,
  keyboard paths, accessibility checks, and performance-relevant basics.

Acceptance signals:

- Original design outputs are not generic AI visuals; every major design
  choice is tied to user task, product domain, design-system reuse, or
  researched reference.
- Build can implement the selected design direction without asking the designer
  agent to become a second builder.
- Visual QA can inspect a rendered page against the selected design handoff,
  not against a vague aesthetic claim.
- Integrity can trace every product claim to requirements, design evidence,
  implementation evidence, and verification evidence.

### September 2026: Automated Frontend Debug And Test

Goal: turn the evidence/review loop into an automated debug and testing
scenario for existing frontend projects.

Deliverables:

- Frontend automation-debug expert squad with browser diagnostics, runtime
  state inspection, screenshot comparison, accessibility signals, console/network
  evidence, and repair planning.
- Test harness patterns for component interaction, Playwright through Node on
  Windows, browser preview evidence, visual regression, and inactivity-based
  long-running timeouts.
- Failure triage that distinguishes product bug, test bug, environment/tooling
  bug, flaky timing, and missing evidence without masking any of them.
- Repair loop that writes a targeted fix, adds regression tests, reruns the
  original checker, and performs second review before acceptance.

Acceptance signals:

- Representative frontend failures can be reproduced, diagnosed, fixed, and
  verified without manual log archaeology.
- Toolchain problems are fixed before being reported as product failures.
- Test timeouts are based on inactivity, not process-start elapsed time.
- Debug reports expose root cause and evidence, not just the last surface
  status such as cancelled, aborted, or timed out.

### October 2026 And Later: Multi-Stack Expansion

Goal: apply the same scenario-package model to broader development work.

Candidate scenario families:

- Backend/API evolution: contract research, route/service/model change, DB
  reset/rebuild where applicable, integration tests, and generated SDK sync.
- CR -> review -> merge -> release: change review, test evidence, release
  notes, merge readiness, CI/CD diagnostics, and deployment checks.
- Cross-language translation/refactor: architecture extraction, module mapping,
  incremental implementation, test parity, performance checks, and documentation.
- Deployment/debug: environment inventory, service startup, logs, health checks,
  packaging, upload, smoke verification, and rollback evidence where authorized.
- Data/report/document work: spreadsheet/document/presentation generation with
  render verification and source-backed claims.
- Vertical expert copilots: domain-specific expert squads that package
  terminology, tools, evidence, and acceptance metrics for repeated business
  workflows.

Acceptance signals:

- Each new scenario ships with a PromptProfile capability projection, skills,
  evidence schema, targeted benchmarks, tests, and UI inspection surface.
- New scenarios reuse the common Orchestrator/task/artifact/executor substrate.
- Adding a scenario does not require keyword routing, a second scheduler, a
  hidden tool path, or a compatibility fallback.
- At least one non-frontend scenario reaches a full E2E benchmark with real
  artifacts and second review.

## Product Form Principles

The product should make complexity inspectable without forcing users to manage
agent internals:

1. Unified entrance: the user starts from the same project surface and chooses
   manual CC/Codex-style assistance or an autonomous scenario.
2. Scenario-first creation: predictable tasks start from a scenario card or
   command that asks for objective, inputs, constraints, and acceptance
   criteria.
3. Evidence-first progress: the UI shows requirements, goals, active agents,
   evidence, reviews, and unresolved blockers as first-class objects.
4. Human handoff surfaces: the remaining 20-30% of work should appear as clear
   decisions, review findings, merge/release actions, or explicitly blocked
   unknowns rather than vague chat summaries.
5. Executor clarity: Codex, Claude Code, and OpenCorvus executors are coding
   execution choices under Build, not separate competing product identities.
6. Scenario catalog: developer users should understand which expert squad,
   skills, tools, MCP resources, and acceptance checks are active for the
   current scenario.

## Main Risks And Countermeasures

| Risk | Why it matters | Countermeasure |
| --- | --- | --- |
| Multi-scenario validation is too narrow | A platform claim based only on frontend replica will be fragile. | Finish frontend replica as the first scenario package, then add one adjacent frontend-design scenario and one non-frontend scenario with real benchmarks. |
| Product form becomes a log viewer | Long autonomous work is useless if users cannot inspect state and intervene coherently. | Build task-scope panels around requirements, goals, evidence, review findings, and human decisions. |
| Scenario packages become hidden routing | Small configuration changes can easily drift into host-side keyword dispatch. | Keep scenario selection visible through PromptProfile / skill surfaces and make runtime capability projection auditable. |
| Benchmarks produce false green | Autonomous delivery is dangerous if acceptance can be mocked or stale. | Require real rendered targets, evidence-backed review rows, original checker reruns, and second review after benchmark pass. |
| Developer support is insufficient | New scenarios will remain one-off prompt edits. | Provide a scenario package checklist, expert-squad creator flow, template records, and tests that force capability, skill, evidence, UI, and benchmark coverage. |
| Toolchain failures masquerade as task failures | Agent autonomy collapses when environment setup is brittle. | Treat toolchain repair as part of the task until the original checker runs or an external blocker is proven. |

## Near-Term Product Decision

The most important July decision is to resist expanding horizontally before
frontend replica has a reliable productized loop. Frontend replica already
exercises the hardest platform primitives: source evidence, visual evidence,
goal decomposition, Build, browser verification, Visual QA, Integrity, review
feedback consumption, and false-green prevention. Once it is stable, the same
scenario-package shape can be reused for Frontend Innovate in August and
frontend automation-debug in September.

The refined vision is therefore:

```text
One OpenCorvus project IDE
  -> two working modes: human-led CC/Codex mode and autonomous workflow mode
  -> one shared agent-team substrate
  -> many scenario packages
  -> evidence-backed automation for predictable development work
  -> human ownership for ambiguous product judgment, merge, release, and final accountability
```
