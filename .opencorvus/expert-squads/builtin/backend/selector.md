# Backend Selector

Use `select_expert_squad` with `profile_id` `backend` when the user's request depends on backend API behavior, state transitions, schema ownership, storage semantics, permission checks, error responses, integration contracts, or operational runtime behavior.

## Activation Criteria

Select this expert squad when the task includes any of these surfaces:

1. Routes, RPC handlers, CLI commands, event consumers, queues, workers, storage records, migrations or reset scripts, configuration keys, provider integrations, or service boundaries.
2. Request, response, database, cache, file, event, OpenAPI, SDK, or error schema changes that need one source of truth.
3. State transitions involving creation, update, cancellation, deletion, idempotency, locking, concurrency, retries, rollbacks, cleanup, or audit evidence.
4. Security, permission, input validation, resource ownership, rate or size limits, and observable error taxonomy.
5. Runtime or integration proof beyond isolated helper tests.

Do not select this squad just because a task uses TypeScript or touches a server-side file if the acceptance is primarily frontend visual design, algorithm proof, or test-protocol authoring.

## Expert Contract

An expert backend result must prove the real runtime contract:

1. Contract boundary: name the route, command, event, queue, storage record, configuration key, or integration endpoint whose behavior changes.
2. Schema ownership: identify the single source of truth for request, response, persistence, validation, and error mapping; remove or update parallel branches touched by the change.
3. State transition model: describe accepted inputs, state before and after, side effects, idempotency, concurrency assumptions, and rollback or cleanup behavior.
4. Failure semantics: cover rejected inputs, permission or authentication cases, missing resources, conflict cases, rate or size limits, and observable error names or status codes where applicable.
5. Integration path: prove the caller, service, storage, and downstream path that observes the behavior.
6. Verification proof: include positive tests, negative tests, and runtime or integration evidence that exercises the owning path.
7. Acceptance proof: tie the changed contract, state effects, failure semantics, and tests to the user's requested behavior.

Do not accept backend work that only compiles, only tests a helper, leaves a second schema or storage interpretation, hides migration implications, skips permission or negative behavior, or cannot prove the real route or integration path.

## Orchestrator Protocol

After selecting this squad, preserve the visible protocol:

1. Keep `prompt_profile.active` as the only active expert-squad source.
2. Dispatch only existing OpenCorvus workflow roles projected by this package.
3. Carry the backend contract boundary, schema owner, state transition model, failure semantics, and integration proof through Requirements, Architect, Build, and Integrity.
4. If evidence shows the task is not backend-contract work, say so and choose a more appropriate visible expert squad instead of stretching this profile.
