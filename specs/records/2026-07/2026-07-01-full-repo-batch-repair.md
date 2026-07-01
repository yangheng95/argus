# Full Repo Batch Repair

## Recall

User request:

- "分批提交全仓修复".

Acceptance criteria:

- Preserve all existing dirty worktree changes unless a concrete root-cause
  investigation proves a local edit is wrong and the replacement is explicitly
  scoped.
- Split the repository repair into coherent batches, with each batch validated
  by targeted tests before commit.
- Run repository-level checks needed by the changed surfaces, including
  typecheck, API route check, docs check, spec health tests, and overlay
  internationalization checks.
- Push the resulting commits after verification succeeds.
- Keep task requirements, acceptance criteria, and hard constraints available
  after context compaction.

Hard constraints:

- No fallback, compatibility path, gate, hidden message, synthetic message, or
  state-machine patch may be added to make failures disappear.
- Do not use git reset or broad git restore. Do not overwrite unrelated dirty
  worktree changes.
- Do not create a new worktree without explicit user authorization.
- Do not restart, reload, refresh, stop, or kill OpenCorvus or overlay runtime
  processes without explicit user authorization.
- Every code change must have a targeted test or an existing targeted test that
  proves the modified behavior.
- Test timeouts must be interpreted as inactivity failures, not as proof of a
  code root cause without further evidence.

Read before implementation:

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-01-deleted-goal-conversation-phase-projection.md`

Whole-repository search and state evidence:

- `git status --short --branch`
- `git log --oneline --decorate -5`
- `git diff --stat`
- `git diff --name-only`
- `rg --files -g AGENTS.md -g "specs/**"`

Independent agent feedback:

- No sub-agent was spawned for this record. The active tool policy only permits
  spawning sub-agents when the user explicitly asks for sub-agents, delegation,
  or parallel agent work.

## Current Dirty Worktree Groups

| Group | Files | Initial handling |
| --- | --- | --- |
| Engine/session/task API | `packages/opencorvus/src/engine/**`, `src/session/message.ts`, `src/task-api/index.ts`, related tests, SDK OpenAPI output | Run focused server and engine tests first, then route/type checks. |
| Orchestrator/MCP/prompt | `src/mcp/index.ts`, `src/orchestrator/tools.ts`, orchestrator prompt and tests | Verify prompt hygiene, orchestrator tool tests, and MCP isolated tests. |
| Process/workbench | `src/shell/process-supervisor.ts`, `src/workbench/board.ts`, related tests | Verify shell and board tests. |
| Overlay | overlay components, events service, selected-task recovery, settings CSS, i18n, browser/unit tests | Run overlay unit/browser tests that changed plus i18n check. |
| Docs/specs/artifacts | `AGENTS.md`, `specs/**`, `specs/artifacts/tv2ainvest.md`, architecture HTML | Run historical docs link and document health tests. |

## Validation Plan

1. Run targeted changed-surface tests and record failures.
2. Repair only root causes backed by source and test evidence.
3. Re-run the failing targeted tests until clean.
4. Run cross-surface checks: `bun run api:routes-check`, `bun run docs:check`,
   `bun run typecheck`, and spec health tests.
5. Review `git diff` batch by batch before staging.
6. Commit coherent batches and push.

## Repair And Verification Log

Root causes repaired during the full-repo pass:

- Windows test reset deleted SQLite files while post-commit effects could still
  touch the database. The test fixture now waits for tracked post-commit
  effects to become idle and rebuilds the schema in place; product DB reset
  file deletion remains in the storage layer.
- Queue-loop completion re-entered the scheduler from an unobserved microtask,
  which let test cleanup race background dispatch. Completion is now tracked as
  a promise and exposed to test cleanup.
- Operator message wakes behind live tool ownership were queued as passive
  scheduler work. They now create an immediate root wake commitment while
  preserving existing live ownership.
- Persisted frontend-design resources with `source: "user"` were not classified
  as attachments by the design manifest.
- Generic retry feedback could overwrite a more precise terminal-error retry
  decision-log entry.
- Overlay skill-matrix available cells exposed add glyphs by default in compact
  views. Glyphs now appear on hover/focus/active combination while the hit area
  remains stable.
- Visual QA and Integrity consensus could still be submitted as monolithic final
  reports, which let conclusions drift away from the concrete checks, evidence,
  and active requirements they claimed to satisfy. Both review surfaces now use
  registration-first output tools: every coverage row, evidence row, finding,
  blocker, repair, reviewer report, and consensus claim cites registered check
  item IDs before the final accepted/verdict summary is submitted.

Verification already run and passed:

- `bun test packages/opencorvus/test/engine/queue.test.ts`
- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts`
- `bun test packages/opencorvus/test/build-agent/prompt-context.test.ts packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts packages/opencorvus/test/pipeline/decision-log.test.ts packages/opencorvus/test/visual-qa/agent.test.ts packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts`
- `bun test packages/opencorvus/test/fixture/db.test.ts packages/opencorvus/test/storage/db-effect.test.ts`
- `bun test packages/overlay/test/conversation-rendering-i18n.test.ts packages/overlay/test/events-refresh.test.ts packages/overlay/test/task-debug-info.test.ts`
- `node test/browser-runner.mjs test/browser/skill-mount-matrix-browser.test.ts`
  from `packages/overlay`, with screenshots reviewed at
  `.scratch/skill-mount-matrix-panel.png`,
  `.scratch/skill-mount-matrix-settings-panel.png`, and
  `.scratch/skill-settings-dialog-hover.png`.
- `node --input-type=module -e <Playwright file-url screenshot probe>` for
  `specs/current/architecture/17-agent-team-infrastructure.html`, with
  screenshots reviewed at `.scratch/agent-team-infrastructure-viewport.png` and
  `.scratch/agent-team-infrastructure-drawer-visible.png`. Full-page capture was
  rejected by Chromium, so the verification used viewport captures and an
  explicit drawer-state probe.
- `bun run api:routes-check`
- `bun run docs:check`
- `bun run overlay:i18n-check`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts packages/opencorvus/test/visual-qa/negative-fixtures.test.ts packages/opencorvus/test/visual-qa/agent.test.ts packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts packages/opencorvus/test/integrity/team-schema.test.ts packages/opencorvus/test/integrity/team-agent.test.ts packages/opencorvus/test/integrity/browser-preview-tool.test.ts packages/opencorvus/test/integrity/consensus-traceability.test.ts packages/opencorvus/test/integrity/severity-active-path.test.ts`
- `bun test packages/opencorvus/test/engine/workflow-integrity-step.test.ts`
- `bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts packages/opencorvus/test/agent/integrity-prompt-repository-baseline.test.ts packages/opencorvus/test/agent/orchestrator-stale-recovery-prompt.test.ts`
- `bun run --cwd packages/sdk/js build`
- `bun run typecheck`
- `git diff --check`
