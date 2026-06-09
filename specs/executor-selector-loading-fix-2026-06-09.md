# Executor Selector Loading Fix - 2026-06-09

## Symptom

The model selector below the composer can remain in a loading-looking disabled
state when a selected task's operator model context cannot be resolved.

## Evidence

Full-repo search for the affected contract:

- `packages/overlay/src/components/ExecutorSelector.tsx` owns the composer model
  selector UI and calls `getTaskOperatorModelContext`.
- `packages/overlay/src/services/config.ts` defines
  `getTaskOperatorModelContext` and `TaskOperatorModelContext`.
- `packages/opencorvus/src/task-api/index.ts` implements
  `getTaskOperatorModelContext`.
- `packages/opencorvus/src/server/routes/orchestrator.ts` exposes
  `/task/:taskID/operator-model-context`.
- Existing coverage:
  `packages/overlay/test/executor-selector-task-model-context.test.ts`,
  `packages/overlay/test/executor-selector-dualbar.test.ts`, and
  `packages/opencorvus/test/server/task-message-routes.test.ts`.

## Decision

Keep the task-scoped write source unchanged: when a task is selected, the
OpenCorvus model picker writes only the task root session overlay. Do not
fallback to project `/config`.

Split the UI states:

- Trigger remains usable so the user can inspect the reason.
- Model buttons remain disabled until the task operator context has a session.
- Loading, error, and missing-context states render distinct popover content.
- Error state has an explicit retry action that refetches the same backend
  context route.

## Verification

Add Playwright regression coverage for a failing
`/task/:taskID/operator-model-context` response, asserting that the chip no
longer remains "Loading", the popover exposes the backend error, and retry
re-renders the resolved task model.
