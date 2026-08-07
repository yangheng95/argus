# Mission Directive Syntax

## Recall

### User request

- Change the visible Mission Skill invocation from `@mission-skill(...)` to `@mission(...)`.
- Preserve the earlier Settings naming convergence: Mission Card remains under Agent Squad and internal Mission Skill resources remain Mission Skills.

### Acceptance

- Composer discovery, filtering, insertion, atomic editing, validation, placeholders, Settings copy actions, Mission prompt policy, and bundled Mission Skill instructions expose only `@mission("<exact-name>")`.
- `@mission-skill(...)` is not accepted as a compatibility alias.
- The internal catalog kind, route, storage directory, tool ID, and SDK (Software Development Kit) contracts remain `mission-skill` / `mission_skill`.
- Focused unit and browser tests cover the new syntax and explicitly prove that the retired syntax is not parsed.
- A real Vite page is opened and visually inspected with a task-scoped screenshot.

### Hard constraints

- Preserve all unrelated dirty-worktree changes and stage only task-owned hunks.
- Do not restart or manipulate the user's running OpenCorvus or overlay process.
- Do not add fallback, alias, dual-source, state-machine, or host gate behavior.
- Use Node-driven browser tooling for visual verification.

### Read records and current architecture

- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-23-mission-skill-orchestration-implementation.md`
- `specs/records/2026-07/2026-07-23-mission-skill-orchestration-surface.md`
- Repository `AGENTS.md`

### Exhaustive repository search

`rg -n '@mission-skill|@mission\(' packages/overlay packages/opencorvus specs/current`
found the following live owners:

| Surface | Decision |
| --- | --- |
| `packages/overlay/src/services/composer-mention.ts` | Add one user-syntax mapping from the internal `mission-skill` kind to `mission`; use it for query matching, insertion, search, and exact directive parsing. |
| `packages/overlay/src/components/settings/MissionSkillPanel.tsx` | Copy `@mission(...)`. |
| `packages/overlay/src/i18n/{en-US,zh-CN}.json` | Advertise `@mission`. |
| `packages/opencorvus/src/session/system.ts` | Tell native Mission turns that the mandatory visible directive is `@mission(...)`. |
| `packages/opencorvus/src/prompt/core/mission-core.txt` | Use the same visible operator contract. |
| `packages/opencorvus/src/mission-skill/builtin/**` | Update bundled author instructions and regenerate the single payload. |
| Overlay and OpenCorvus unit/browser tests | Replace expected syntax and add retired-syntax rejection evidence. |
| `specs/current/architecture/04-extensions.md` | Record the new public syntax while retaining internal Mission Skill terminology. |

The search found no existing `@mission(...)` directive, so the replacement has no public-syntax collision. Historical implementation records remain immutable descriptions of their delivery-time contract; this record and current architecture are the authoritative current state.

## Design

`ComposerMentionKind` continues to model resource identity (`skill`, `mission-skill`, `squad`). A single
`COMPOSER_MENTION_SYNTAX` projection maps those identities to public syntax (`skill`, `mission`, `squad`).
All user-text parsing and rendering consumes that projection, while catalog selection and submission continue
to return `missionSkillNames`. This keeps storage/runtime identity separate from the operator-facing command
without adding an alias.

## Verification

- `bun test packages/overlay/test/composer-mention.test.ts packages/overlay/test/mission-skill-settings-surface.test.ts`
- `bun test packages/opencorvus/test/session/system-skill-directive.test.ts`
- Relevant overlay browser test(s), run with Node-backed browser execution.
- Overlay and OpenCorvus type checks.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Real Vite screenshot of Composer discovery/insertion showing `@mission`.

## Verification result

- Focused Overlay and OpenCorvus tests, both type checks, i18n validation, generated-payload freshness, and historical-document health passed.
- The real Vite page exposed `@mission` in the reference menu and accepted the exact visible text
  `@mission("mirror-prism-cluster")`; screenshots are stored under
  `.scratch/mission-directive-syntax/`.
- The existing long-chain Composer browser scenario reached and passed the updated placeholder/menu syntax assertion,
  then intermittently timed out while opening the unrelated Mission Squad hover submenu. `ChatComposer.tsx` was unchanged
  by this task, and the task-scoped Vite interaction independently verified the changed surface.
