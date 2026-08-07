# Prism surface evidence fan-out and resource stability

## Recall

### User requirements

- Continue the real Prism test on port `6888` against the canonical OpenCorvus database.
- Do not use a benchmark wrapper and do not touch the independent `7878` or `7879` services.
- Find and repair infrastructure and Expert Squad defects exposed by the real Mission.
- Keep Expert Squad policy inside the Prism package rather than adding domain policy to core prompts.
- Treat optional or sparse details as acceptable; repair false or missing evidence, invalid paths, persistence/tool failure, repeated pollution, or deadlock.
- Reduce the excessive resource use that appeared when the Product Requirements phase opened many parallel agents.

### Acceptance

1. The generic and AInvest Prism workflows acquire each delivery surface through one browser-owning evidence worker rather than four independent browser-owning workers.
2. That worker records User Interface, User Experience, interaction-state, accessibility, screenshot, and asset-candidate provenance evidence for every member route.
3. Asset materialization remains a separate provenance-preserving responsibility, but consumes the accepted surface evidence packet and owns no browser or web-search surface.
4. Generic mirror delivery does not require unrelated competitor research before Product Requirements authoring.
5. Existing specialist agents remain valid package capabilities; the binding delivery workflow simply stops duplicating source acquisition.
6. Real package loading tests prove both workflow graphs, dependency order, tool projection, and prompt contract.
7. A fresh Mission on `6888` uses the canonical database and demonstrates bounded fan-out without reusing polluted Mission, Session, Task, Goal, or run artifacts.

### Hard constraints

- No host-side concurrency gate, cap, fallback, retry loop, state machine, or Prism-specific core-prompt rule.
- No compatibility path or second evidence source.
- Preserve all unrelated dirty-worktree changes and stage only task-owned paths.
- Record tests and push the exact repair to `legacy-remote` with a `dsw-33987` commit subject.

### Materials read

- `AGENTS.md`
- `expert-squads/mirror/prism/expert-squad.jsonc`
- `expert-squads/mirror/prism/agents/orchestrator/system.md`
- `expert-squads/mirror/prism/agents/mirror-prd-ui-researcher/**`
- `expert-squads/mirror/prism/agents/mirror-prd-ux-researcher/**`
- `expert-squads/mirror/prism/agents/mirror-prd-asset-curator/**`
- `expert-squads/mirror/prism/agents/mirror-prd-competitor-scout/**`
- `expert-squads/mirror/prism/agents/mirror-prd-author/**`
- `packages/opencorvus/src/mission-skill/builtin/mirror-prism-cluster/references/virtual-workflow-contract.md`
- `packages/opencorvus/test/expert-squad/mirror-prism-package.test.ts`
- `packages/opencorvus/test/expert-squad/mirror-prism-source-capability.test.ts`
- `packages/sdk/js/test/mirror-prism-collaboration.test.ts`

### Repository search

The full repository search for `mirror-prd-competitor-scout`, `mirror-prd-asset-curator`,
`mirror-prd-ui-researcher`, `mirror-prd-ux-researcher`, and `mirror-prd-author` found:

| Call site or contract | Disposition |
| --- | --- |
| Prism manifest agent catalog entries | Keep all agents as explicit package capabilities. Remove browser/web-search projection only from the asset curator. |
| `mirror-prism-generic` workflow nodes | Remove mandatory competitor and separate UX acquisition nodes; order UI evidence, asset materialization, and authoring. |
| `mirror-prism-ainvest` workflow nodes | Apply the same acquisition topology while preserving the AInvest mapper dependency. |
| Prism Orchestrator package prompt | Replace the four-way research instruction with the single surface-evidence packet contract. |
| UI researcher prompt, skill, and audit reference | Expand the existing browser owner to cover journeys, focus, recovery, and asset-candidate provenance. |
| Asset curator prompt and skill | Require consumption of the accepted surface packet; prohibit rediscovery and browser traversal. |
| Author skill | Consume canonical source, consolidated surface evidence, materialized asset ledger, and optional AInvest authority. |
| Mirror Prism cluster Mission Skill | Match the installed Prism manifest's 38/42-node graphs and consolidated observation topology; remove its stale four-way acquisition description. |
| Package loading and source-capability tests | Update exact node cardinality and add regression assertions for dependencies, tool ownership, and package prompts. |
| Historical records and specialist package tests | Preserve as historical evidence or standalone specialist capability coverage; do not rewrite history. |

No core prompt or shared dispatcher needs domain-policy changes for this repair.

The first fresh-15 pre-Task Mission check exposed a separate deployment fact: the running Mission
Skill and project-installed Prism package still described the previous 40/44-node graphs even though
the source package and embedded release payload were updated. The Mission was aborted before Task
persistence. The canonical fix therefore also updates the Mission Skill source/generated payload
and explicitly replaces the project-scoped Prism package through the existing package-manager route;
it does not add a synchronization fallback.

## Evidence and causal chain

The cancelled fresh-14 Task `tsk_f9a5f3d46001ySOjBpW5alZn1y` created two Product Requirements
delivery-surface Goals. The binding workflow projected four independent goal-scoped acquisition
nodes from the same Architect predecessor for each Goal: competitor scout, asset curator, User
Interface researcher, and User Experience researcher. Eight browser-capable agents therefore ran
at once. They accumulated roughly 2.2 million input tokens, retained many browser sidecars, and
drove the shared backend above 90 percent CPU with approximately 2.6 GB resident memory.

The direct trigger is the workflow dependency graph. The deeper design error is that asset
provenance, interaction research, and visual research each rediscover the same source instead of
consuming one canonical delivery-surface observation packet. Full-session message/tool projection
and verbose runtime logs amplified the cost but did not create the fan-out. SQLite
`PRAGMA quick_check` remained `ok`.

## Repair

Use `mirror-prd-ui-researcher` as the sole browser-owning delivery-surface observer. Its packet
combines measured visual evidence, material journeys and recovery behavior, keyboard/focus and
accessibility observations, screenshots, diagnostics, and asset-candidate provenance for all member
routes. `mirror-prd-asset-curator` then materializes only approved bytes from that packet and writes
the asset ledger without reopening the source. Product Requirements authoring consumes the
canonical system-project contract, the surface evidence packet, and the materialized ledger.

Competitor scouting remains an installed specialist capability but is not a mandatory node in a
source-parity delivery. It may be selected by a workflow that explicitly requires competitor
research; it is not source truth and cannot block ordinary mirror authoring.

## Verification

- Load the package through `ExpertSquadRegistry`.
- Assert generic and AInvest node cardinality and exact dependency order.
- Assert only the consolidated surface researcher owns Browser Model Context Protocol tools.
- Assert the asset curator owns `materialize-asset` but no browser or web-search projection.
- Assert package prompts require canonical-contract-first, targeted observation and forbid duplicate discovery.
- Assert the Mirror Prism cluster Mission Skill publishes the same 38/42-node topology.
- Run historical documentation link health after adding this record.
- Reload only the `6888` test backend after proving no live owner, then publish one fresh real Mission against the canonical database and inspect SQLite plus runtime evidence directly.

## Candidate-browser session addendum

The fresh-17 canonical-database verification exposed a second fan-out layer inside the now-single
general researcher. Session `ses_06472904effdMVI9GbaSzIL0sw` created 30 Browser Sessions, issued 30
navigations, 31 clicks, and 31 observations while evaluating 30 candidate cards. The Agent count
was correct, but one Browser Session per candidate retained the same avoidable sidecar/page
multiplication inside a single worker.

The source researcher prompt and its projected `source-system-mapping` Skill now require one Browser
Session per discovery run, sequential reuse across candidate URLs, and explicit destruction after
acquisition. This remains model-owned tool usage guidance inside the Prism package; no host
concurrency gate, cap, retry, or route-specific state machine is introduced.
