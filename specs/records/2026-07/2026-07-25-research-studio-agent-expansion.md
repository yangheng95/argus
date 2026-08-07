# Research Studio Agent Expansion

Date: 2026-07-25
Status: Complete
Owner: Codex

## Recall

### User Request

Expand the bundled Research Studio Expert Squad with several commonly useful research agents because the current package is the simplified version.

The final research report must be displayed as a dynamic artifact and archived
as Markdown.

### Acceptance Criteria

- Replace the two-agent simplified package with a five-agent research team:
  `research-studio-planner`, `research-studio-researcher`,
  `research-studio-analyst`, `research-studio-fact-checker`, and
  `research-studio-writer`.
- Give each agent one non-overlapping responsibility: research design, durable
  evidence collection, analysis, claim verification, or final report delivery.
- Keep a lightweight direct-writing workflow for supplied bounded material, a
  verified evidence-synthesis workflow for supplied evidence, and a full
  source-backed research workflow.
- Require the Orchestrator to select one exact manifest workflow before the
  first dispatch and to pass stable Session, message, artifact, file, and URL
  references between agents.
- Keep the final artifact contract: one verified project-relative Markdown
  archive and one dynamically displayed message-owned `document@1` artifact
  with identical Markdown.
- Validate SDK round-trip authoring, Registry loading, Manager installation,
  Resolver projection, exact dispatch adapters, bundled payload generation, and
  document indexes.

### Hard Constraints

- Manifest `id`, `prompt_profile.active`, Registry, Manager, Resolver,
  `virtual_workflows`, and the generated bundled payload remain the existing
  single sources.
- Use the mature runtime templates already owned by the platform:
  `delegated-worker`, `deep-research`, and `fact-check`. Do not add package
  tools, skills, Model Context Protocol providers, routes, renderers, or a
  second research-artifact protocol.
- Do not add requirements, architecture, build, design, test, product-review,
  or software-delivery agents to Research Studio.
- Do not add a host gate, persisted workflow state, fallback identity, alias,
  keyword router, hidden message, or compatibility path.
- Preserve every unrelated staged, unstaged, and untracked change in the shared
  worktree. Do not restart, refresh, or stop a running OpenCorvus or Overlay
  process.
- Commit subjects on the current beta delivery line start with `dsw-33987`, and
  the completed task is pushed to `myhexin/v0.0.18beta` through normal hooks.

### Sources Read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-22-research-studio-expert-squad.md`
- `specs/records/2026-07/2026-07-24-expert-squad-fact-turn-sdk-calibration.md`
- `expert-squads/builtin/research-studio/{expert-squad.jsonc,README.md,selector.md}`
- All current Research Studio scheduler and worker overlays.
- `packages/sdk/js/src/expert-squad-authoring.ts`
- `packages/opencorvus/src/agent/{runtime-template-registry,tool-pool-data,dispatch-adapter-input}.ts`
- `packages/opencorvus/src/expert-squad/{catalog,prompt-profile-resolver}.ts`
- Research Studio package, SDK round-trip, payload, repository package, and
  virtual-workflow tests.

### Whole-Repository Search Evidence

| Surface | Complete call-point result | Decision |
| --- | --- | --- |
| Agent identities | Exact `research-studio-researcher` and `research-studio-analyst` expectations occur only in the source package, its focused OpenCorvus package test, its SDK round-trip test, the generated payload, and the historical 2026-07-22 record. | Replace current package/test expectations; preserve the historical record as historical evidence; regenerate the payload. |
| Workflow identity | `source-backed-delivery` occurs only in the current manifest, scheduler/package test, generated payload, and the historical record. | Replace it with three explicit workflow contracts; do not retain the old workflow as a fallback. |
| Package catalog | Manager, repository catalog, dynamic-agent, prompt-profile, and virtual-workflow suites discover Research Studio by manifest `id`; they do not hard-code its agent roster. | Keep the manifest identity and exercise the shared discovery path without adding a package-specific catalog branch. |
| Runtime adapters | `deep-research` already owns durable structured research facts and the `deep_research` adapter; `fact-check` already owns exact Session/message claim verification and the `fact_check` adapter; `delegated-worker` already owns general read/write and interactive-artifact delivery. | Project the new roles onto these existing templates instead of hand-building research tools. |
| Payload | `generate-expert-squad-payload.ts` reads tracked package files from the Git index and validates them through Registry before generating `packages/opencorvus/generated/expert-squad-payload.ts`. | Stage new package files before generation; do not edit the generated module manually. |
| Documents | `specs/README.md` and `specs/records/2026-07/README.md` currently point to the minimal 2026-07-22 Research Studio record. | Add this record as the latest expansion while retaining the older historical entry. |

### Independent Agent Feedback

The user did not request multiple independent agents, sub-agents, or parallel
audit. Under the current delegation boundary no sub-agent was started; the main
agent owns the design, implementation, focused verification, and second review.

## Design

### Agent Responsibilities

1. `research-studio-planner` frames the bounded question, audience, definitions,
   subquestions, source hierarchy, freshness threshold, comparison dimensions,
   and stopping conditions. It does not retrieve the full evidence set or write
   the report.
2. `research-studio-researcher` uses the platform `deep-research` runtime to
   collect durable multi-source evidence, contradictions, citation mappings,
   and unresolved gaps. It does not write the final report.
3. `research-studio-analyst` builds the claim/evidence matrix and performs
   qualitative or quantitative synthesis without publishing the final report.
4. `research-studio-fact-checker` uses the platform `fact-check` runtime against
   the analyst's exact visible message and referenced artifacts. It returns
   supported, contradicted, overstated, or unresolved verdicts with corrections.
5. `research-studio-writer` is the only final-delivery agent. It consumes the
   accepted evidence, analysis, and verification refs; writes and rereads one
   canonical Markdown report; and publishes byte-equivalent Markdown as
   `document@1`.

### Binding Workflows

| Workflow | Required dependency graph | Intended request |
| --- | --- | --- |
| `direct-writing` | writer | Bounded supplied material requiring faithful summary, rewrite, or formatting without new factual synthesis. |
| `evidence-synthesis` | analyst -> fact-checker -> writer | Supplied evidence requiring analysis, comparison, or recommendations. |
| `full-research` | planner -> researcher -> analyst -> fact-checker -> writer | Questions requiring external source discovery and evidence collection. |

The graphs are immutable scheduler contracts, not a host workflow engine. The
Orchestrator chooses one exact workflow from visible request/evidence facts,
observes terminal-success evidence for every declared node, and never persists
an active workflow or step status.

## Validation Plan

- Strengthen the focused package test with the exact five-agent role map, exact
  three-workflow graphs, prompt handoff contracts, and absence of package-owned
  tools/skills/Model Context Protocol declarations.
- Import and activate the package through Manager, then resolve all five agents
  through `PromptProfileResolver`; assert exact dispatch adapters and the
  existing tool surfaces required by retrieval, verification, and delivery.
- Update the SDK round-trip test to prove all new files and the exact agent
  roster survive package materialization.
- Update the repository fact/Turn version expectation, stage all package source
  files, regenerate the bundled payload, and run the payload reproducibility
  check.
- Run focused Research Studio, SDK, payload, virtual-workflow, repository
  dynamic-package, historical-link, document-health, and TypeScript checks.
- Review the exact task diff after tests, run `git diff --check`, commit only
  task-owned changes through normal hooks, push `myhexin/v0.0.18beta`, and
  verify local/remote commit equality.

## Validation Findings

1. Registry and Software Development Kit validation accepted the five exact
   projected identities, their prompt files, and all three workflow dependency
   graphs. The focused Research Studio, authoring round-trip, and repository
   Fact/Turn calibration set passed `13/13` with `155` assertions.
2. Manager import plus `PromptProfileResolver` proved the runtime projection:
   planner, analyst, and writer use `delegated_worker`; researcher uses
   `deep_research`; fact-checker uses `fact_check`. The test also proved the
   research runtime remains read-only, the fact-check runtime has retrieval but
   no write tool, and the writer receives `read`, `write`, and
   `publish_interactive_artifact`.
3. Generated payload reproducibility, payload build import, manifest protocol,
   and package installation checks passed. The generated payload includes all
   three new prompt files and the replacement manifest; no package-specific
   installer or catalog branch was added.
4. The first broad concurrent run exposed four repository-wide Resolver checks
   exceeding Bun's five-second elapsed timeout and then terminating one
   cleanup-failure fixture as dangling process `143`. Each failing path was
   rerun independently. The four real all-package checks now use the same
   unlimited elapsed-time convention as the existing package-wide checker and
   pass `10/10` with `1,767` assertions; the exact cleanup-failure fixture
   passed independently with `1/1` and `5` assertions. No product or cleanup
   assertion was removed.
5. Historical-link and document-health tests initially exposed four unrelated
   concurrent untracked records already linked by the shared July index, plus
   this new record. A temporary verification-only Git index included those
   concurrent files without changing the user's real index; both suites then
   passed `82/82` with `1,386` assertions. The Research Studio record itself is
   tracked in the real index.
6. OpenCorvus and Software Development Kit TypeScript checks passed, as did the
   Software Development Kit import check and both staged/unstaged
   `git diff --check` scans.

## Codex Review Feedback

The second review found that increasing the repository package roster made four
real all-package Resolver tests exceed Bun's unrelated five-second test-runner
default even though their assertions continued progressing. The implementation
was revised to disable only that elapsed timeout on those four exhaustive
checks, matching the pre-existing all-package schema-preparation test. A
separate rerun proved the cleanup fixture failure came from the timed-out
suite's dangling-process termination rather than the Research Studio package.

## Delivery

Delivery commit subject: `dsw-33987 expand research studio common agents`.
Target: `myhexin/v0.0.18beta` through normal repository hooks.
