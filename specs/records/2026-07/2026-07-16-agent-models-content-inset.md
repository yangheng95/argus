# Agent Models Content Inset

## Recall

### User request

- The Agent Models error notice must not touch the surrounding bordered surface; add visible spacing around it.
- The supplied screenshot shows the failed-load notice touching the left and right edges of the outer Settings group body.

### Acceptance criteria

- The Agent Models group uses the shared Settings content inset so error, loading, and populated states all remain separated from the outer group border.
- The inset is the existing `--settings-content-inset` value; no page-specific spacing constant or duplicate primitive is added.
- A focused source regression proves the Agent Models call point opts into the shared primitive contract.
- A Node-launched real browser fixture renders the failed-load state, asserts at least one shared inset between the outer border and the alert on every side, saves a task-scoped screenshot, and the screenshot is visually reviewed.
- Focused tests, Overlay typecheck, documentation health, diff review, commit, and legacy remote push complete.

### Hard constraints

- Desktop-only scope; no mobile, tablet, or responsive expansion.
- Reuse `SettingsPanel`, `SettingsGroup`, `SettingsRow`, the existing error notice, and the current Settings shell.
- Keep `SettingsGroup.contentInset` and `--settings-content-inset` as the single semantic and visual sources.
- Do not restart, refresh, close, or interfere with the user's running OpenCorvus/Overlay. Use the isolated Node browser fixture and task-scoped screenshot.
- Preserve all pre-existing and concurrently appearing worktree changes. Stage only this task's files and hunks; do not reset or create a worktree.
- Commit subjects start with `dsw-33987`; push the current branch to `legacy-remote`.

### Sources read

- `AGENTS.md`
- The supplied Agent Models failed-load screenshot.
- `specs/records/2026-07/2026-07-16-settings-content-inset.md`
- `specs/README.md` and `specs/records/2026-07/README.md`
- `packages/overlay/src/components/settings/AgentModelsPanel.tsx`
- `packages/overlay/src/components/settings/primitives.tsx`
- `packages/overlay/src/styles/surfaces/settings.css`
- `packages/overlay/test/settings-content-inset.test.ts`
- `packages/overlay/test/browser/agent-models-panel.test.ts`
- `packages/overlay/test/browser/config-dialog-resizer.test.ts`

### Whole-repository search evidence

| Call point / surface | Audit decision |
| --- | --- |
| `AgentModelsPanel` sole `SettingsGroup` call | Add `contentInset`; all loading, error, session-error, project-default, and model-table children are custom direct body content rather than a simple row-only group. |
| `.agent-models-error` | Keep its existing alert padding and semantic styling; do not add a parallel margin rule because the owning group already has a shared inset capability. |
| `.agent-models-loading` | Keep its existing loading layout; the group inset also prevents the spinner/copy from touching the border. |
| `.agent-model-project-default` and `.agent-model-table` | Keep their existing row/table inner spacing; the group inset separates these nested surfaces from the outer group border and does not alter row content padding. |
| `SettingsGroup.contentInset` consumers in Channels and Skill Market | Keep unchanged; they establish the existing primitive contract reused here. |
| `settings-content-inset.test.ts` | Extend the shared call-point regression to include Agent Models rather than creating a second source-only test file. |
| `agent-models-panel.test.ts` | Add a failed-load browser case that exercises the real Config dialog, measures border-to-alert gaps, and captures the affected region. |
| All `.s-group-body` style definitions | Keep unchanged; the shared `[data-content-inset="true"]` selector already owns the required padding. |

### Independent agent feedback

- None. The user did not request sub-agents; repository instructions prohibit unsolicited delegation for this task.

### Git baseline

- Current branch: `work-v0.0.6beta-yr-0716`.
- Baseline checkpoint commit: `2078f4735` (`dsw-33987 checkpoint agent models inset`).
- Pre-existing and concurrent uncommitted files were enumerated before implementation and remain outside this task's staging boundary.

## Root cause

The Agent Models panel mounts every state directly inside the bordered `.s-group-body`, but unlike other audited custom-body Settings groups it does not opt into `SettingsGroup.contentInset`. The error alert has vertical-only margin (`var(--ui-gap-md) 0`), so its left and right edges align with the outer border. The missing primitive opt-in—not the alert's internal padding—is the root cause.

## Implementation plan

1. Opt the sole Agent Models `SettingsGroup` into the existing `contentInset` contract.
2. Extend focused source coverage so the call point cannot silently lose the shared inset.
3. Add a real failed-load browser fixture that measures four-sided geometry and captures the Agent Models group.
4. Run focused tests, Overlay typecheck, documentation health, inspect the screenshot at original resolution, review the diff, commit only task-owned files, and push to legacy remote.

## Codex review feedback

- The first complete Agent Models browser-file run exposed a stale Chinese-locale tier assertion. The authoritative `zh-CN.json` value has been `Primary Assistant` since commit `fcf60132dc` on 2026-07-12, while the browser test still expected the retired `核心 — 主要编码 Agent` copy. The test expectation is updated to the current locale source; no production locale behavior is changed.
- The first failed-load fixture correctly rendered and captured the inset, but the browser-wide error collector rejected the fixture's intentional `/agent` 503 response during teardown. The fixture now uses the existing collector option to allow only status 503 on exactly `/agent`; every other failed response and browser error remains a failure.

## Verification

- `bun test packages/overlay/test/settings-content-inset.test.ts` — 6 passed, 0 failed.
- `bun run --cwd packages/overlay typecheck` — passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/agent-models-panel.test.ts` — 3 passed, 0 failed after a fresh production Vite build. The suite covers populated selection, loading motion/reduced motion, and the failed-load inset state.
- The failed-load geometry assertion proved `data-content-inset="true"`, a computed shared inset of at least 16px, and border-to-alert gaps at least that large on the left, right, top, and bottom.
- `.scratch/agent-models-error-content-inset.png` was inspected at original resolution. The error notice no longer touches the outer group border; the four-sided whitespace is clear and balanced, with no new clipping or overflow.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` — 21 passed, 0 failed.
- `bun test packages/opencorvus/test/script/document-health.test.ts` — 53 passed, 0 failed in the task-owned index view. The first combined worktree run found a concurrent untracked PTY record already linked by another task; that unrelated link was temporarily excluded for the isolated rerun and then restored unchanged.
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts` — 4 passed, 0 failed.
- `git diff --check` and `git diff --cached --check` — passed before final commit.
