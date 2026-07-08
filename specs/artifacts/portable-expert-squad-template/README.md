# Portable Expert Squad Template

This artifact is a copy-and-edit template for an external OpenCorvus expert squad package.

The valid package root is `package/`. The file at `package/README.md` is runtime Orchestrator prompt content, not a human manual. Keep human instructions in this artifact README or in external docs outside the installed package root.

## Why The Template Lists Every Available Role

The template derives its default role list from `AgentRoleContract.promptProfileTargets()`, so it includes every OpenCorvus role that can participate in prompt-profile projection:

- `coding`: Direct coding assistant for ad hoc workspace edits outside the task workflow.
- `coding-assistant`: Right-sidebar coding assistant session. Uses the project conversation panel and executes tools based on configured permissions.
- `build`: General workflow executor. Produces one scoped task or goal deliverable through the build-core terminal-report contract.
- `visual-qa`: Focused visual QA (Quality Assurance) report-only agent. Uses browser/runtime evidence to test frontend GUI fidelity and observable functions, then reports reproducible visual and functional findings instead of relying on fixed screenshot baselines.
- `general`: General-purpose subagent for multi-step research and parallel work.
- `explore`: Read-oriented codebase exploration subagent for fast file, symbol, and code search.
- `orchestrator`: Orchestrator agent. Owns task lifecycle decisions and dispatches explicit workflow tools.
- `mission`: Mission primary agent. Owns long-running user goals: intake and clarification, the mission contract and state, the roadmap, and reconciliation of delivered work. A full coordinator (reads/analyses the project, plans, delegates, summarises, asks the user) that delegates execution to orchestrator-led squad/team tasks rather than writing code itself.
- `requirements`: Requirements agent. Extracts user requirements and foundational technical decisions; it does not produce goals.
- `architect`: Architect agent. Owns the goal graph, traceability, assembly ownership, and cross-goal contracts.
- `frontend-design`: Frontend design and webpage-replica agent. Single-shot task-scope evidence/handoff producer: dispatch it once to convert visual/reference evidence into the authoritative frontend implementation template, fillable modules, component inventory, material inventory, source handoff, and visual/data contracts; do not use it as a repeatable repair, retry, or implementation iteration agent after its handoff exists. For ainvest webpage rewrite work, generated code and PRD/SPEC/report material are reference inputs only; the rewritten webpage must be based on ainvest-frontend-design. It is not the owner for PRD/SPEC/report webpage research unless the requested deliverable is UI implementation or replication.
- `intent-analysis`: Intent-analysis agent. Disambiguates the raw request into intent, complexity, slots, missing info, and clarifications.
- `integrity`: Integrity reviewer. Audits requirement and goal integrity and produces session-bound pass or non-pass review reports, including runtime, frontend, visual, and rejection-detail evidence.
- `fact-check`: Fact-check agent. Verifies factual claims (APIs, library versions, numbers, paths, historical decisions) emitted by worker agents in their terminal report `fact_check_items[]`. Dispatched by the orchestrator after integrity pass; outputs structured verified/corrected/unresolved findings with evidence pointers.
- `deep-research`: Deep research agent. Read-only durable evidence gatherer for multi-source external facts, source maps, current documentation, API/industry research, PRD/SPEC/report source material, constraints, document outlines, and open questions. Dedicated webpage functional/visual investigation division belongs to frontend-research. Deep research never chooses routes or delivers final documents.
- `frontend-research`: Frontend research agent. Source-page-scoped investigation publisher: dispatch one session per source page URL so the host can prepare rendered webpage evidence for that page, publish source-backed webpage investigation work packets, then emit a frontend_research_brief with an investigation-partition webpage_contract covering visible surfaces, component questions, layout/style checks, interaction/data checks, page interface verification, API adaptation documentation handoff cues, fidelity risks, document outlines, constraints, and open questions; do not reuse the same page scope as a repeatable crawler, repair, retry, or implementation iteration agent after its brief exists. Same source URL with a different focus, viewport, interaction state, component, region, fidelity risk, or missing-detail question is still the same page scope. For ainvest webpage rewrite work, any generated code snippets, PRD outline, or document material are reference inputs only; downstream webpage rewriting must be based on ainvest-frontend-design. It does not create the frontend implementation template, does not call build, and never chooses routes or delivers final documents.
- `goal-workload-analyst`: Goal workload analyst. Read-only reviewer that deeply reads the full template and the architect goal graph, flags goals too large or under-specified for one autonomous build (decomposition_concern), and emits a per-goal execution inventory plus an anti-underestimation brief. References existing contract/coverage ids rather than restating them, and never creates or modifies goals.

A real expert squad should delete roles it does not actually use before installation. Keeping unused roles widens `dispatch_agent` and worker projection, which makes failures harder to diagnose.

## Directory Rules

- `capability_projection.agents` is the explicit projection source for runtime visibility.
- Absence of `agents.<role>` means the base OpenCorvus prompt and runtime contract remain in force.
- `agents/orchestrator/system.md` is the scheduler overlay for package-specific coordination.
- `virtual_agents.<role>` plus `virtual-agents/<role>/system.md` creates a package-owned expert identity on an existing base role.
- Do not keep `agents/<role>` and `virtual_agents.<role>` for the same role.
- Package root `README.md` is appended to the active Orchestrator prompt. Do not put tutorial prose there.

## Roles With Virtual-Agent Stubs

- `build`
- `visual-qa`
- `explore`
- `requirements`
- `architect`
- `frontend-design`
- `intent-analysis`
- `integrity`
- `fact-check`
- `deep-research`
- `frontend-research`
- `goal-workload-analyst`

## Create A Real Squad From This Template

1. Copy `package/` to `.opencorvus/expert-squads/<namespace>/<id>/`.
2. Rename `namespace`, `id`, `label`, package refs, virtual-agent IDs, and selector guidance.
3. Delete every role projection that is not actually part of the squad.
4. Keep only the virtual-agent prompts that express real package-owned expert identity.
5. Add package skills, tools, or MCP definitions under the package root and project them through `capability_projection`.
6. Validate with `ExpertSquadRegistry.loadPackage()` or the focused expert-squad tests before release.

## Good Portable Squad Checklist

- The selector explains when to choose the squad and when not to choose it.
- The Orchestrator README defines coordination contracts, not long tutorial text.
- Every projected role has a concrete job, evidence surface, and stop condition.
- Every package tool, skill, and MCP ref is explicitly projected and has one owner.
- Virtual-agent labels never become dispatch inputs. Dispatch remains on base role IDs.
- The package does not add fallback aliases, hidden routing, workflow engines, or config mutations.
