# Research Brief Chunked Collector

## Problem

`submit_research_brief` is still a giant terminal schema. Even after structured
bundle fields replaced raw markdown/JSON strings, one tool call still carries
scope, evidence, facts, inferences, webpage contract arrays, open questions,
bundle sections, citations, and fact-check items. The TradingView run showed
the model repeatedly failed opaque schema details before any useful downstream
artifact existed.

`frontend_research` also does not actually investigate a supplied URL when no
prepared evidence exists. The role needs one source of page facts: host-prepared
rendered webpage evidence created from the supplied source URL before the agent
session.

## Grep Evidence

| Surface | Call points | Decision |
| --- | --- | --- |
| `submit_research_brief` | `src/research/output-tools.ts`, `src/research/agent.ts`, output-tool tests, prompt cores | Keep the terminal name but shrink it to `final: true` plus fact-check items. |
| `ResearchSubmitSchema` | `output-tools.ts`, tests | Replace with small `ResearchFinalizeSchema`; assemble final draft from collector registrations. |
| `ResearchBundleInputSchema` | `schema.ts`, `output-tools.ts` | Keep materialized shape, but fill it through `register_research_bundle_section`, `register_research_evidence_note`, and `register_research_citation`. |
| `webpage_contract` | `schema.ts`, `output-tools.ts`, prompt section, downstream research prompt injection | Keep persisted shape, but register each contract item as a small tool call. |
| `frontendResearchSessionConfig.prepareWebpageEvidence` | `src/frontend-research/agent.ts`, tests | Change to `always-for-source-url` so frontend-research materializes rendered webpage PRD evidence itself when called with a URL. |
| Prompt text saying frontend-research does not investigate | `frontend-research-core.txt`, role-contract/context-tool tests | Replace with host-prepared evidence investigation wording. |

## Design

Mirror `requirements` / `architect`:

- Registration tools mutate one collector:
  - `set_research_scope`
  - `set_research_summary`
  - `register_research_evidence`
  - `register_research_fact`
  - `register_research_inference`
  - `register_research_problem`
  - `register_research_need`
  - `register_research_constraint`
  - `register_research_document_section`
  - `set_webpage_contract_source`
  - one register tool per webpage contract array
  - `register_subpage_research_task`
  - `register_research_open_question`
  - `register_research_bundle_section`
  - `register_research_evidence_note`
  - `register_research_citation`
- `submit_research_brief({ final: true, fact_check_items })` validates and
  freezes the collector.
- `researchBundleFromDraft` continues to materialize bundle files from the
  assembled structured bundle.

## Validation

- Unit tests prove chunked registration finalizes and materializes the same
  persisted brief shape.
- Unit tests prove submit cannot finalize without required registered pieces.
- Schema tests prove legacy giant submit payload no longer matches the terminal
  tool.
- Frontend-research config tests prove URL runs use `always-for-source-url`.
