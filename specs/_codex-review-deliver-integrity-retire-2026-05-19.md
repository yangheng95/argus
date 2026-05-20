# 独立二次复审（只读，rule 24 / 37）— deliver 退役 + integrity 升格为终审验收

你是独立资深审查者。**只读**：禁止改文件、禁止任何 git 写操作（无 add/commit/stash/checkout）。

## 背景

本仓库正在进行一次重构，三份落盘 spec（必须先读）：

1. `specs/_codex-disable-deliver-integrity-gate-2026-05-19.md`
   — `deliver` 退役为 workflow 验收闸；推荐 `pipeline` 工作流终点改为 `integrity`；
   **非目标**：本次不删除 delivery 源码树（只是从推荐工作流不可达 + 运行时禁用）。
2. `specs/_codex-integrity-acceptance-review-2026-05-19.md`
   — `integrity` 升格为终审验收者，同时承担多维完整性复核 + delivery 式验收
   （startup/runtime/frontend/visual/tool-call 证据、deferred、可执行拒绝细节）；
   `IntegrityResult` / 持久化 `integrity_attempt` / `integrity.review.completed`
   扩展验收 verdict；integrity **不编辑文件**；排除 `edit_file`/`write_file`/`run_integrity_review`；
   rejected 验收强制聚合 `needs_correction`。
3. `specs/delivery-live-review-card-2026-05-19.md`
   — 决策 C：抽出共享 `review.stream.*` 流式半区（started/progress/chunk），
   completed verdict body 保持 phase-specific（IntegrityBody vs DeliveryReviewBody）；
   integrity 旧 Started/Progress/Chunk schema/handler **删除并迁移**到共享族（rule 8）。

行为规范见仓库根 `CLAUDE.md`（重点：rule 7 禁 fallback / rule 8 禁双源 /
rule 13 禁状态机 / rule 15 禁合成消息 / rule 16 禁技术债 / rule 35 穷举调用点）。

## 复审目标（统一 delta）

完整重构 delta = `git diff c1ef677b2`（= 已提交的 3 个 review-stream commit
`c4b0c0e3c`/`cd96edfce`/`56caeaef0` + 全部未提交的 disable-deliver + promote-integrity 工作树改动，117 files）。
新增未跟踪核心文件：`packages/opencorvus/src/acceptance/review-verdict.ts`、
`packages/opencorvus/src/integrity/acceptance-tools.ts`、
`packages/opencorvus/src/integrity/acceptance-output-tools.ts`、
`packages/opencorvus/src/prompt/core/acceptance-review-core.txt`、
`packages/opencorvus/src/session/repair-hint.ts`（+ 同名 test）。

逐项给 **file:line 证据**，回答：

1. **spec 1 一致性**：`deliver` 是否运行时禁用（立即 disabled 响应、不再调用
   `DeliveryService.verify`/`buildDeliveryEvidenceManifest`/runtime preview/visual/specialist）？
   `pipeline` 内置步骤是否已无 `deliver`、`integrity` 是否 non-skippable 且为终点？
   orchestrator prompt 是否已无强制 deliver 验收闸语言、是否含 integrity 终审引导？
   build 工具描述是否改为路由到 integrity？delivery 源码树是否如 spec 所述**未删除**
   （查是否存在半删除 / dangling import / 双态）？
2. **spec 2 一致性**：integrity 是否真正拥有结构化验收 verdict
   （accepted/rejected + summary + startup + frontend + deferred + tool-call evidence + rejection details）？
   `IntegrityResult` / `integrity_attempt` 持久化 / `integrity.review.completed` 是否已扩展？
   integrity 验收工具集是否排除 `edit_file`/`write_file`/`run_integrity_review`、integrity 是否确不编辑文件？
   acceptance prompt fragment 是否已移除 delivery 身份 + host-arbiter 语言？
   integrity 能否在缺少验收 verdict 时通过（应不能）？rejected 验收是否强制聚合 `needs_correction`？
3. **spec 3 一致性**：共享 `review.stream.*` 是否单一来源？integrity 旧
   Started/Progress/Chunk schema + tree-writer handler 是否已**删除并迁移**（不是新旧并存监听 = rule 8）？
   completed body 是否合理保持 phase-specific（不是被强行 unify）？
   `delivery.review.completed` 是否仅派生自 `decision.final`、business reader 是否仍走
   `delivery-agent-verdict` artifact（非第二业务 verdict 源）？
4. **rule 违规**：逐条 rule 7/8/13/15/16/35 给证据；特别注意 host-side 守门是否越界
   （rule 6.1 — 教 LLM 走哪条路必须 prompt，不是 host preflight；数据完整性 / 不可逆二次确认除外）。
5. **回归风险**：dangling import / 类型断裂 / 测试与 OpenAPI/SDK 同步 / i18n 双语 key 缺失 / pre-push 门
   （typecheck / api:routes-check / docs:check）是否会红。

## 输出

每项结论 + file:line 证据；最后一行明确 **PASS** 或 **不通过（逐条列阻塞项）**。
不要修复，只报告。
