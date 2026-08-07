# Intent Analysis Dynamic Follow-Up Questions (2026-06-23)

## Problem

`analyze_intent` can identify blocker clarifications, but the current contract
only records plain question text. It does not carry selectable examples,
free-form-answer intent, or a clarified request artifact after the user answers.
That leaves the workflow dependent on the orchestrator manually translating a
plain-text clarification into the `question` tool schema.

## Call-Point Inventory

Whole-repo grep before implementation:

```text
rg -n "analyze_intent|IntentAnalysisAgent|IntentClarification|ask_clarification|Question\\.Info|Question\\.askAndFormat|renderUserRequestSection|intent_blocker_clarifications|task\\.request" packages/opencorvus/src packages/opencorvus/test specs -S
```

Relevant call points:

| Surface                                                                | Decision                                                                                                                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/opencorvus/src/intent-analysis/types.ts`                     | Extend `IntentClarification` so the agent can describe the same interaction shape the question UI already supports.                                                                  |
| `packages/opencorvus/src/intent-analysis/output-tools.ts`              | Extend `ask_clarification` schema and collector without adding fallback defaults.                                                                                                    |
| `packages/opencorvus/src/prompt/core/intent-analysis-core.txt`         | Tell the agent to provide concrete options and custom-answer semantics when a blocker needs user input.                                                                              |
| `packages/opencorvus/src/orchestrator/tools.ts`                        | Keep `analyze_intent` as the orchestrator-owned entry; when blocker clarifications exist, ask the user through `Question.askAndFormat`, then return and persist a clarified request. |
| `packages/opencorvus/src/question/index.ts`                            | Reuse existing `Question.Info` schema and unified interaction UI; no new question UI or route.                                                                                       |
| `packages/opencorvus/src/task-context/index.ts` / `engine/describe.ts` | Downstream agents already read decision-log entries in task context. Persist clarified request there instead of overwriting `task.request`.                                          |
| `packages/opencorvus/test/intent-analysis/*`                           | Add focused contract tests for rich clarification schema and clarified request rendering.                                                                                            |

## Design

- Preserve `engine_task.request` and `intent/request.md` as the original user
  request audit source.
- Extend intent-analysis clarification output with:
  - `header`
  - `options[]`
  - `multiple`
  - `custom`
- Map blocker clarifications directly to `Question.Info`.
- After answers arrive, build a deterministic clarified request:
  original request plus a `Clarifying answers` section containing each question
  and verbatim answer labels/free-form text.
- Persist that clarified request in decision log key
  `intent_clarified_user_request` and return it in the `analyze_intent` tool
  result fields.

## Acceptance

- Intent-analysis output schema supports choice options and free-form answers.
- `analyze_intent` asks blocker follow-up questions through the existing
  `Question` interaction path.
- The tool result exposes `clarified_user_request`.
- Downstream agents can read the clarified request from task context decision
  logs.
- No replacement of the original request, no hidden synthetic messages, no
  second question UI, and no fallback/default clarified request when the user
  does not answer.
