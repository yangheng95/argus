# Equity Research and Deep Research Expert Squads

## Recall

### User requirement

Reimplement and integrate two industry reference systems as first-class MOSA Agent Teams: a FinRobot-inspired investment-research team and a Stanford STORM-inspired deep-research team. Both teams must execute end to end, and the delivered report quality must remain close to the reference systems rather than stopping at a manifest or prompt demo.

### Acceptance bar

- Two independent, installable, self-contained Expert Squad packages are present in the repository payload.
- Each package declares one binding workflow with explicit Agent ownership, dependency edges, durable typed outputs, and an independently owned review step.
- Equity Research covers evidence acquisition, normalized fundamentals, valuation, thesis construction, factual audit, and an investor-ready report.
- Deep Research covers perspective discovery, evidence curation, outline construction, cited drafting, citation audit, and a polished long-form report.
- Registry, Manager, payload, PromptProfileResolver, projected adapters, package skills, and exact workflow graphs receive positive contract coverage.
- A real model executes each installed package as a directly published production Task. Final Markdown, structured Artifact lineage, and source/citation coverage are inspected against explicit reference-derived rubrics.
- Validation, second review, commit, and legacy remote push complete without staging unrelated worktree changes.

### Hard constraints

- Packages may reuse platform `default` capabilities but may not read or mount `research-studio` or any other Expert Squad private resource at runtime.
- `prompt_profile.active` and `PromptProfileResolver` remain the sole active-package and runtime-projection authorities.
- The binding virtual workflow is prompt-visible scheduling contract, not a new Host workflow engine, state machine, gate, fallback, or compatibility route.
- Evidence moves through the current Task Artifact catalog and exact content-addressed locators, never through copied Agent-message bodies.
- Only the final Build owner writes report files; research and review roles publish structured `expert_output` Artifacts.
- Tests assert current positive contracts. No User Interface automated tests are added or run.
- Upstream source is studied and attributed, not vendored or wrapped.

### Evidence read before implementation

- Project policy: root `AGENTS.md`, especially rules 7–16, 19, 28–33, and the Expert Squad boundary in rule 15.1.
- Platform implementation: Expert Squad Registry, Manager, PromptProfileResolver, payload generator, benchmark environment helpers, Artifact catalog protocol, embedded Research Studio package, and repository packages under `expert-squads/`.
- Existing positive contracts: Research Studio package tests, repository dynamic-package tests, and payload-generation tests.
- FinRobot source at commit `01ed408326f1d4ec2460596dee10858faf0f69af` (Apache License 2.0): equity-research data preparation, financial/peer/valuation stages, report sections, validation pass, and the Data/Concept/Thesis chain-of-thought separation described by its public implementation and paper.
- Stanford STORM source at commit `fb951af7744dab086e34962e9bc6fe878e145f83` (MIT License): perspective-guided knowledge curation, outline generation, cited article generation, and article polish.
- Repository search found no current full Expert Squad benchmark runner. The user explicitly rejected adding a benchmark script; validation therefore installs both payload packages and publishes ordinary production Tasks through the canonical Task service.

### Independent-agent feedback

No sub-agent was used because the user did not request delegation and the current collaboration policy forbids unsolicited spawning.

## Architecture decision

### `equity-research`

The package owns a seven-node `equity-research-report` graph:

1. Planner fixes company, as-of date, investor question, comparison set, source policy, and stopping conditions.
2. Source analyst builds a dated primary-source dossier and normalized metric table.
3. Fundamentals analyst and valuation analyst work in parallel from the exact source dossier.
4. Thesis analyst reconciles operating evidence, valuation, catalysts, risks, and bull/base/bear cases.
5. Fact checker audits numerical traceability, date consistency, valuation assumptions, and claim support.
6. Report writer reads selected terminal evidence, writes and rereads the canonical Markdown report, then publishes the report Artifact.

The report contract includes executive summary, company and industry context, financial quality, peer comparison, valuation with assumptions and sensitivity, catalysts, risks, scenarios, recommendation framing, source index, and an explicit research-not-advice disclaimer.

### `deep-research`

The package owns a six-node `multi-perspective-report` graph:

1. Planner bounds the question, audience, perspectives, source policy, and stopping conditions.
2. Knowledge curator discovers distinct perspectives, converts them into a question matrix, and gathers source-backed answers.
3. Outline editor builds a non-redundant evidence-grounded hierarchy.
4. Draft writer writes the complete cited article from selected evidence and outline Artifacts.
5. Citation reviewer independently checks entailment, source quality, coverage, and citation placement.
6. Report writer resolves the review, writes and rereads canonical Markdown, and publishes the final report Artifact.

This preserves STORM's research method while replacing its monolithic pipeline with explicit MOSA ownership and Artifact handoffs.

## Quality and end-to-end validation

Validation will install each payload package into the current project and publish a normal production Task with the package selected through `prompt_profile.active`. The canonical Task service owns Session creation, queueing, model execution, workflow occurrences, Artifact publication, and terminal state.

Quality is evaluated as a positive coverage rubric rather than a single opaque score:

- Equity Research: source provenance, financial traceability, peer logic, valuation assumptions and sensitivity, thesis balance, catalyst/risk specificity, scenario consistency, report completeness, and audit closure.
- Deep Research: perspective diversity, question coverage, primary-source share, citation entailment, citation coverage, outline coherence, section depth, synthesis across sources, uncertainty handling, and final readability.

The reference bar comes from the two upstream workflow and report contracts. If credentials or external providers prevent a real run, the task is not accepted; contract tests alone cannot be reported as end-to-end completion.

## Implementation and validation record

Pending implementation.

## Second review

Pending after the two real end-to-end runs and final diff inspection.
