# Scheduled Automation Usability Repair

## Recall

### User requirements

- Add Scheduled Automations at Codex parity, owned by the left Dock.
- Decide and communicate whether scheduling belongs to Coding Agent, Mission, or Task.
- Use a detailed Goal and an independent Agent as the acceptance boundary so a simplified implementation is not delivered.
- Independently verify both usability and ease of use with real end-to-end interaction.
- Name the left-Dock menu exactly `Scheduled`.
- Provide a first-class Agent tool because users will usually request a schedule in natural language instead of opening the GUI.
- Deliver the GUI and Tool as parallel lines over one shared Automation source; neither line may be substituted for the other.
- Merge and deliver on the main worktree while preserving every parallel change.
- After the independent review found problems, repair them rather than stopping at the report.

### Acceptance criteria

- Automation remains a project-level durable object.
- The left-Dock label is exactly `Scheduled`; the management page remains `Scheduled automations`.
- Coding Chat always receives the canonical `schedule` Tool even when a caller attempts `tools.schedule=false`, subject to the user's real permission policy.
- Natural-language schedule requests stream a real `schedule` tool call that persists through `AutomationService`.
- Tool and GUI both expose the same create, list, update, pause, resume, run-now, history, and delete lifecycle without shell cron or a second scheduler.
- `standalone` creates a new visible Coding Assistant Session for every run.
- `heartbeat` continues the exact Session selected when the Automation is saved.
- No UI copy calls either behavior a Mission or Task.
- Model choice comes from the connected project provider catalog; no provider/model free-text pair remains.
- Reasoning effort comes from the selected model's declared variants; invalid variants are rejected at the backend boundary.
- Time zone uses a searchable IANA time-zone control sourced from the browser internationalization runtime.
- Local form errors do not present an unrelated list-reload Retry action.
- Successful run history exposes the canonical Session title and opens the exact Session in its owning directory and persisted Chat/Work experience.
- Chinese enabled-state copy distinguishes “已启用” from an actively running execution.
- A repository-owned Node/Playwright test drives isolated Vite and OpenCorvus instances through create, edit, pause, reload, resume, run, history, Session navigation, armed delete, heartbeat ownership, keyboard focus, and accessibility.
- Independent Agent review must return strict E2E PASS and an acceptable usability verdict.

### Hard constraints

- Preserve all unrelated dirty and untracked work. Never stash, reset, restore, delete, or broadly stage it.
- Do not stop, restart, refresh, or otherwise interfere with the user's running OpenCorvus/Overlay.
- Playwright must be started by Node, never Bun.
- Visual acceptance requires real screenshots that are opened and inspected.
- No legacy Cron source, compatibility alias, fallback, second active source, synthetic message, workflow gate, or host state machine.
- Reuse the existing Kobalte `SelectControl` and `ComboboxControl` primitives and the existing provider catalog rather than hand-building selectors.
- Specs remain under `specs/`; this record and both indexes are the only documentation owners for this repair.

### Read records and code

- `specs/records/2026-07/2026-07-26-codex-parity-scheduled-automations.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `packages/overlay/src/components/ScheduledAutomationsHost.tsx`
- `packages/overlay/src/components/ComposerModelSelector.tsx`
- `packages/overlay/src/components/ui/SelectControl.tsx`
- `packages/overlay/src/components/ui/ComboboxControl.tsx`
- `packages/overlay/src/services/llm.ts`
- `packages/overlay/src/services/config-load.ts`
- `packages/overlay/src/services/automation-recurrence.ts`
- `packages/overlay/src/services/automations.ts`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/components/App.tsx`
- `packages/opencorvus/src/scheduler/automation-service.ts`
- `packages/opencorvus/src/session/wake.ts`
- `packages/opencorvus/src/server/routes/experimental.ts`
- `packages/opencorvus/src/tool/schedule.ts`
- `packages/opencorvus/src/tool/global-tools.ts`
- `packages/opencorvus/src/tool/control-plane-tool-composition.ts`
- `packages/opencorvus/src/agent/tool-pool-data.ts`
- `packages/opencorvus/src/chat/session.ts`
- `packages/opencorvus/src/session/llm.ts`

### Repository-wide call-site inventory

| Surface                         | Current owner                                                                       | Decision                                                                                                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automation CRUD and run history | `AutomationService`, experimental routes, Overlay `automations.ts`                  | Keep one service and route family; enrich the run response with one canonical Session target.                                                                                                                               |
| Agent scheduling command        | `schedule.ts` → `AutomationService`                                                 | Keep the existing `schedule` identity; strengthen its natural-language guidance and full lifecycle instead of introducing another Tool or cron implementation.                                                              |
| Coding Chat Tool projection     | `tool-pool-data.ts`, `global-tools.ts`, `chat/session.ts`, `session/llm.ts`         | Keep the canonical Tool registry and add `schedule` to right-sidebar Chat required tools so caller-level `schedule:false` cannot silently remove the command path.                                                          |
| Standalone execution            | `AutomationService.executeJobWake` → `SessionWake.wake`                             | Keep; it already creates `Session.kind = "assistant"` when no Session ID is supplied.                                                                                                                                       |
| Heartbeat execution             | `AutomationService.executeJobWake` → `SessionWake.wake`                             | Keep; it already asserts and continues the exact persisted Session ID.                                                                                                                                                      |
| Provider/model catalog          | `config-load.ts`, `appStore.providerCatalog`, `llm.ts`, `ComposerModelSelector.tsx` | Reuse pure connected-model and model-variant catalog helpers; do not duplicate provider parsing.                                                                                                                            |
| Form selects                    | `SelectControl` and `ComboboxControl`                                               | Reuse; use Select for bounded choices and searchable Combobox for IANA time zones.                                                                                                                                          |
| Session navigation              | `selectChatWithUILifecycle`, `openMissionSession` in `main.tsx`                     | Add one Automation Session-target callback; mission-kind Sessions use the mission conversation path, assistant Sessions use the Coding Assistant path.                                                                      |
| Errors                          | `ScheduledAutomationsHost.error`                                                    | Replace the message-only source with one structured error value whose optional retry callback exists only for failed loads.                                                                                                 |
| Terminology                     | Automation locale keys in both locale files                                         | Replace Task wording with Session/Coding Chat wording and change Chinese Active to 已启用.                                                                                                                                  |
| Browser acceptance              | existing overflow and left-Dock fixtures plus temporary auditor script              | Add a repository-owned isolated-backend lifecycle test; use trusted Playwright clicks/keyboard and task-owned screenshots.                                                                                                  |
| Tool acceptance                 | `test/tool/schedule.test.ts`, Chat prompt/route tests                               | Materialize the Coding and Chat tool pools, stream a Chinese natural-language scheduling command into a real AI SDK tool call, persist through `AutomationService`, and prove the right-sidebar overlay retains `schedule`. |

### Independent Agent feedback

The independent read-only audit at mainline commit `59b5298a7b` returned `usable with issues` and no P0:

- P1: “Task” wording contradicts the persisted Session model.
- P2: provider, model ID, reasoning effort, and IANA time zone are free text.
- P2: a local validation error shows a Retry action that only reloads lists.
- P2: run history shows an opaque Session ID without navigation.
- P3: Chinese Active is translated as “运行中”.
- The isolated Vite/backend audit proved Dock discovery, keyboard open, Dialog accessibility, Escape focus return, validation, and real standalone creation.
- Strict lifecycle E2E stopped because the temporary test used an untrusted DOM `click()` for a Kobalte Select. That is a test-tool defect, not product evidence, and must be replaced by trusted Playwright interaction.

## Architecture decision

Automation is neither a Mission nor a Task. It is a project-level schedule:

- standalone run → new Coding Assistant Session;
- heartbeat run → exact saved Session;
- Task-delay rows remain internal scheduler implementation and are not listed as public Automations.

The UI and API expose that model directly. Run history replaces the duplicate
opaque `sessionId` scalar with one nullable canonical Session target containing
`id`, `title`, `directory`, immutable Session `kind`, and the persisted
right-sidebar `chat`/`work` experience when present.

The command path is not a third owner. Coding Chat's existing `schedule` Tool and
the left-Dock GUI are parallel interfaces over the same project-owned
`AutomationService` rows. The Tool converts relative dates using the prompt's
current date and local time zone into one anchored RFC 5545 recurrence, lists
before acting when an ID is unknown, and never creates shell cron, background
sleep, or Task records.

## Implementation plan

1. Add shared provider-catalog helpers for connected model options and model variants.
2. Replace Automation provider/model and reasoning free text with controlled mature Select primitives.
3. Add searchable IANA time-zone choices through the canonical Combobox primitive.
4. Validate the selected model and variant in `AutomationService.assertPublicInput`.
5. Replace run-history `sessionId` with a joined Session target and wire exact navigation through `App`/`main`.
6. Make error Retry availability factual and local-validation errors actionless.
7. Correct all English/Chinese Session and enabled-state wording.
8. Strengthen the existing `schedule` Tool description and right-sidebar Chat projection; add Coding/Chat pool, streamed natural-language tool-call, prompt-overlay, and route tests.
9. Update focused unit, route/OpenAPI, SDK, source-contract, and i18n tests.
10. Add and run the isolated real Vite/backend Node/Playwright lifecycle test, inspect every screenshot, and repair visual or functional defects it reveals.
11. Run type checks, SDK generation, API/docs checks, document-health tests, stage only task-owned hunks, commit with `dsw-33987`, push normally, and request independent Agent re-acceptance.

## Implemented root-cause repairs and evidence

- Standalone Automations now create the canonical right-sidebar Chat profile and
  heartbeat Automations preserve the exact right-sidebar Chat or Work identity.
- Run history joins and returns one canonical Session target, and navigation
  awaits the real conversation lifecycle instead of dropping its Promise.
- Provider/model, reasoning, and time zone use canonical controlled catalogs.
  The time-zone Combobox supplies an object label, disallows an empty
  selection, commits the canonical label through Kobalte context, and hides its
  list only through Kobalte's `data-closed` state.
- Kobalte `onCloseAutoFocus` owns focus restoration to the left-Dock
  `Scheduled` action.
- The Coding Chat Tool pool now requires `schedule`; a Chinese natural-language
  command streamed a real AI SDK `schedule` call and persisted the resulting
  project-owned Automation through `AutomationService`.
- Correcting any form field now clears a stale submit error immediately, so a
  repaired recurrence never remains paired with an obsolete red validation
  message. Saved reasoning effort is visible in the detail metadata instead of
  being hidden after creation.
- Public Session prompt routes continue to reject caller-authored
  `tools`/`extra`/`system`/`noReply` spoofing. Two stale route tests were
  corrected to assert the strict public schema, while a canonical prompt still
  proves that Chat injects the required `schedule` Tool.
- The Node-started headed Vite/Playwright lifecycle returned `strictE2E: PASS`
  with two real local streaming-provider executions and no unexpected browser
  errors. The test now asserts that the stale validation error disappears and
  that the saved `High` reasoning effort is visible. After the Work-conversation
  mainline landed, the same test was strengthened to create a real Work target,
  assert `session.experience = work` in run history, and verify that both
  left-Dock selection and history navigation preserve the visible Work surface.
- The first independent final audit returned FAIL after visually finding the
  stale validation error and hidden reasoning value. After root-cause repair,
  the same read-only Agent reran headed E2E and focused Tool/UI tests and
  returned PASS; it then independently reran all Coding route tests at
  `21 pass / 0 fail`.
- Visually inspected evidence:
  `00-left-dock-scheduled.png`, `01-left-dock-open.png`,
  `02-controlled-form.png`, `03-run-history-success.png`, and
  `04-heartbeat-session-target.png` under
  `specs/artifacts/2026-07-27-automation-usability/`.

## Verification commands

```text
bun test packages/opencorvus/test/scheduler/automation-service.test.ts
bun test packages/opencorvus/test/server/experimental-schedule-contract.test.ts packages/opencorvus/test/server/experimental-schedule-routes.test.ts
bun test packages/opencorvus/test/tool/schedule.test.ts packages/opencorvus/test/session/prompt-final-input.test.ts
bun test packages/opencorvus/test/server/coding-routes.test.ts
bun test packages/overlay/test/scheduled-automations.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/automation-lifecycle-browser.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/automation-list-overflow-browser.test.ts packages/overlay/test/browser/left-dock-compact-browser.test.ts
bun run --cwd packages/sdk/js build
bun run --cwd packages/opencorvus typecheck
bun run --cwd packages/overlay typecheck
bun run api:routes-check
bun run docs:check
bun run overlay:i18n-check
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
```
