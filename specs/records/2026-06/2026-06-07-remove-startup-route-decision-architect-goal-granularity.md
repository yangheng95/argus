# Remove startup route decision and tune Architect goal granularity

## Request

- Remove the startup workflow/build selection dialog.
- Update the Architect prompt so it decomposes goals as much as practical, generally 5-30 goals unless the user asks otherwise.

## Call-point inventory

### Startup route decision

Full-repo targeted search:

- `packages/overlay/src/services/task.ts`
  - `resolveTaskKindDecision` is the only task-kind route chooser.
  - `createTask` is the only caller.
- `packages/overlay/test/task-init-git-retry.test.ts`
  - Mocks `task-route-decision` and asserts the dialog appears.
  - Tests route-selected workflow and build outcomes.
- `packages/overlay/test/app-dialog-timeout.test.ts`
  - Uses `task-route-decision` only as countdown-dialog coverage.
- `packages/overlay/src/components/AppDialogHost.tsx`
  - Renders `task-route-decision` and `task-queue-decision` as decision cards.
- `packages/overlay/src/services/app-dialog.ts`
  - Settles `task-route-decision` and `task-queue-decision` as decision cards.
- `packages/overlay/src/i18n/en-US.json`
  - Contains `task.route_decision.*` strings for the removed dialog.
- `packages/overlay/src/i18n/zh-CN.json`
  - Contains `task.route_decision.*` strings for the removed dialog.

Plan:

- Make missing `CreateTaskOptions.kind` resolve directly to `"workflow"`.
- Preserve explicit caller-provided `"build"` so existing direct-build APIs still work.
- Remove route-decision-specific UI and i18n strings because no call point remains.
- Keep queue decision unchanged.

### Architect prompt

Full-repo targeted search:

- `packages/opencorvus/src/prompt/core/architect-core.txt` is the active prompt body.
- `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts` already asserts Architect prompt invariants.

Plan:

- Replace the current smallest-graph bias with a high-granularity decomposition bias:
  - maximize useful decomposition while keeping goals executable and independently verifiable;
  - default range 5-30 goals;
  - user-specific goal count overrides the default;
  - small/trivial tasks may still use the structural minimum only when 5 goals would be fake slicing.
- Add a prompt hygiene assertion for the new 5-30 guidance.

## Verification

- Run focused overlay tests for task creation and dialog countdown.
- Run focused opencorvus prompt hygiene test.
