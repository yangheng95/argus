# Codex Rework Plan

Date: 2026-05-15

Scope:
- Rewrite `docs/whitepaper/opencorvus-whitepaper.html`.
- Rewrite `docs/reports/weekly-2026-w20.html`.
- Preserve and use `docs/whitepaper/assets/agent-comparison.png`, `orchestration-framework.png`, and `opencorvus-goal-design.png`.

Tone:
- Serious engineering narrative.
- No daily-life analogies, no personification, no decorative lede labels, no marketing hero copy, no meta-process references.

Verified repository facts to use:
- Orchestrator tools: 21 tool calls in `packages/opencorvus/src/orchestrator/tools.ts`.
- Real tool names include `requirements`, `design_analysis`, `architect`, `integrity`, `prosecute`, `analyze_intent`, `modify_goal`, `query_failed_goals`, `read_context`, `fail_task`, `cancel_task`, `retry_task`, `inject_operator_message`, `steer_subagent`, `restart_from_stage`, `deliver`, `publish_delivery`, `refine`, `question`, `propose_task`, `build`.
- Acceptance spec field is `scorers: ScorerSchema[]` with `.min(1)` in `packages/opencorvus/src/acceptance/types.ts`.
- SQLite schema contains 44 `CREATE TABLE` / `CREATE VIRTUAL TABLE` statements in `packages/opencorvus/src/storage/ddl.ts`.
- `memory_embedding` is a separate table keyed by `chunk_id`; it is not a field on `memory_file`.
- Contract IR enum variants are objects with required `value` and `meaning` fields in `packages/opencorvus/src/architect/contract-ir.ts`.
- Architect goal minimum is runtime validation through `MIN_ARCHITECT_GOAL_COUNT = 2` and an agent error when fewer than two goals are finalized.
- `SessionKind` has 15 values: root, orchestrator, assistant, gateway, intent-analysis, requirements, design-analyst, goal, architect, integrity, delivery, executor, build, evaluator, system.
- Nine outward agent entry files exist: intent-analysis, requirements, design-analyst, architect, build, integrity, delivery, prosecutor, orchestrator.
- Nine core prompt files exist in `packages/opencorvus/src/prompt/core`.
- Channel runtime has 15 adapter files: dingtalk, discord, feishu, googlechat, http, line, matrix, mattermost, msteams, qq, signal, slack, telegram, wecom, whatsapp.
- Overlay has 76 `.tsx` files and 177 `.ts` + `.tsx` files under `packages/overlay/src`.
- Executor implementation is `packages/opencorvus/src/executor/opencorvus.ts`; `packages/opencorvus/src/executor/opencode.ts` does not exist.
- `OpencodeExecutor` has no matches in source/target docs outside the handoff file.
- Executor enum is `opencorvus | codex | claude-code`.
- Scheduler class/namespace is `TaskQueueService` in `packages/opencorvus/src/scheduler/task-queue-service.ts`.
- Current full repository commit count is 12515; current `packages/opencorvus` commit count is 1507.
- Current W20 count for `packages/opencorvus`, `packages/overlay`, `packages/channel-runtime`, and `docs` is 196 commits; numstat aggregate is 1582 file entries, 62288 additions, 61157 deletions.
- Public repo URL to cite: `https://github.com/yangheng95/opencorvus`.

Document structure:
- Whitepaper: problem, project scale, positioning comparison, architecture, database, frontend, acceptance/contract model, executor/deployment, limitations/next work.
- Weekly report: 总体情况 / 关键里程碑 / 本周 with 做了什么 / 核心结果 / 数据/指标变化 / blocker / 业务结果 / 下周计划.

Validation after rewrite:
- Static grep for banned false names and banned tone phrases.
- Static grep for all image references.
- Browser visual pass for both HTML files.
- `git add docs/whitepaper docs/reports`, commit, push without bypassing hooks.
