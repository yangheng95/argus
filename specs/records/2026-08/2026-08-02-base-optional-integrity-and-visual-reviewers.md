# Base Optional Integrity and Visual Reviewers

Date: 2026-08-02

Status: Implemented and accepted.

## Recall

| Item | Details |
| --- | --- |
| User requirement | Add complete-integrity validation and visual validation Agents to the built-in `base` Expert Squad as optional Agents. |
| Acceptance criteria | Base projects exact `base-integrity-reviewer` and `base-visual-reviewer` identities in addition to its existing four identities; ordinary delivery can retain the four-node workflow; a system-verified workflow includes independent integrity review; a graphical workflow includes real rendered visual review and final integrity review; the Resolver returns both new active capabilities and their complete resource grants; package docs and catalog copy explain when each workflow applies. |
| Hard constraints | Preserve all concurrent worktree changes. Do not add an optional-node flag, Host gate, state machine, fallback, alias, second active-profile source, hidden message, Goal planning facts, or runtime dependency on Advanced. Every node in a selected workflow remains mandatory. Do not add, modify, update, or run User-Interface automation tests. Use positive non-User-Interface contract tests. Because the active-agent catalog is user-visible, inspect the real Overlay and a fresh screenshot without encoding that review as a test. Commit subjects use `dsw-33987` and push to `myhexin`. |
| Existing worktree | Branch `v0.0.28beta` tracks `myhexin/v0.0.28beta`. Mission authority, prompt, panel, test, and architecture files already contain concurrent staged changes. This task will preserve them and stage only task-owned paths or hunks. |
| Sources read | Root `AGENTS.md`; current architecture `01-agents.md`, `04-extensions.md`, and `14-agent-runtime-mode.md`; the embedded Base and Advanced manifests, README files, selectors, Orchestrator overlays, Visual Reviewer and System Integrity Reviewer prompts; built-in package loader; Base package, Registry, and PromptProfile tests; English and Chinese Agent docs; the 2026-08-01 Base design record. |
| Whole-repository grep | Exact searches covered `base-researcher`, `base-planner`, `base-developer`, `base-tester`, `BASE_AGENT_IDS`, Base manifest version `2026.08.01.8`, every “sole workflow”, “exactly four”, and four-node Base claim, `virtual_workflows`, `visual-reviewer`, `system-integrity-reviewer`, Resolver active-agent expectations, Registry embedded-source expectations, docs, and current architecture. Dispatch construction exposes projected Agent IDs but initial dispatch requires a selected workflow binding, so a projected Agent outside the selected graph is not a valid optional-stage implementation. |
| Independent Agent feedback | No independent Agent was requested. Current collaboration policy prohibits inferred sub-agent spawning; the primary Agent performs implementation and a separate final semantic diff review. |

## Decision

Base remains one self-contained package and adds two package-owned dynamic
identities:

- `base-integrity-reviewer` derives from the platform `integrity` runtime
  template and owns independent system-level completeness review.
- `base-visual-reviewer` derives from the platform `visual-qa` runtime template,
  receives the existing Browser Model Context Protocol tool projection, and
  owns real rendered and interaction review.

Manifest v1 has no optional-node semantics, and every node in a selected graph
is binding. The package therefore models conditional delivery with three exact
workflows:

```text
composite-delivery
  Researcher -> Planner -> Developer -> Tester

integrity-verified-delivery
  Researcher -> Planner -> Developer -> Tester -> Integrity Reviewer

visual-verified-delivery
  Researcher -> Planner -> Developer -> (Tester || Visual Reviewer)
    -> Integrity Reviewer
```

The Orchestrator selects exactly one graph before domain dispatch. Ordinary
bounded repository work keeps the compact graph. Work whose acceptance requires
independent system completeness uses the integrity graph. User-Interface,
graphical, preview, or rendered-output delivery uses the visual graph so visual
review is never mistaken for whole-system acceptance.

The two reviewer prompts are Base-owned files. They may reuse the mature
platform runtime templates and Browser tool implementation, but they do not
read or inherit Advanced package prompts or resources.

## Call-point disposition

| Surface | Disposition |
| --- | --- |
| `packages/opencorvus/src/expert-squad/builtin/base/expert-squad.jsonc` | Add both exact projected identities, their complete resource arrays, and the two fixed conditional workflows; bump the strict package revision. |
| `packages/opencorvus/src/expert-squad/builtin/base/agents/**` | Add self-contained Integrity and Visual Reviewer overlays and teach the scheduler to select exactly one graph and honor its full dependency set. |
| Base README and selector | Replace the four-identity/sole-workflow claim with the six-identity and three-workflow contract while preserving non-Goal ownership. |
| `packages/opencorvus/src/expert-squad/builtin/index.ts` | Embed both new Base prompt files in the package source; do not change discovery or resolution. |
| `packages/opencorvus/test/expert-squad/base-package.test.ts` | Positively prove the six identities, all three exact workflow graphs, runtime adapters, Browser grant, and active Resolver projection. |
| `packages/opencorvus/test/expert-squad/registry.test.ts` and `packages/opencorvus/test/agent/prompt-profile.test.ts` | Update only exact positive Base active-agent roster expectations. |
| Current architecture and bilingual Agent docs | Record Base's three fixed workflow choices and specialist reviewer ownership. |
| Generated OpenAPI and JavaScript SDK | No manifest contents are generated into these schemas; regenerate only if canonical repository checks prove drift. |
| Overlay | No component change. Inspect the existing Expert Squad catalog against the real running development surface and capture a fresh screenshot. |

## Validation plan

1. Load the embedded Base package through the real Registry and prove the exact
   six-Agent roster, three workflows, every dependency edge, and prompt files.
2. Resolve Scheduler, Integrity, and Visual capabilities from the default Base
   profile and prove exact runtime adapters and the Browser screenshot grant.
3. Exercise the positive dispatch-adapter input schemas for both reviewer
   identities.
4. Run the focused Base, Registry, and PromptProfile non-User-Interface contract
   tests, package typecheck, document-health tests, API route check, and docs
   check without running User-Interface automation tests.
5. Open the real Overlay Expert Squad surface, inspect the six projected roles
   and workflow description, capture a fresh screenshot, and review it
   manually.
6. Perform a second semantic diff review, stage only task-owned paths or hunks,
   commit with `dsw-33987`, push the current branch to `myhexin`, and verify the
   remote commit.

## Implementation outcome

- Base revision `2026.08.02.1` projects six exact identities, including
  package-owned `base-integrity-reviewer` and `base-visual-reviewer`.
- The existing compact workflow remains available. The new integrity-verified
  workflow runs the Integrity Reviewer after the test-backed handoff. The new
  visual-verified workflow runs Tester and Visual Reviewer in parallel after
  development and joins both evidence branches at the Integrity Reviewer.
- The Integrity Reviewer uses the canonical typed IntegrityReview runtime and
  the Visual Reviewer uses the canonical typed VisualReview runtime plus the
  complete default Browser Model Context Protocol tool projection.
- Base's selector and Orchestrator overlay select exactly one fixed graph and
  forbid inserting a reviewer that is absent from the selected graph.
- Registry, Resolver, current architecture, and bilingual public Agent docs all
  expose the same six-identity, three-workflow contract.

## Validation evidence

- `bun test packages/opencorvus/test/expert-squad/base-package.test.ts`: 4
  passed, 41 assertions.
- `bun test packages/opencorvus/test/expert-squad/registry.test.ts`: 61
  passed, 244 assertions.
- `bun test packages/opencorvus/test/agent/prompt-profile.test.ts`: 17 passed,
  264 assertions. An earlier combined run timed out while concurrent TypeScript
  checks were active; the isolated full rerun passed.
- `bun run --cwd packages/opencorvus typecheck`, `bun run api:routes-check`,
  and `bun run docs:check` passed.
- Historical-link checks passed. Product documentation single-source checks
  passed 8/8. Document health initially passed 59/60; its only failure was the
  expected Git-index check for this newly created, not-yet-tracked record and a
  concurrent record that was subsequently committed. After staging this record,
  the exact document-health suite passed 60/60 with 1,142 assertions.
- A source server was launched with an isolated `OPENCORVUS_HOME` on port 7889.
  The real Installed Agent Squads page showed Base `2026.08.02.1`, `6 Agents`,
  Base Integrity Reviewer with role `integrity`, and Base Visual Reviewer with
  role `visual-qa`. Manual screenshot review found all six rows readable with
  no overlap or clipping; browser warning/error diagnostics were empty. The
  isolated server shut down cleanly with zero owned Sessions or tool parts.
