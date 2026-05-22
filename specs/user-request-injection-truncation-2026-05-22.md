# User Request Injection Truncation — 2026-05-22

## Requirement

If the original task request is a very large PRD, prompt injection into orchestrator
and sub-agents must not carry the full request. Inject at most 500 words, and tell
the model to search the full request in `.opencorvus/intent/request.md`.

The full request remains persisted by `IntentBundle.write`; this change only bounds
prompt injection.

## Existing Records Reviewed

- `CLAUDE.md`
- `artifacts/2026-05-18-decision-log-disk-materialization.md`
- `packages/opencorvus/src/intent/bundle.ts`
- `packages/opencorvus/src/prompt/upstream-context.ts`

## Call Points

- Worker prompt builders:
  - `intent-analysis/agent.ts`
  - `requirements/agent.ts`
  - `design-analyst/agent.ts`
  - `architect/agent.ts`
  - `integrity/agent.ts`
  - `prosecutor/agent.ts`
  - `build/agent.ts` direct request path
- Shared worker system context:
  - `task-context/index.ts`
- Orchestrator direct prompt/context:
  - `orchestrator/agent.ts::orchestratorUserText`
  - `engine/describe.ts::renderTaskDescription`
  - `orchestrator/tools.ts` explore and refine direct prompts

## Design

Add one shared prompt renderer for request excerpts. It:

- counts with a deterministic Unicode word tokenizer;
- emits only the first 500 words;
- always points at `.opencorvus/intent/request.md` and tells the model to grep/read
  the file for exact PRD sections;
- does not change `IntentBundle.write`, so the complete request still exists on disk.

No fallback/compatibility path is added. Old ad hoc character slices are replaced at
prompt injection points.

## Tests

- Unit test the renderer for 500-word truncation and request bundle hint.
- Update prompt assembly tests to prove agent prompts do not contain word 501 and do
  contain `.opencorvus/intent/request.md`.
- Update orchestrator wake test because a no-event wake now injects the bounded
  request section instead of the raw request string.
