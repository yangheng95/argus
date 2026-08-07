# README Agent Harness Positioning

## Recall

| Item                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request               | Rewrite the root README files, remove the current first image from the document, replace it with a more important visual, and optimize the promotional positioning around an open Agent Harness platform that lets people build a dedicated always-on assistant.                                                                                                                                                |
| Acceptance                 | Both English and Simplified Chinese READMEs lead with one clear product promise, use the Agent Team delivery visual as the first image, explain the open Harness value before implementation detail, retain truthful setup and current-surface documentation, and remain structurally aligned.                                                                                                                  |
| Hard constraints           | Do not claim execution continues after the owning runtime is offline. Do not imply arbitrary integrations are automatically safe. Preserve Mission, Task, Expert Squad, evidence, Artifact, Code/Work, and fixed-profile ownership contracts. Do not add or run UI automated tests. Preserve unrelated worktree changes. Commit subjects use `dsw-33987` and delivery pushes to `git-cc`.                       |
| Sources read               | Root `README.md` and `README.zh-CN.md`; `specs/current/architecture/17-code-work-agent-platform.md`; current documentation references for Mission, Expert Squad, Chat, Work, and Harness ownership; the three tracked README images.                                                                                                                                                                            |
| Whole-repository grep      | Root READMEs are the only live references to `assets/readme-head.png`; `agent-teams-workflow.png` and `heterogeneous-algorithm-foundry.png` already explain the two core product stories. The current architecture keeps Chat and Work as distinct primary-assistant harnesses, Mission as durable coordination, Task as the fixed Expert Squad boundary, and reviewed Artifact evidence as delivery authority. |
| Independent agent feedback | Not requested by the user. The task is a bounded documentation rewrite and does not authorize sub-agent delegation.                                                                                                                                                                                                                                                                                             |

### 2026-08-07 repositioning recall

| Item                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request               | Rewrite and reorganize the product README so customization, long-horizon execution, and collaboration among Expert Squads are the primary selling points.                                                                                                                                                                                                                                                                 |
| Acceptance                 | The English and Simplified Chinese openings state the three-part promise before implementation detail; the main narrative explains what is customized, how long-running work preserves continuity, and how multiple fixed-profile Expert Squads collaborate across one Mission; verified setup and limitation text remain truthful.                                                                                       |
| Hard constraints           | Preserve the user's current uncommitted move of `assets/heterogeneous-algorithm-foundry.png` to the English opening. Do not claim execution while the runtime is offline. Do not describe Expert Squads as sharing hidden context or changing identity inside a Task: cross-squad cooperation happens through Mission-owned Task stages and accepted Artifact evidence. Do not add or run User Interface automated tests. |
| Sources read               | The current working-tree versions of `README.md` and `README.zh-CN.md`; this existing positioning record; `specs/current/architecture/17-code-work-agent-platform.md`; current architecture references found by repository search for Mission, Expert Squad, customization, long-running work, and collaboration.                                                                                                         |
| Whole-repository grep      | The current public narrative already contains all three concepts, but spreads them across generic assistant prose, a capability table, and a seven-step execution section. Current architecture confirms Mission as the cross-domain coordination owner, Task as the immutable fixed-squad boundary, and accepted Artifact evidence as the handoff contract.                                                              |
| Independent agent feedback | Not requested by the user. Repository instructions disallow delegation unless the user explicitly requests it.                                                                                                                                                                                                                                                                                                            |

The revised hierarchy is therefore one product promise and three product pillars:

1. **Customize the organization** from self-contained Expert Squads, models,
   Skills, tools, Model Context Protocol servers, and deterministic algorithms.
2. **Keep long-horizon work coherent** through durable Missions, Tasks, accepted
   evidence, resumable execution, and visible blockers.
3. **Let Expert Squads collaborate without blurring accountability**: each Task
   retains one squad and workflow, while Mission moves typed Artifact evidence
   across research, planning, building, and review stages.

## Positioning decision

OpenCorvus will be introduced as an open Agent Harness platform for building a
dedicated, always-on assistant. The promise is not a generic chatbot or a graph
builder: the user states an outcome, OpenCorvus assembles the right specialist
team, preserves long-running context, connects compatible capabilities, and
delivers reviewable evidence.

The first visual changes from the legacy logo banner to
`assets/agent-teams-workflow.png` because it communicates the primary user value:
one assistant can route Code, Research, Office, and Business work to specialized
Agent Teams and reunite it as one reviewed delivery. The heterogeneous capability
foundry remains the second explanatory visual for the platform integration story.

## Implementation

1. Replace the opening of both root READMEs with aligned Agent Harness positioning,
   a concise product promise, the higher-value Agent Team visual, and direct calls
   to action.
2. Reorder and rewrite the product story around dedicated assistant, open Harness,
   always-on execution, specialist teams, durable context, and evidence-backed
   delivery.
3. Keep the verified installation, Quick Start, endpoint, channel, executor,
   development, and limitation details, but reduce repeated architecture prose.
4. Review both rendered Markdown documents, validate links and documentation
   health, inspect the final diff, commit, and push to `git-cc`.

## Validation

- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Product-document single-source and document-health tests because public product
  documentation changes.
- Markdown formatting and `git diff --check`.
- Manual rendered-content review of both language variants and both explanatory
  images; this is documentation review, not a persisted UI automated test.

## Completion evidence

- Rewrote `README.md` and `README.zh-CN.md` around the aligned promise “Build
  your dedicated, always-on assistant” / “定制你的专属全天候助手” and the open
  Agent Harness positioning.
- Removed `assets/readme-head.png` from both document openings. The first visual
  is now `assets/agent-teams-workflow.png`; manual inspection confirmed that it
  directly explains one assistant routing Code, Research, Office, and Business
  work into one reviewed delivery. The capability-foundry image remains the
  second visual and explains the integration contract.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts
--timeout 120000` reported that the historical path no longer matches a test
  file. A repository-wide exact filename search also found no current
  `historical-docs-links`, `product-docs-single-source`, or `document-health`
  test. No retired test path was recreated.
- The current authoritative documentation command, `bun run docs:check`, passed
  with 318 operations across 25 groups.
- `bunx prettier --check README.md README.zh-CN.md
specs/records/2026-08/2026-08-07-readme-agent-harness-positioning.md` passed.
- A read-only local-link and image scan resolved every relative target in both
  READMEs. `git ls-remote origin` confirmed the configured GitHub repository is
  reachable with repository credentials. Anonymous Hypertext Transfer Protocol
  checks cannot validate that private repository URL; the same clone URL was
  already the repository's canonical source-install path.
- PowerShell Markdown rendering plus direct source review confirmed the aligned
  heading order, callouts, tables, code blocks, local links, and bilingual
  content flow. Both tracked explanatory images were inspected directly.
- `git diff --check` passed. No User Interface automated test was added,
  modified, or run.

### 2026-08-07 repositioning completion evidence

- Reorganized both public READMEs around one explicit promise: build a custom AI
  organization whose Expert Squads can carry a long-horizon Mission to reviewed
  delivery.
- Made customization, long-horizon continuity, and cross-squad collaboration the
  first three product sections rather than secondary details beneath a generic
  assistant capability list.
- Replaced the single-capability examples with collaboration chains showing how
  research, domain, build, office, testing, and review specialists contribute to
  one accountable outcome.
- Preserved the user's working-tree decision to lead with the heterogeneous
  capability foundry image, and placed the Agent Team visual beside the
  cross-squad collaboration story.
- Kept the runtime-online limitation visible and retained fixed Expert Squad
  ownership per Task, Mission-owned cross-stage coordination, and accepted typed
  Artifact handoffs.
- `bunx prettier --check README.md README.zh-CN.md
specs/records/2026-08/2026-08-07-readme-agent-harness-positioning.md` passed.
- `bun run docs:check` passed with 323 operations across 25 groups.
- No User Interface automated test was added, modified, or run.
