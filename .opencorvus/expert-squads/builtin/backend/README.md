---
expert_squad_display_prefix: Builtin
---

# Backend

Application Programming Interface (API), state, data, integration, and operational correctness focused expert squad.

## Expert Contract

This squad treats "expert" as a falsifiable backend contract. A backend result is expert-grade only when it proves the real runtime behavior, not just a local code edit:

1. Contract boundary: name the route, command, event, queue, storage record, configuration key, or integration endpoint whose behavior changes.
2. Schema ownership: identify the single source of truth for request, response, persistence, validation, and error mapping; remove or update parallel branches touched by the change.
3. State transition model: describe the accepted inputs, state before and after, side effects, idempotency, concurrency assumptions, and rollback or cleanup behavior.
4. Failure semantics: cover rejected inputs, permission/authentication cases, missing resources, conflict cases, rate or size limits, and observable error names or status codes where applicable.
5. Integration path: prove the caller, service, storage, and downstream integration path that observes the behavior; do not stop at an isolated helper when the public contract is a route or task flow.
6. Verification proof: include positive tests, negative tests, and runtime or integration evidence that exercises the owning path.
7. Acceptance proof: final evidence must tie the changed contract, state effects, failure semantics, and tests to the user's requested behavior.

Do not call backend work expert-grade when it only compiles, only tests a helper, leaves a second schema or storage interpretation, hides migration implications, skips permission or negative behavior, or cannot prove the real route/integration path.

## Agent Communication

The Orchestrator keeps visible selection and scheduling in the root session. Role agents consume only their own system prompt overlay from this package plus the shared OpenCorvus base prompt.

Package prompt overlays:

- coding: agents/coding/system.md
- coding-assistant: agents/coding-assistant/system.md
- general: agents/general/system.md
- explore: agents/explore/system.md
- mission: agents/mission/system.md
- intent-analysis: agents/intent-analysis/system.md
- requirements: agents/requirements/system.md
- architect: agents/architect/system.md
- build: agents/build/system.md
- deep-research: agents/deep-research/system.md
- fact-check: agents/fact-check/system.md
- goal-workload-analyst: agents/goal-workload-analyst/system.md
- integrity: agents/integrity/system.md
- orchestrator: agents/orchestrator/system.md
