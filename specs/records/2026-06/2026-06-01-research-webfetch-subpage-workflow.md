# Research Webfetch And Subpage Workflow - 2026-06-01

## Context

The operator requested that the research agent encode the investigation pattern
used for TradingView Economy research:

- Start from the specified webpage.
- Prefer `webfetch` over search because search APIs have cost.
- If the initial page exposes meaningful child pages, return child-page research
  work for the orchestrator to arrange in parallel.

## Decision

Research remains an advisory side-tool, not a built-in engine workflow step.
This keeps the existing prompt-over-host boundary: the orchestrator decides when
to invoke research and how to use its evidence.

The research agent now follows a webpage-led workflow:

1. If the task provides Source URLs, fetch those exact pages first.
2. Build a source map from fetched-page navigation and links.
3. Fetch only child pages needed for the current focus.
4. Emit `subpage_research_tasks` for independent child pages that need deeper
   study.
5. Prefer `webfetch`; avoid `websearch` in the normal research runtime.

`subpage_research_tasks` are advisory evidence work candidates. They are not
next-tool commands, requirements, goals, or acceptance specs.

## Schema Surface

`research_brief` gains:

```ts
subpage_research_tasks: Array<{
  id: string
  parent_url: string
  url: string
  title: string
  reason: string
  suggested_focus: string
  priority: "high" | "medium" | "low"
  evidence_ids: string[]
}>
```

Each task's `evidence_ids` must reference known `evidence_index` entries. This
keeps child-page discovery traceable to fetched evidence.

## Non-Goals

- Do not add `research` to `engine/workflow.ts`.
- Do not let research call other agents.
- Do not make subpage tasks mandatory routing instructions.
- Do not reintroduce a broad search-first research loop.
