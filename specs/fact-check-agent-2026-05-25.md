# Fact-Check Agent 设计方案

日期：2026-05-25
作者：HengYang + Claude（codex round 1/2/3 评审已纳入）
状态：v4 — 已纳入 codex round 3 反馈，待 round 4 复核

---

## Changelog

### v3 → v4（codex round 3 评审）

| v3 错误 / 漏点 | v4 修正 |
|---|---|
| §5.2 给 integrity 3 处都注入 fragment | **事实错误**：team-agent.ts:197 是 PLAN（`submit_integrity_review_plan`），:265 是 CONSENSUS（产 `IntegrityTeamReport`），:404 是 REVIEWER（`submit_reviewer_report`，不同 schema）。**只 CONSENSUS（:265）注入**；plan/reviewer 不注入，且只 `IntegrityTeamReport` 加 `fact_check_items` 字段。reviewer/plan schema 不改 |
| §5.2 6 worker 各自 `[CORE, fragment].join("\n\n")` 裸拼接（违反 rule 9 抽象设计模式） | v4：抽 `withFactCheckRegistration(core: string): string` 辅助函数放在 `fragments/fact-check-registration.ts`；6 处调用点统一改为 `core: withFactCheckRegistration(XXX_CORE)` |
| §6.1.3 external executor 在 6 个 `structured` return literal 各自补 `fact_check_items: []`（rule 8 双源） | v4：单一适配点 in `runWithExternalProvider` wrapper，在 `BuildResultSchema.safeParse(result.structured)` 之前 normalize — 若 `structured.fact_check_items` 缺失则注入 `[]`。具体位置：build/agent.ts 中 external executor 路径的 schema parse 前一道 normalize 步骤 |
| §3.1 / §6.1.1 schema 单源位置矛盾（一处说 `fact-check/schema.ts`，另一处说 `fact-check/tools.ts`） | v4：统一 `fact-check/schema.ts` 单源；`fact-check/tools.ts` 与 6 个 worker schema 都 `import` 它 |
| §8 step 1 只注册 Info/NATIVE_DEFAULTS（build/runtime 会炸） | v4：step 1 内容扩展为"注册 + prompt stub + runtime stub"——含最小 fact-check-core.txt + 最小 `FactCheckAgent.run` stub（throw "not implemented"），保证每个 commit 可 build |
| §7 e2e D 没写清楚 finished=false 怎么模拟 | v4：明确 `SessionStatus.set(targetSessionID, { type: "streaming" })`（同进程态），现有 test/engine/active-sessions.test.ts:92-99 已有此用法 |

### v2 → v3（codex round 2 评审）

| v2 错误 / 漏点 | v3 修正 |
|---|---|
| §5.2 假设各 worker 都有 prompt builder | **实测**：只 build 用 `composeBuildCore()`；其它 worker 在 agent.ts 的 `runAgentSession({ core: XXX_CORE })` 字符串处直接组装（design-analyst 已用 `[CORE, ...].join("\n\n")`）。v3 改为：注入点 = 每个 worker 的 agent.ts 中 `core:` 那一行，单源 TS 常量 + N 个调用点改字符串拼接 |
| §1 / §10 覆盖范围矛盾（一边说全覆盖一边排除 coding/general） | v3 重定义覆盖范围为"**有 terminal report schema 的 worker**"（build / requirements / architect / design-analyst / intent-analysis / integrity）。coding / general 不在范围内不是例外——它们没有结构化产出位 |
| `FactCheckItemListSchema.default([])` 与"必填"矛盾 | 删 `.default([])`，纯 `z.array(FactCheckItemSchema)` 必填字段 |
| `claim` 禁词 regex 拒绝（违反 rule 20 关键字匹配） | 删 host-side regex。禁词约束移到：(a) fragment prompt 文本规则；(b) fact-check agent 在 inspect 阶段把无信息 claim 标 `unresolved.why_unresolved="ambiguous"` |
| `inconclusive` 在 `items_total=0` 的边界异常 | v3 显式：`items_total === 0 → verdict="clean"`，artifact 记 `items_inspected: 0`；不靠表达式副作用 |
| `target_message_hash = sha256(latest assistant content)` 漂移风险 | v3：fact_check 工具调用瞬间 snapshot `{message_id, content_hash, finished: bool}`；若 `finished=false` 工具直接 reject "target session not in terminal state, retry later" |
| §6.1 多处"推测路径 / 待复核"违反 rule 35 | v3 全部用 codex grep 验证后的实际路径：`build/types.ts`、`requirements/output-tools.ts`、`architect/output-tools.ts`、`design-analyst/output-tools.ts`、`intent-analysis/output-tools.ts`、`integrity/team-schema.ts`、`config/config.ts`、`decision-log/index.ts` |
| §B-2 "rule 18 reset DB 就解决了" 不实 | v3 §6.2 列出**全部契约破坏面**：external executor (codex/claude-code) 解析、test fixture、prompt-catalog NATIVE_DEFAULTS、collector report 构造、overlay event-stream parsers、既有 contract test，每项列入实施 |
| §8 步骤顺序：UI 在 SessionKind 闭合前做 | v3 重排：强串行链 SESSION_KINDS/AgentRoleID/registry → schema+artifact+persist → worker schema/prompt → e2e；UI/overlay 在 SessionKind 闭合后并行 |
| §4.4 orchestrator prompt 暴露 hash 细节 | v3 改为对 LLM 友好措辞 "tool dedupes automatically; call when relevant" |

### v1 → v2 仍有效的修正

`system.txt 全注入`废除、inline `<fact-check>` XML 废除、`CompactionHandoff` 字段废除、`target_message_id` 改为 `target_session_id`、`bash` / `memory write` 删除、step cap 不硬编码 — 见 v2 changelog 段。

---

## 0. 背景与动机

现有所有有 terminal report schema 的 worker agent（build / requirements / architect / design-analyst / intent-analysis / integrity）在产出报告时做出大量**未经验证的事实性断言**——API 行为、库版本、错误码、第三方协议字段、性能数字、历史决策、文件路径等。Integrity 团队（`integrity/team-agent.ts`）只检查"是否满足 acceptance / 是否完整"，**不检查"声明是否属实"**。

需求：

1. 覆盖范围内的 worker agent **必须**在其 terminal report 中登记 `fact_check_items[]`（结构化必填字段）。
2. 新增 **fact-check agent**，由 orchestrator 在合适时机调用，检索网络/代码库/记忆，对登记项做核查，产出 `verified / corrected / unresolved` 列表。
3. 更正以**新消息**形式回流给 orchestrator（rule 15），orchestrator LLM 决定 `modify_goal` / `restart_from_stage` / `accept-as-is`。
4. fact-check 结果以 `fact_check_attempt` artifact 持久化，被 decision_log / read_context / integrity replay 消费。

## 1. 范围定义（v3 重写消除矛盾）

### 1.1 覆盖范围：**"有 terminal report schema 的 worker"**

| Worker | Terminal Schema 实际路径（codex grep 已验证） | 覆盖 |
|---|---|---|
| build | `packages/opencorvus/src/build/types.ts`（BuildResultSchema） | ✅ |
| requirements | `packages/opencorvus/src/requirements/output-tools.ts`（collector submit schema） | ✅ |
| architect | `packages/opencorvus/src/architect/output-tools.ts` | ✅ |
| design-analyst | `packages/opencorvus/src/design-analyst/output-tools.ts` | ✅ |
| intent-analysis | `packages/opencorvus/src/intent-analysis/output-tools.ts` | ✅ |
| integrity（仅 consensus 阶段） | `packages/opencorvus/src/integrity/team-schema.ts`（IntegrityTeamReport — supervisor consensus 产出） | ✅ |

### 1.2 不覆盖（不是例外，是定义不适用）

| Agent | 不覆盖理由 |
|---|---|
| coding / general | 直接对话产出，无 terminal report schema，无结构化登记位。其断言通过对话直接给用户审阅 |
| orchestrator / control | 决策叙述非事实声明 |
| compaction / title / summary | 不产生面向用户的断言 |
| explore | 只读检索 subagent，输出本身是引用证据 |
| fact-check 自己 | schema-level 防自递归（§3.4） |

如未来要覆盖 coding / general，需先给它们引入 finalizer 机制（独立需求，本方案外）。

### 1.3 用户已拍板的 4 项决策（v1 沿用）

| 维度 | 选择 |
|---|---|
| Agent 形态 | 新建独立 agent |
| 触发时机 | Orchestrator 决定（rule 13） |
| 更正形态 | 独立报告消息 + 持久 artifact（源消息 append-only 不动） |
| 覆盖范围 | **有 terminal report schema 的 6 个 worker**（§1.1） |

---

## 2. CLAUDE.md 规则合规性

| Rule | 关切 | v3 如何合规 |
|---|---|---|
| 5 / 6 第一性 / 禁过工 | 不引入超出需求的工具/字段 | 工具集只剩 read/search/web/memory.search.get；fact-check 不写记忆；不引入新表，只用既有 `engine_artifact` |
| 6.1 / 11 prompt-over-host | 不在 host 端硬编码触发链 | Orchestrator core prompt 写决策规则，host 只暴露 `fact_check` 工具，仅做 artifact 幂等查询（非状态机） |
| 7 / 8 单源 / 禁 fallback | 范围矛盾 / 默认值 fallback | 范围在 §1.1 单一表格枚举；`fact_check_items` 必填字段无 `.default([])` |
| 10 禁硬编码 | step cap / 工具列表 | step cap 走 agent config 默认；工具列表 §4.2 表 |
| 13 禁状态机 | 触发 / 后续行动 | `fact_check` 是 orchestrator tool；后续 `modify_goal`/`restart_from_stage`/`fail_task` 由 orchestrator LLM 据 `recommended_action` 决定调用 |
| 14 流式 | fact-check 通过 `runAgentSession` 跑（已流式） | 复用现有 worker agent runtime |
| 15 禁合成 / 隐藏消息 | 不改写源消息 | terminal yield 单条 markdown 报告作为 orchestrator 工具结果出现在对话流；artifact 持久化是 evidence channel，不是消息分叉 |
| 16 / 17 禁补丁 / 死代码 | 不留 legacy 路径 | terminal schema 增字段必填；现有 collector / fixture / external executor 适配在实施步骤显式列出（§6.2） |
| 18 直接 reset DB | session 表 SESSION_KINDS 扩展 | `engine_artifact` 加新 kind 不需迁移；rule 18 允许的 DB 改动列入 §6.2 |
| 19 缩写注释 | FCI / FCA | FCI = Fact-Check Item，FCA = Fact-Check Attempt（首次出现处注释） |
| 20 禁关键字规则逻辑 | claim 禁词检查 | **v3 删 host-side regex**；禁词约束由 prompt 文本 + fact-check agent 复核职责承载 |
| 22 commit + push | 分阶段提交 | §8 每步独立 commit |
| 28 / 36 改动配测试 | 每个 touch point 配测试 | §7 测试清单 |
| 35 全仓 grep 穷举 | 影响面 | v3 §6 全部路径经 codex round 2 grep 验证；无"推测/待复核"残留 |

---

## 3. 协议设计

### 3.1 通用字段

```ts
// packages/opencorvus/src/fact-check/schema.ts
export const FactCheckItemSchema = z.object({
  claim: z.string().min(20).max(280),
  confidence: z.enum(["low", "medium", "high"]),
  category: z.enum(["api", "library", "number", "history", "path", "protocol", "other"]),
  source: z.string().min(3),
})

// 必填，无 default，无 optional
export const FactCheckItemListSchema = z.array(FactCheckItemSchema)
```

**禁词约束不进 schema**（rule 20）。仅 fragment prompt 文本（§5.1）说明"generic 词无意义，会被 fact-check 标 unresolved"；fact-check agent 在 inspect 阶段把这种 claim 归类为 `unresolved.why_unresolved="ambiguous"`，按职责自然过滤。

### 3.2 各 worker terminal schema 改动（v3 实际路径）

每个 §1.1 covered worker 的 terminal schema 文件 top-level 加 `fact_check_items: FactCheckItemListSchema` 必填字段。具体：

```ts
// build/types.ts BuildResultSchema 顶层
{
  ...existing fields,
  fact_check_items: FactCheckItemListSchema,  // 必填
}

// 五个 output-tools.ts（requirements / architect / design-analyst / intent-analysis）submit schema 顶层
//   注：实际 schema 名按既有命名（submit_requirements_report 等）
// integrity/team-schema.ts：只 IntegrityTeamReport（CONSENSUS 产出）加 fact_check_items 顶层
//   — submit_integrity_review_plan 和 submit_reviewer_report 不改 schema、不加字段
```

### 3.3 Fact-check agent 终端工具：`report_fact_check_result`

```ts
// packages/opencorvus/src/fact-check/tools.ts
export const FactCheckReportSchema = z.object({
  scope: z.object({
    target_session_id: z.string(),
    target_agent: z.string(),
    target_message_id: z.string(),                  // snapshot 取得的 message id
    target_message_content_hash: z.string(),        // sha256 of target message content at snapshot time
    items_total: z.number().int().nonnegative(),
    items_inspected: z.number().int().nonnegative(),
  }),
  verified: z.array(z.object({
    claim: z.string(),
    evidence: z.array(z.object({
      kind: z.enum(["web", "code", "memory"]),
      pointer: z.string(),
      excerpt: z.string().max(800),
    })).min(1),
  })),
  corrected: z.array(z.object({
    claim: z.string(),
    correction: z.string(),
    severity: z.enum(["minor", "material", "blocking"]),
    evidence: z.array(z.object({
      kind: z.enum(["web", "code", "memory"]),
      pointer: z.string(),
      excerpt: z.string().max(800),
    })).min(1),
    recommended_action: z.enum(["accept_with_note", "modify_goal", "restart_from_stage", "fail_task"]),
  })),
  unresolved: z.array(z.object({
    claim: z.string(),
    why_unresolved: z.enum(["no_network", "rate_limited", "ambiguous", "out_of_scope", "tool_failed"]),
    severity: z.enum(["minor", "material", "blocking"]),
  })),
  overall_verdict: z.enum(["clean", "minor_corrections", "needs_orchestrator_action", "inconclusive"]),
})
// schema 不含 fact_check_items 字段——防自递归（rule 8 单源约束）
```

**Verdict 决策树**（fact-check core prompt 写明，非 host 拦截）：

```
if items_total === 0:                                 → verdict = "clean"      // 明示边界
elif corrected.contains(material|blocking) OR unresolved.contains(material|blocking):
                                                       → "needs_orchestrator_action"
elif items_inspected < items_total / 2 AND corrected has no minor+:
                                                       → "inconclusive"
elif corrected.length > 0 (all minor) OR unresolved.length > 0 (all minor):
                                                       → "minor_corrections"
else:                                                   → "clean"
```

### 3.4 持久化：`fact_check_attempt` artifact

```ts
// packages/opencorvus/src/fact-check/persist.ts
export const FactCheckAttemptArtifactSchema = z.object({
  kind: z.literal("fact_check_attempt"),
  fact_check_session_id: z.string(),
  target_session_id: z.string(),
  target_agent: z.string(),
  target_message_id: z.string(),                       // snapshot 取得
  target_message_content_hash: z.string(),
  invoked_by_orchestrator_session_id: z.string(),
  report: FactCheckReportSchema,
  time_started: z.number(),
  time_completed: z.number(),
  outcome: z.enum(["completed", "aborted", "tool_error"]),
})
```

**幂等键**：`(invoked_by_orchestrator_session_id, target_session_id, target_message_id, target_message_content_hash)`。  
**Snapshot 协议**：fact_check 工具入口先调 `Session.latestAssistantMessage(target_session_id)`：
- 若 `finished === false`（流仍在跑）→ 工具立即返回 `{ status: "rejected", reason: "target_not_terminal" }`，**不**记 artifact，让 orchestrator 重试。
- 若 `finished === true` → 取 `(message_id, content_hash)`，查 artifact 命中即返回 cached；未命中拉起 fact-check session。

### 3.5 跨 compaction 持久化

不动 `CompactionHandoff` schema。`fact_check_attempt` 与 worker terminal report 都是 artifact，本来跨 compaction 安全。

---

## 4. 架构与编排

### 4.1 Fact-check agent 注册

| 字段 | 值 |
|---|---|
| Mode | `subagent` |
| Native | true |
| Hidden | false |
| Step cap | 不硬编码，走 agent config 默认 |
| Permission | 默认 allow，受 user config 覆盖 |
| SessionKind | 新增 `"fact-check"` 到 `SESSION_KINDS`（§6.1） |
| runtimeContractRequiredAgentKinds | 不加入（fact-check 非 goal-scoped） |

### 4.2 工具集

```ts
tools: {
  include: [
    "read", "glob", "search_code",
    "websearch", "webfetch",
    "external_code_search",
    "memory_search", "memory_get",
    "todoread", "todowrite",
  ]
}
```

不给：`edit` / `write` / `merge_back` / git 写 / `bash` / `memory_write` / `memory_delete` / `task_report` / `panel`。

终端工具：`report_fact_check_result`（仅本 agent 持有）。

### 4.3 Orchestrator 工具

```ts
// packages/opencorvus/src/orchestrator/tools.ts
fact_check: tool({
  description: "Run fact-check on a worker session's latest terminal report. Tool dedupes automatically; call when relevant. Use when (1) integrity verdict=pass AND (2) the worker's terminal report has non-empty fact_check_items OR makes load-bearing factual claims about external systems.",
  inputSchema: z.object({
    target_session_id: z.string(),
    target_agent: z.string(),
    reason: z.string().min(10),
  }),
  execute: async (input, ctx) => {
    // Step 1: snapshot target message
    const snap = await Session.snapshotLatestAssistant(input.target_session_id)
    if (!snap.finished) {
      return SubAgentProtocol.yieldResult({
        headline: "fact_check rejected: target session not in terminal state",
        fields: [["status", "rejected"], ["reason", "target_not_terminal"]],
        pointer: `target session ${input.target_session_id}`,
      })
    }
    // Step 2: idempotency
    const cached = await FactCheckPersist.lookup({
      orchestratorSessionID: ctx.sessionID,
      targetSessionID: input.target_session_id,
      targetMessageID: snap.messageID,
      targetMessageContentHash: snap.contentHash,
    })
    if (cached) return renderFactCheckMarkdown(cached.report, { cached: true })
    // Step 3: run
    const { FactCheckAgent } = await import("@/fact-check")
    const result = await FactCheckAgent.run({
      targetSessionID: input.target_session_id,
      targetAgent: input.target_agent,
      targetMessageID: snap.messageID,
      targetMessageContentHash: snap.contentHash,
      reason: input.reason,
      orchestratorSessionID: ctx.sessionID,
      signal: ctx.signal,
      onSessionCreated: (id) => { /* overlay routing */ },
    })
    await FactCheckPersist.record({ ...result, outcome: signal.aborted ? "aborted" : "completed" })
    return renderFactCheckMarkdown(result.report, { cached: false })
  }
})
```

加入 orchestrator 白名单（agent.ts orchestrator info.tools.include）。

### 4.4 Orchestrator core prompt 增量

`prompt/core/orchestrator-core.txt` 新增一节（v3 措辞调整，不暴露 hash 细节）：

```
## Fact-check dispatch (rule 13: you decide, not the host)

After integrity verdict = pass, you MAY (not MUST) call `fact_check` on a worker session when ALL hold:
1. The worker's terminal report has `fact_check_items.length > 0`, OR the worker's narrative makes
   load-bearing factual claims about external systems (APIs, library versions, third-party
   protocols, numbers).
2. The downstream consumer (user / next stage) would be materially misled by an incorrect claim.

The tool dedupes automatically across repeated calls — you do NOT need to track "already
checked". If the target session is still streaming, the tool will reject; retry after it
finishes.

Do NOT call fact_check:
- For trivial / opinion / preference outputs.
- When integrity verdict ≠ pass — fix integrity findings first.

After fact_check returns:
- verdict=clean → proceed.
- verdict=minor_corrections → quote corrections in your next user-facing message, proceed.
- verdict=needs_orchestrator_action → invoke modify_goal / restart_from_stage / fail_task per
  the corrected[i].recommended_action.
- verdict=inconclusive → either retry fact_check (after addressing why_unresolved) or proceed
  with caveat note.
```

---

## 5. Prompt 注入：辅助函数 + 各 worker `agent.ts` 的 `core:` 处统一调用（v4 抽象）

### 5.1 单源 TS 常量 + 辅助函数

新文件 `packages/opencorvus/src/prompt/fragments/fact-check-registration.ts`：

```ts
export const FACT_CHECK_REGISTRATION_FRAGMENT = `
## Fact-check item registration

Before calling your terminal report tool, populate \`fact_check_items[]\` with EVERY factual
claim in your output that you have NOT directly verified via tool calls in this session, AND
EVERY placeholder for information you do not have.

Each item:
- \`claim\`: full standalone assertion (≥20 chars, ≤280 chars). Avoid generic words like
  "tbd", "unknown", "n/a", "continue", "next step" — they get classified as ambiguous and
  count against you in the fact-check report.
- \`confidence\`: low | medium | high (self-assessment).
- \`category\`: api | library | number | history | path | protocol | other.
- \`source\`: where you got it. "assumed" | "model prior" | "<url>" | "<file:line>" |
  "user-said:<short>".

Placeholders: \`claim="<待填充：...>"\` + confidence="low" + source="assumed".

DO NOT register: opinions, preferences, plans, your own decisions, tool-call results you
observed in this session, contents of files you read in this session.

Empty list (\`fact_check_items: []\`) is fine when you genuinely have no unverified claims.
Over-claiming verified-ness will be flagged as a violation in fact-check.
`.trim()

/**
 * Append the fact-check registration fragment to a worker core prompt.
 * Single abstraction point for rule 9 (extract repeating structural pattern).
 * Used at every covered worker's `core:` site in its agent.ts run-function.
 *
 * Usage:
 *   core: withFactCheckRegistration(BUILD_CORE)
 *   core: withFactCheckRegistration(composeBuildCore(autoIteration))
 *   core: withFactCheckRegistration([DESIGN_ANALYST_CORE, renderAutoIterationMode(...)].join("\n\n"))
 */
export function withFactCheckRegistration(core: string): string {
  return [core, FACT_CHECK_REGISTRATION_FRAGMENT].join("\n\n")
}
```

### 5.2 各 worker `agent.ts` 改动（v4 — 通过辅助函数统一）

**5 个 worker + integrity 仅 consensus 阶段 = 6 个注入点**，每处一行替换为 `withFactCheckRegistration(...)` 调用：

| Worker / 阶段 | 文件:行 | 改动 |
|---|---|---|
| build | `build/agent.ts:747` | `core: composeBuildCore(autoIteration)` → `core: withFactCheckRegistration(composeBuildCore(autoIteration))` |
| requirements | `requirements/agent.ts:99` | `core: REQUIREMENTS_CORE` → `core: withFactCheckRegistration(REQUIREMENTS_CORE)` |
| architect | `architect/agent.ts:121` | `core: ARCHITECT_CORE` → `core: withFactCheckRegistration(ARCHITECT_CORE)` |
| design-analyst | `design-analyst/agent.ts:98` | `core: [DESIGN_ANALYST_CORE, renderAutoIterationMode(autoIteration)].join("\n\n")` → `core: withFactCheckRegistration([DESIGN_ANALYST_CORE, renderAutoIterationMode(autoIteration)].join("\n\n"))` |
| intent-analysis | `intent-analysis/agent.ts:74` | `core: INTENT_CORE` → `core: withFactCheckRegistration(INTENT_CORE)` |
| **integrity 仅 consensus**（**v4 修正**） | `integrity/team-agent.ts:265` | `core: TEAM_CORE` → `core: withFactCheckRegistration(TEAM_CORE)` |
| ~~integrity plan~~ | `team-agent.ts:197` | **不改**——`submit_integrity_review_plan` 不产 `IntegrityTeamReport`，不该登记 |
| ~~integrity reviewer~~ | `team-agent.ts:404` | **不改**——`submit_reviewer_report` 不产 `IntegrityTeamReport`，不该登记 |

**单源原则**（v4 强化）：
- 内容只在 `fragments/fact-check-registration.ts`（`FACT_CHECK_REGISTRATION_FRAGMENT` 常量）
- 拼接模式只在 `withFactCheckRegistration()` 辅助函数中（rule 9 抽象设计模式）
- 6 个调用点统一调辅助函数，无裸 `[...].join("\n\n")` 重复

**Fact-check agent 自己不导入**该 fragment（防自递归）。Compaction/title/summary/orchestrator/control/coding/general 不导入。

### 5.3 fact-check core prompt（防自递归）

`prompt/core/fact-check-core.txt`：

```
You are a fact-check agent. You verify factual claims; you do NOT make new factual claims
of your own.

You MUST NOT:
- Emit fact_check_items in your own terminal report. Your `report_fact_check_result` schema
  has no such field — this is enforced at schema level.
- Use <fact-check> tags in chat text.
- Speculate beyond what evidence supports. If uncertain, classify the item as `unresolved`
  with an explicit `why_unresolved`.

Every `verified` and `corrected` item MUST cite at least one `evidence` entry with a
concrete pointer (URL / file:line / memory:id) and excerpt — your terminal schema rejects
items without evidence.

If a registered claim's `claim` text is too vague to verify (generic words like "tbd",
"unknown", or content-free placeholders), classify it as `unresolved.why_unresolved=
"ambiguous"` — your job is to flag laziness, not to guess intent.

If all tool calls fail or you can't reach external info, return verdict="inconclusive"
with unresolved items marked `why_unresolved="tool_failed"`. Do NOT fabricate evidence.
```

---

## 6. 影响面 / 调用点清单（v3 全部 grep 验证）

### 6.1 必改文件（新增 / 修改）

#### 6.1.1 新文件

| 文件 | 用途 |
|---|---|
| `packages/opencorvus/src/prompt/fragments/fact-check-registration.ts` | `FACT_CHECK_REGISTRATION_FRAGMENT` 常量 + `withFactCheckRegistration()` 辅助函数 |
| `packages/opencorvus/src/prompt/core/fact-check-core.txt` | fact-check agent 核心 prompt |
| `packages/opencorvus/src/fact-check/index.ts` | `FactCheckAgent.run` 实现 |
| `packages/opencorvus/src/fact-check/schema.ts`（**v4 单源**） | `FactCheckItemSchema` + `FactCheckItemListSchema` + `FactCheckReportSchema` + `FactCheckAttemptArtifactSchema`——**全部 schema 单源**；`tools.ts` 与 6 个 worker schema 都 import 此处 |
| `packages/opencorvus/src/fact-check/tools.ts` | terminal tool 实现，schema 全部从 `./schema` import |
| `packages/opencorvus/src/fact-check/persist.ts` | `fact_check_attempt` artifact 读写 + 幂等查询，schema 从 `./schema` import |
| `packages/opencorvus/src/fact-check/snapshot.ts` 或 `session/index.ts` 扩展 | `Session.snapshotLatestAssistant(sessionID)` — codex 验证现有无此 API，需新增（基于 `Session.messages()` + `SessionStatus.get()` 组合） |

#### 6.1.2 既有文件改动（按 codex round 2 实际路径）

| 文件 | 改动 |
|---|---|
| `packages/opencorvus/src/agent/role-contract.ts` | AgentRoleID 加 `"fact-check"` + contract 配置 |
| `packages/opencorvus/src/agent/agent.ts` | 注册 fact-check Info + NATIVE_DEFAULTS + orchestrator info.tools.include 加 `fact_check` |
| `packages/opencorvus/src/orchestrator/tools.ts` | 注册 `fact_check` tool（含 snapshot + 幂等查询 + 工具入口 reject 分支） |
| `packages/opencorvus/src/orchestrator/tools.ts`（read_context 实现处约 line 3814+） | read_context scope 增加 fact_check_attempt 渲染 |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt` | 新增 §Fact-check dispatch |
| `packages/opencorvus/src/session/session.sql.ts` | `SESSION_KINDS` 加 `"fact-check"` |
| `packages/opencorvus/src/session/loop.ts` | `runtimeContractRequiredAgentKinds` **保持不变**（fact-check 无 runtime contract）；显式断言测试 |
| `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts` | OverlayChannel 路由覆盖新 SessionKind（按既有 SessionKind 注册模式） |
| `packages/opencorvus/src/build/agent.ts:747` | `core:` 行拼接 fragment |
| `packages/opencorvus/src/build/types.ts` | BuildResultSchema 加 `fact_check_items: FactCheckItemListSchema` 必填 |
| `packages/opencorvus/src/requirements/agent.ts:99` | `core:` 行拼接 fragment |
| `packages/opencorvus/src/requirements/output-tools.ts` | submit schema 加 `fact_check_items` 必填 |
| `packages/opencorvus/src/architect/agent.ts:121` | `core:` 行拼接 fragment |
| `packages/opencorvus/src/architect/output-tools.ts` | submit schema 加 `fact_check_items` 必填 |
| `packages/opencorvus/src/design-analyst/agent.ts:98` | 既有 join 末尾追加 fragment |
| `packages/opencorvus/src/design-analyst/output-tools.ts` | submit schema 加 `fact_check_items` 必填 |
| `packages/opencorvus/src/intent-analysis/agent.ts:74` | `core:` 行拼接 fragment |
| `packages/opencorvus/src/intent-analysis/output-tools.ts` | submit schema 加 `fact_check_items` 必填 |
| `packages/opencorvus/src/integrity/team-agent.ts:265`（**仅 consensus**） | 一处 `core: withFactCheckRegistration(TEAM_CORE)`；line 197 (plan) / line 404 (reviewer) **不改** |
| `packages/opencorvus/src/integrity/team-schema.ts` | **仅 IntegrityTeamReport**（consensus 产出）加 `fact_check_items` 必填；`submit_integrity_review_plan` / `submit_reviewer_report` schema 不动 |
| `packages/opencorvus/src/decision-log/index.ts` | `DecisionLogWriter.record` 调用：fact-check 完成时写 phase=`fact_check` 条目 |
| `packages/opencorvus/src/decision-log/schema.ts` | DecisionEntry phase 允许 `"fact_check"`（如 phase 是枚举） |
| `packages/opencorvus/src/config/config.ts` | agent 配置允许 fact-check 覆盖 prompt/model/tools/step_cap（按现有 agent 配置模式） |

#### 6.1.3 契约破坏适配（rule 16 / 18：不留死代码 / 不留补丁）

> codex round 2 §B-2 指出 reset DB 不解决全部破坏面。v3 显式列入实施：

| 破坏面 | 适配 |
|---|---|
| 外部 executor（codex / claude-code）模式 | **单一适配点**（v4 修正）：`build/agent.ts` 中 `runWithExternalProvider` / `runWithExternalProviderImpl` 包装层，在 `BuildResultSchema.safeParse(result.structured)` **之前**做一次 normalize：若 `result.structured.fact_check_items` 缺失，注入 `[]`。**不**在 6 个 `structured` return literal（codex 验证：build/agent.ts 行 1846/1865/1954/1979/1999/2017）各自补字段——那是 rule 8 双源违规。Spec 记录"external executor 不参与 fact-check 登记"作为已知限制 |
| 测试 fixture / contract test | `test/build-agent/contract-error.test.ts`、`test/build/result-schema.test.ts`、`test/agent/agent.test.ts`、整套 fixture 添加 `fact_check_items: []` 字段 |
| Prompt-catalog NATIVE_DEFAULTS（`agent.ts`） | 每个 covered worker 的 NATIVE_DEFAULTS 入口同步含 fragment 字符串（保持 overlay prompt-catalog 显示与运行时一致） |
| Collector report 构造 | 每个 worker 的 `getCollector()` / `buildReport()` 构造空 `fact_check_items: []` 默认，让初始 collector 状态合法 |
| Overlay event-stream parsers | overlay 解析 BuildResult / IntegrityTeamReport 等的位置（如 cards 渲染）容忍新字段（v1 实际就有此字段，UI 不需立即展示） |
| 既有 e2e benchmark | benchmark fixture 同步更新 |

#### 6.1.4 Overlay UI 文件（最小骨架）

| 文件 | 改动 |
|---|---|
| `packages/overlay/src/utils/message.ts` | SessionKind 路由 + `"fact-check"` 角色映射 |
| `packages/overlay/src/components/Avatar.tsx` | fact-check 头像（v1 可复用 integrity 资产） |
| `packages/overlay/src/components/Icon.tsx` | fact-check 图标 |
| `packages/overlay/src/utils/card-color.ts` | fact-check 卡片配色 |
| `packages/overlay/src/i18n/en-US.json`、`zh-CN.json` | 角色文案 |

**显式不改**：`packages/overlay/src/utils/markdown.ts` / `TextPart.tsx`——v3 不用 inline 标签，无需 markdown 渲染层改动。

### 6.2 全仓 grep 复核 token

实施前 grep 并审视，确认无残留：
- `fact-check`, `factcheck`, `FactCheck`, `事实核查`
- `factuality`（acceptance/types.ts 既有，本方案不复用）
- `<fact-check`（v1/v2 实验残留必须为 0）
- `FACT_CHECK_REGISTRATION_FRAGMENT`（应只在 fragments/ + 6 个 worker agent.ts 出现）

---

## 7. 测试策略

### 7.1 单测

| 测试文件 | 覆盖 |
|---|---|
| `test/fact-check/agent.test.ts` | `run()` happy / corrected / unresolved / inconclusive / cached-hit / cancel-mid-run / tool-error 七 case |
| `test/fact-check/schema.test.ts` | FactCheckItemSchema 边界（min/max claim 长度、source 空字符串拒绝）+ FactCheckReportSchema verdict 决策树 + items_total=0 边界 |
| `test/fact-check/persist.test.ts` | artifact 读写 + 幂等键命中 + outcome=aborted 持久化正确 |
| `test/fact-check/snapshot.test.ts` | `snapshotLatestAssistant` finished=false → 拒绝；finished=true → snapshot 正确 |
| `test/agent/role-contract.test.ts` 扩展 | 新 role 加入 + `agentKindRequiresRuntimeContract("fact-check") === false` |
| `test/orchestrator/tools.test.ts` 扩展 | `fact_check` 工具：input schema、reject (not terminal)、cached、dispatch、错误传播 |
| `test/orchestrator/orchestrator-tool-descriptions.test.ts` 扩展 | fact_check description 含必要关键词 |
| `test/build-agent/contract-error.test.ts` 扩展 | BuildResultSchema 增字段后 contract test；external executor 分支空数组路径 |
| `test/build/result-schema.test.ts`（如存在或新建） | BuildResultSchema 含必填字段 |
| `test/agent/core-prompt-hygiene.test.ts` 扩展 | fact-check-core.txt hygiene + 反向（不含 `<fact-check>` 字面 + 不含 fact_check_items 字面） |
| `test/prompt/fact-check-fragment.test.ts`（新） | fragment 含必需短语 + 反向 |
| `test/prompt/worker-prompt-composition.test.ts`（新） | 6 个 covered worker 的 `core:` 拼接含 fragment；fact-check / compaction / title / summary / orchestrator / control / coding / general 不含 |
| `test/session/session-kinds.test.ts`（扩展或新） | `SESSION_KINDS` 含 `"fact-check"` |
| `test/decision-log/factcheck-record.test.ts`（新） | fact-check 完成写 phase="fact_check" 条目可读 |

### 7.2 集成 / e2e

| Case | 验证 |
|---|---|
| e2e A | build worker terminal report 含 items → integrity pass → orchestrator 调 fact_check → corrected blocking → orchestrator 据 recommended_action 调 modify_goal |
| e2e B 反向 | worker items=[] → orchestrator 不调 fact_check（验证 LLM 决策能力） |
| e2e C 幂等 | 连续两次同参数 → 第二次 cached=true 且 0 LLM token |
| e2e D 拒绝 | target session 未终态 → fact_check 立即 reject，不记 artifact。**模拟方法**（v4 补）：测试中 `SessionStatus.set(targetSessionID, { type: "streaming" })`（同进程态，参考 `test/engine/active-sessions.test.ts:92-99`）；snapshot test 必须同进程跑 |
| e2e E cancel | fact_check 跑到一半 cancel → signal 传播 → artifact outcome="aborted" |
| e2e F tool 全败 | websearch/webfetch/code search 全失败 → verdict=inconclusive，unresolved 全 `tool_failed`，无伪 evidence |
| e2e G external executor | codex executor 模式下 build → BuildResult 含 `fact_check_items: []`，schema 通过；orchestrator 据空列表决定不调 fact_check |

---

## 8. 实施步骤（v3 重排：强串行链优先）

每步独立 commit + push（rule 33）。

### 强串行链

1. **类型骨架 + 最小 stub 闭合**（v4 扩展）：
   - `SESSION_KINDS` 加 `"fact-check"`；`AgentRoleID` 加 `"fact-check"`；`role-contract.ts` 加 contract
   - `agent.ts` 加 Info + NATIVE_DEFAULTS + orchestrator tool whitelist
   - `config/config.ts` 允许 fact-check agent config 覆盖
   - **新增 stub**：最小 `prompt/core/fact-check-core.txt`（占位文本）+ 最小 `fact-check/index.ts` 导出 `FactCheckAgent.run` stub（throw "not implemented"）
   - **目的**：保证每个 commit 可 build（typecheck + import resolution），真实逻辑在后续步骤填  
   Commit: `feat(agent): register fact-check role + session kind (skeleton + stubs)`.

2. **Schema + artifact + persist**：`fact-check/schema.ts` 单源（FactCheckItemSchema、FactCheckItemListSchema、FactCheckReportSchema、FactCheckAttemptArtifactSchema）；`fact-check/persist.ts`；`Session.snapshotLatestAssistant`（新 API，基于 `Session.messages()` + `SessionStatus.get()`）+ 单测。  
   Commit: `feat(fact-check): add schemas + artifact persistence + idempotency`.

3. **Worker terminal schema 加 fact_check_items + 全套契约破坏适配**（build/types.ts + 5 个 output-tools.ts + team-schema.ts + 所有 fixture / contract test + external executor 分支构造 `[]` + collector 默认 `[]` + NATIVE_DEFAULTS 同步）+ 单测。  
   Commit: `feat(workers): require fact_check_items in terminal schemas`.

4. **Prompt fragment + 6 个 worker `core:` 注入**（build/requirements/architect/design-analyst/intent-analysis/integrity，含 integrity 3 处）+ hygiene 测试。  
   Commit: `feat(prompt): inject fact-check registration fragment into worker cores`.

5. **fact-check agent runtime**：`fact-check/tools.ts`、`fact-check/index.ts`（`FactCheckAgent.run`）+ cancel/error 路径 + 单测。  
   Commit: `feat(fact-check): implement agent runtime`.

6. **Orchestrator fact_check tool**：`orchestrator/tools.ts` 加 tool（含 snapshot + reject + cached + dispatch）+ `read_context` 渲染 fact_check_attempt + orchestrator-core.txt §Fact-check dispatch + 单测。  
   Commit: `feat(orchestrator): expose fact_check tool with idempotency`.

7. **decision_log 集成 + integrity replay**：decision_log 写入 phase=`fact_check` + integrity replay 路径能读到 artifact + 单测。  
   Commit: `feat(integrity): consume fact-check evidence via decision-log + read_context`.

### 可并行（在 step 1 闭合后）

8a. **Overlay UI 骨架**（utils/message.ts、Avatar、Icon、card-color、i18n）。  
    Commit: `feat(overlay): register fact-check role surface`.

8b. **prompt hygiene / schema / persist / snapshot 单测**（与 step 6 / 7 可并行写）。

### 最后

9. **e2e A-G 七场景**。Commit: `test(fact-check): end-to-end coverage incl. cancel/cached/reject/inconclusive/external-executor`.

10. **删除草稿 + 最终化文档**。Commit: `docs: finalize fact-check agent spec`.

---

## 9. 已识别风险

| 风险 | 缓解 |
|---|---|
| **R1**：6 个 worker terminal schema 同步改动，遗漏导致 contract 局部破裂 | step 3 单 commit 包含全套改动 + worker-prompt-composition 测试遍历名单 |
| **R2**：fact-check 自递归 | 双重防御：(a) report 终端 schema 无 fact_check_items 字段；(b) fact-check core prompt 显式 forbid |
| **R3**：Orchestrator LLM 不调用 fact_check / 反复调用 | (a) 反复调用由 artifact 幂等键自动去重；(b) 不调用属决策能力问题，orchestrator-core prompt 引导 + e2e B 反向验证，host 不兜底 |
| **R4**：worker LLM 不填 / 乱填 `fact_check_items` | (a) Schema 必填（无 default）；(b) fragment prompt 解释 generic 词后果；(c) fact-check agent 把 ambiguous claim 归为 unresolved；(d) 后续 build 在 integrity feedback 中看到，迭代学到 |
| **R5**：tool 失败时 fact-check 伪 evidence | core prompt 显式规则 + report schema 每 verified/corrected 必须 ≥1 evidence + e2e F 验证 |
| **R6**：cancel 留 orphan artifact | (a) signal 透传；(b) artifact `outcome="aborted"`；(c) read_context 据 outcome 过滤 aborted |
| **R7**：target session 还在流时被核查 → hash 漂移 | 工具入口 snapshot + finished=false reject |
| **R8**：external executor 不参与 fact-check 登记 | step 3 显式构造 `fact_check_items: []`；spec 记录已知限制；e2e G 验证 |
| **R9**：DB / fixture / contract test 漂移 | rule 18 允许 reset DB；step 3 显式列入所有适配；CI 抓 schema/contract 漂移 |
| **R10**：与 integrity 职责模糊 | fact-check-core.txt §0 + 用户文档：integrity = "是否满足 acceptance / 完整性"；fact-check = "声明是否属实" |
| **R11**：禁词 regex 删除后，worker 写垃圾 claim 怎么办 | 由 fact-check agent 复核：generic claim 归 unresolved.ambiguous，自然计入 inconclusive 分母 → orchestrator 据此修复 |

---

## 10. 已确认架构决策（v3 不再争议）

1. **形态**：新建独立 agent。
2. **登记 channel**：worker terminal report schema 必填字段，不用 inline XML。
3. **触发**：orchestrator LLM 决定（rule 13），host 不拦截；artifact 提供幂等。
4. **更正形态**：独立 fact-check session yield markdown + 持久 artifact；源消息 append-only 不动。
5. **覆盖范围**：6 个有 terminal report schema 的 worker（§1.1）；coding / general / 控制平面 / 内部 agent 不在范围内（定义不适用，非例外）。
6. **注入点**：每个 worker 的 agent.ts 中 `core:` 行字符串拼接 + 单源 TS 常量。
7. **幂等键**：`(orchestrator_session_id, target_session_id, target_message_id, target_message_content_hash)`。
8. **Snapshot**：target session 必须 finished=true，否则工具入口 reject。
9. **禁词约束**：移到 prompt 层 + fact-check agent 复核职责，host 无 regex 关键字规则（rule 20）。
10. **schema 必填**：worker `fact_check_items` 必填、无 default、无 optional。

---

## 11. Round 3 复核结论（codex 已答）

| 问题 | Round 3 回应 | v4 处理 |
|---|---|---|
| 1. snapshotLatestAssistant 实际存在吗 | 不存在，需新增；基于现有 `Session.messages()` (session/index.ts:551) + `SessionStatus.get()` (session/status.ts:71) 组合 | §6.1.1 新增明确 |
| 2. reject vs cached 分支 LLM 是否困惑 | 不会；§4.4 已写"reject; retry after it finishes"，可接受 | 保留 |
| 3. integrity 3 阶段注入 | 错误，**只 consensus (line 265)** 注入 + 加字段 | v4 §5.2 + §6.1.2 修正 |
| 4. external executor 构造点 | build/agent.ts 行 1846/1865/1954/1979/1999/2017 六处 `structured` return literal；应在 `runWithExternalProvider` 包装层统一 normalize | v4 §6.1.3 修正 |
| 5. e2e G 外部 executor 支持 | `test/e2e/full-pipeline-*.test.ts` 用 `OPENCORVUS_E2E_EXECUTOR`；fact-check G 更适合 mock provider | §7.2 沿用 |
| 6. step 1 是否可 build | 不能；必须含 prompt + runtime stub | v4 §8 step 1 扩展 |
| 7. Rule 6.1 二次审视 §4.3 | 不违规；snapshot terminal = 数据完整性，cached = 幂等查询，非状态机 | 保留 |
| 8. 任何未发现违规 | 仅指出：integrity 注入、schema 单源位置矛盾、重复拼接未抽象 — 均已在 v4 解决 | v4 已处理 |

## 12. 待 codex round 4 复核

1. **§5.2 `withFactCheckRegistration()` 辅助函数**：放在 `fragments/fact-check-registration.ts` 是否合适？还是该放到 `prompt/` 更高层（无 fact-check 业务概念耦合的位置）？
2. **§6.1.1 schema 单源 `fact-check/schema.ts`**：worker schema（如 build/types.ts）import `FactCheckItemListSchema` 是否会产生循环依赖？build/types.ts 是较底层模块，fact-check/ 是较上层——方向是否健康？
3. **§6.1.3 external executor 单一适配点**：在 `BuildResultSchema.safeParse` 之前 normalize 字段——这算 fallback / 兼容层吗？是否违反 rule 7？我的论据：external executor 不参与 fact-check 协议是**已声明的不覆盖范围**（§1.2），normalize 是协议边界翻译而非降级兼容；类似 i18n 字段默认值。需要 codex 二次审视。
4. **§8 step 1 stub 范围**：fact-check-core.txt 占位文本最少包含什么才能不触发 hygiene 测试（如已有 core-prompt-hygiene.test.ts）？
5. **是否还有 CLAUDE.md 违规未发现？**
6. **最终结论**：若全部解决，可否给 RECOMMEND_PROCEED？

---

（v4 结束。等待 codex round 4 评审。）
