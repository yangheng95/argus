# Auto-Confirm Proposed Tasks (2026-06-23)

## Problem

The Run menu currently exposes `Confirm proposed tasks`, backed by
`experimental.confirm_proposed_tasks`. The field name and UI label mean
"ask before creating a supervisor-proposed follow-up task", while the requested
operator behavior is the inverse: proposed new tasks should be auto-confirmed
by default, and the menu checkbox should be checked by default.

Keeping the old field and only changing the label would create a semantic
split: the UI would say auto-confirm while the backend would still treat `true`
as "ask first". This change must replace the old semantic source instead of
adding a compatibility alias.

## Recall

Whole-repo call-point search before implementation:

```text
rg -n "confirm_proposed_tasks" -S
rg -n "propose_task|proposed task|follow-up task|titlebar.confirm_proposed_tasks" packages specs -S
```

Relevant call points:

| Surface                                                                | Decision                                                                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/config/config.ts`                             | Replace `confirm_proposed_tasks` with `auto_confirm_proposed_tasks`, default `true`, and document that `false` asks the user first. |
| `packages/opencorvus/src/orchestrator/tools.ts`                        | `propose_task` creates directly when `auto_confirm_proposed_tasks` is `true`; asks through `Question` only when it is `false`.      |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt`            | Update the tool contract so the orchestrator understands the positive auto-confirm policy.                                          |
| `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx`         | Rename the Run menu checkbox to the auto-confirm semantic and patch the new config key.                                             |
| `packages/overlay/src/i18n/*.json`                                     | Replace old confirmation labels with auto-confirm labels.                                                                           |
| `packages/opencorvus/test/**` and `packages/overlay/test/**`           | Pin the new default, explicit opt-out confirmation path, UI key, and checked state.                                                 |
| `packages/sdk/openapi.json` and `packages/sdk/js/src/gen/types.gen.ts` | Keep generated API schema/types aligned with the config schema.                                                                     |
| `specs/current/architecture/01-agents.md` and `13-agent-communication-matrix.md`   | Update architecture wording that previously required confirmation before task creation.                                             |

## Design

- The single config key is `experimental.auto_confirm_proposed_tasks`.
- Default is `true`; the Run menu checkbox is checked when the config value is
  `true`.
- Setting it to `false` opts into the existing `Question` confirmation dialog
  before a proposed follow-up task is created.
- The removed `experimental.confirm_proposed_tasks` key is not accepted as a
  compatibility alias. Config parsing remains strict.

## Acceptance

- No production or test references to `confirm_proposed_tasks` remain.
- Default config returns `experimental.auto_confirm_proposed_tasks === true`.
- `propose_task` creates a terminal follow-up task without a question by
  default.
- `propose_task` asks and respects decline only when
  `auto_confirm_proposed_tasks` is explicitly `false`.
- The Run menu label reads as auto-confirm semantics and the checkbox is
  checked by default from `/config`.

## Verification

- `bun test packages/opencorvus/test/config/config.test.ts packages/opencorvus/test/agent/core-prompt-hygiene.test.ts packages/overlay/test/titlebar-compaction-threshold.test.ts packages/overlay/test/titlebar-menubar-primitive.test.ts --timeout 30000`
  - Passed: 136 pass, 0 fail.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern propose_task --timeout 30000`
  - Passed: 3 pass, 0 fail.
- `bun run --cwd packages/overlay typecheck`
  - Passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-menubar.test.ts`
  - Passed: 5 pass, 0 fail.

## Visual QA

- `.scratch/titlebar-run-checkbox-menuitem-focus.png`: Run menu shows
  `Auto-confirm new tasks` checked by default and rendered as the Kobalte
  `menuitemcheckbox` primitive.
- `.scratch/titlebar-illegal-narrow-legal-frame.png`: illegal narrow viewport
  still renders the titlebar inside the legal frame instead of producing an
  invalid tiny panel.

## Self Review

- `rg -n "(^|[^A-Za-z0-9_])confirm_proposed_tasks([^A-Za-z0-9_]|$)" packages -S`
  and `rg -n "titlebar\.confirm_proposed_tasks|titlebar-confirm-proposed-tasks" packages -S`
  return no old-key production or test references; remaining old-key mentions
  are historical recall text in this note.
- A deliberately broad dirty-worktree run of `packages/opencorvus/test/orchestrator/tools.test.ts`
  exposed unrelated task/project ownership failures in current uncommitted
  work. Those failures are outside this auto-confirm migration and must not be
  mixed into this commit.
