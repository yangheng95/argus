# Fact-Check Agent 设计方案

日期：2026-05-25
作者：HengYang + Claude（codex 评审已纳入）
状态：v2 — 已纳入 codex round 1 反馈，待 round 2

---

## Changelog（v1 → v2，依据 codex round 1 评审）

| v1 错误 / 漏点 | v2 修正 |
|---|---|
| §5 假设 `session/prompt/system.txt` 注入到所有 agent | **事实错误**：`session/llm.ts:73-78` 显示 `system.txt` 仅当 `agent.prompt` 缺失时才用；所有 worker agent 都有自己的 core prompt → system.txt 对它们无效。v2 改为**共享 TS 常量 + 各 worker 的 prompt 组装函数**注入。 |
| §3.1 用 inline XML `<fact-check>` 标签 | 标签会污染用户可见文本 + overlay markdown escape。v2 改为：**fact-check 项进各 worker 的 terminal report schema**（结构化字段），不在 chat text 中暴露。 |
| §3.3 CompactionHandoff schema 加 `factCheckItems` | 不需要。terminal report 是 artifact，本来就跨 compaction 持久。v2 删除此节。 |
| §4.3 `target_message_id` 必填 | worker tool 当前不返回 message_id。v2 改为：fact-check 输入只要 `target_session_id`，自己读该 session 最新 Assistant message。 |
| §4.2 工具集含 `bash` + `memory` 全 CRUD | 过度授权。v2：删 `bash`，`memory` 仅保留 `search/get`（只读）。 |
| §4.1 hardcoded step cap 300 | 违反 rule 10。v2 走 agent config 默认。 |
| §6.1 触点清单不完整 | v2 补：`SESSION_KINDS` / `runtimeContractRequiredAgentKinds` / `OverlayChannel` / overlay role / i18n / icon / card-color / decision_log / read_context / integrity replay / `fact_check_attempt` 持久化 artifact。 |
| §3.2 verdict 映射 prompt-only | 没有可读事实源，LLM 无法稳定知道已查过。v2 加 `fact_check_attempt` artifact + 幂等键 `(target_session_id, latest_assistant_hash)`。 |
| §9 R3/R6 缓解不足 | v2：fact-check core prompt 显式禁止自递归（不许 emit fact-check 标记 / 字段）；orchestrator tool 自带幂等（artifact 命中即返回旧结果）。 |

---

## 0. 背景与动机

现有所有 worker agent（build / requirements / architect / design-analyst / coding / general / intent-analysis / integrity）在输出
时做出大量**未经验证的事实性断言**——API 行为、库版本、错误码、第三方协议字段、性能数字、历史决策、文件路径
等。Integrity 团队（`integrity/team-agent.ts`）只检查"是否满足 acceptance / 是否完整"，**不检查"声明是否属实"**。

需求：

1. 所有用户可见工作 agent 必须**显式登记**自己未验证的事实性断言或待填充项，登记字段写入该 agent 的
   terminal report schema 中。
2. 新增 **fact-check agent**，由 orchestrator 在合适时机调用，检索网络/代码库/记忆，对登记项做核查，
   产出结构化 `verified / corrected / unresolved` 列表。
3. 更正以**新消息**形式回流给 orchestrator（rule 15 — 不改写源消息），orchestrator LLM 决定
   `modify_goal` / `restart_from_stage` / `accept-as-is`。
4. fact-check 结果以 `fact_check_attempt` artifact 形式持久化，被 decision_log / read_context / integrity replay 消费。

## 1. 用户已拍板的 4 项设计决策（v1 沿用）

| 维度 | 选择 |
|---|---|
| Agent 形态 | **新建独立 agent**（不 fork build，不扩展 integrity） |
| 触发时机 | **Orchestrator 决定**（prompt 引导，非 host 状态机） |
| 更正形态 | **独立报告消息 + 回流 orchestrator** + 持久 artifact（源消息 append-only 不动） |
| 覆盖范围 | **所有用户可见工作 agent**（build / requirements / architect / design-analyst / coding / general / intent-analysis / integrity；跳过 orchestrator / control / compaction / title / summary / explore） |

### 1.1 为什么不选 codex 提出的替代方案

| 替代 | trade-off | 决定 |
|---|---|---|
| 复用 integrity team 加 factuality reviewer | 改动小，但 integrity 是**判断式审查**（要不要 pass），fact-check 是**检索式核查**（声明是否属实）——认知形态不同，混在一起会污染 reviewer 单一职责，违反 rule 11 设计模式纪律 | **不采纳** |
| 复用 `acceptance/types.ts` 的 prebuilt `factuality` scorer | 当前只是 schema 字段，无 executor；要写执行器仍需 retrieval-capable agent → 等价于本方案，外加扩展 acceptance 引擎的复杂度 | **不采纳**，但**复用 `factuality` 这个语义槽**作为 fact-check 结果在 acceptance 框架中的呈现位（§6.1 详述） |

---

## 2. CLAUDE.md 规则合规性检查

| Rule | 关切 | v2 如何合规 |
|---|---|---|
| 5 / 6 第一性 / 禁过工 | 不引入超出需求的工具/字段 | 工具集只剩 read/search/web/memory.search.get；fact-check 自己不写 memory；不引入新数据库表，只用既有 `engine_artifact` |
| 6.1 / 11 prompt-over-host | 不在 host 端硬编码"integrity pass → fact-check 必跑"状态机 | Orchestrator core prompt 写决策规则，host 只暴露 `fact_check` 工具，不拦截 |
| 7 / 8 单源 / 禁 fallback | 不允许"老 agent 不登记也行"的兼容路径 | 共享 `FACT_CHECK_REGISTRATION_FRAGMENT` TS 常量，每个 worker 的 prompt builder 单源导入；terminal schema 增字段必填 |
| 10 禁硬编码 | step cap 等参数不硬编码 | step cap 走 agent config 系统默认 |
| 13 禁状态机 | 触发由 orchestrator LLM 决定 | `fact_check` 是 orchestrator tool，LLM 自决调用与否 |
| 14 流式 | fact-check 通过 `runAgentSession` 跑（已流式） | 复用现有 worker agent runtime |
| 15 禁合成 / 隐藏消息 | fact-check 不改写源消息 | 终端 yield 单条 markdown 报告 → 作为 orchestrator 工具结果出现在对话流；artifact 持久化是 evidence channel，不是消息分叉 |
| 16 / 17 禁补丁 / 死代码 | 不留 legacy 路径 | terminal schema 增字段为**必填**（不 optional），rule 18 允许 reset DB；旧 session 不兼容 |
| 18 直接 reset DB | 涉及 schema 改动 | `engine_artifact` 加新 kind 不需要迁移；session 表新增 kind 由 SESSION_KINDS 枚举控制 |
| 19 缩写注释 | FCI 等术语 | spec + 代码注释里说明（FCI = Fact-Check Item，FCA = Fact-Check Attempt） |
| 22 commit + push | 分阶段提交 | §8 实施步骤每步独立 commit |
| 28 / 36 改动配测试 | 每个 touch point 配测试 | §7 测试清单覆盖每个新文件 + 既有文件改动 |
| 35 全仓 grep 穷举 | 影响面调查 | §6 调用点清单经 codex round 1 复核扩充 |

---

## 3. 协议设计（v2 重写）

### 3.1 登记字段：进各 worker 的 terminal report schema

**核心变化**：登记不走 inline XML 标签，走结构化 terminal schema 字段。

**通用字段（FCI = Fact-Check Item）**：

```ts
export const FactCheckItemSchema = z.object({
  claim: z.string().min(20).max(280),
  confidence: z.enum(["low", "medium", "high"]),
  category: z.enum(["api", "library", "number", "history", "path", "protocol", "other"]),
  source: z.string().min(3),                    // "assumed" | "model prior" | "<url>" | "<file:line>" | "user-said:<short>"
})

export const FactCheckItemListSchema = z.array(FactCheckItemSchema).default([])
```

**校验规则**（schema-level 拒绝，**非 host preflight**——CompactionHandoff 已有 `GenericAction` 拒绝模式可借鉴）：
- `claim`：禁包含 `tbd/unknown/n/a/继续/下一步` 这类无信息词（regex 拒绝）
- `source` 禁空字符串
- 待填充占位写法：`claim` 以 `"<待填充：..."` 开头 + `confidence="low"` + `source="assumed"`

**每个覆盖范围内 worker 的 terminal schema 增 `fact_check_items` 字段**：

| Worker | Terminal Schema 文件 | 字段位置 |
|---|---|---|
| build | `build/agent.ts`（BuildResultSchema） | top-level `fact_check_items` |
| requirements | `requirements/types.ts`（推测，待 §6 grep 复核） | 顶层 |
| architect | `architect/types.ts`（推测） | 顶层 |
| design-analyst | `design-analyst/types.ts`（推测） | 顶层 |
| intent-analysis | `intent-analysis/types.ts`（推测） | 顶层 |
| integrity | `integrity/types.ts`（IntegrityTeamReport） | 顶层 |
| coding / general | 无 terminal schema（直接对话） | 用例外 channel：§3.2 |

**例外**：coding / general 不走 terminal schema，没有结构化输出位。两种处理：
- **方案 A**：这两个 agent 用 inline XML 标签（仅这两个例外，因为它们直接对话），fact-check agent 解析 chat text 而非 artifact
- **方案 B**：让 coding/general 不参与"被 fact-check"，因为它们是 ad-hoc 工作模式，输出直接给用户审阅

v2 默认**方案 B**（更简单，rule 5/6 不过度工程）。需用户确认。

### 3.2 Fact-check agent 终端工具：`report_fact_check_result`

参考 `report_build_result` 的契约模式。Schema：

```ts
export const FactCheckReportSchema = z.object({
  scope: z.object({
    target_session_id: z.string(),
    target_agent: z.string(),
    target_message_hash: z.string(),              // sha256 of latest assistant message content (用于幂等)
    items_total: z.number().int(),
    items_inspected: z.number().int(),
  }),
  verified: z.array(z.object({
    claim: z.string(),
    evidence: z.array(z.object({
      kind: z.enum(["web", "code", "memory"]),
      pointer: z.string(),                        // URL / file:line / memory:id
      excerpt: z.string().max(800),
    })).min(1),
  })),
  corrected: z.array(z.object({
    claim: z.string(),                            // 原断言
    correction: z.string(),                       // 修正后的事实
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
```

**Verdict 映射**（fact-check core prompt 中说明，**非 host 拦截**）：
- `clean`：`corrected` 空 + `unresolved` 全 minor
- `minor_corrections`：`corrected` 全 minor + `unresolved` 全 minor
- `needs_orchestrator_action`：`corrected` 含 material/blocking 或 `unresolved` 含 material/blocking
- `inconclusive`：`items_inspected < items_total * 0.5` 且 `corrected` 全 minor 时优先选 inconclusive 而非 clean

### 3.3 持久化：`fact_check_attempt` artifact

参考 `recordIntegrityAttempt`（`integrity/team-agent.ts`）模式。`engine_artifact` 新增 kind：

```ts
export const FactCheckAttemptArtifactSchema = z.object({
  kind: z.literal("fact_check_attempt"),
  fact_check_session_id: z.string(),
  target_session_id: z.string(),
  target_agent: z.string(),
  target_message_hash: z.string(),                // 幂等键的一半
  invoked_by_orchestrator_session_id: z.string(),  // 幂等键的另一半（同一 task 内复用）
  report: FactCheckReportSchema,
  time_started: z.number(),
  time_completed: z.number(),
  outcome: z.enum(["completed", "aborted", "tool_error"]),
})
```

**幂等键**：`(invoked_by_orchestrator_session_id, target_session_id, target_message_hash)`。Orchestrator tool 接到调用：
1. 计算 `target_message_hash`
2. 查既有 `fact_check_attempt` 命中 → 返回旧 report（标记 `cached: true` 在工具响应里）
3. 未命中 → 拉起 fact-check session

被 integrity replay / `read_context` 自然消费（它们都已经在读 artifact stream）。

### 3.4 跨 compaction 持久化

**v1 错改 CompactionHandoff schema 被废弃**。fact-check 项现在活在两个地方：
1. Worker 的 terminal report artifact（已经 append-only 持久）
2. `fact_check_attempt` artifact（同上）

Compaction 是 transcript 压缩，不影响 artifact stream。无需改 compaction-handoff.ts。

---

## 4. 架构与编排（v2 重写）

### 4.1 Fact-check agent 注册

新 agent role：`fact-check`。

| 字段 | 值 |
|---|---|
| Mode | `subagent` |
| Native | true |
| Hidden | false |
| Step cap | 走 agent config 默认（不硬编码） |
| Permission | 默认 allow，受 user config 覆盖 |
| SessionKind | 新增 `"fact-check"` 到 `SESSION_KINDS`（§6.1） |
| runtimeContractRequiredAgentKinds | **不加入**（fact-check 不是 goal-scoped，无 runtime contract） |

### 4.2 工具集（v2 收紧）

```ts
tools: {
  include: [
    "read", "glob", "search_code",            // 代码库只读检索
    "websearch", "webfetch",                  // 网络
    "external_code_search",                   // 第三方 SDK / 文档
    "memory_search", "memory_get",            // 记忆只读
    "todoread", "todowrite",                  // bookkeeping
  ]
}
```

**显式不给**（物理上无法滥用）：
- `edit` / `write` / `merge_back` / git 写操作 → 不能改源消息或交付物
- `bash` → 收紧到只读检索；若未来证明确需 verifier 脚本再放开（rule 5/6）
- `memory_write` / `memory_delete` → fact-check 是核查员不是记忆官；写记忆是 build/orchestrator 的活
- `task_report` / `panel` → 不是用户交付 channel

**终端工具**：`report_fact_check_result`（仅本 agent 拥有，BuildAgent 模式）。

### 4.3 Orchestrator 编排

`orchestrator/tools.ts` 新增 `fact_check` 工具：

```ts
fact_check: tool({
  description: "Run fact-check on the most recent worker output in a target session. Use when (1) integrity verdict=pass AND (2) the worker's terminal report has non-empty fact_check_items OR makes load-bearing factual claims about external systems. Tool is idempotent: same (target_session_id, latest_assistant_hash) returns cached report.",
  inputSchema: z.object({
    target_session_id: z.string(),               // 被核查 worker session（不传 message_id）
    target_agent: z.string(),                    // "build" | "architect" | ...
    reason: z.string().min(10),                  // LLM 必须解释为何调用
  }),
  execute: async (input, ctx) => {
    const { FactCheckAgent } = await import("@/fact-check")
    const result = await FactCheckAgent.run({
      targetSessionID: input.target_session_id,
      targetAgent: input.target_agent,
      reason: input.reason,
      orchestratorSessionID: ctx.sessionID,
      signal: ctx.signal,
      onSessionCreated: (id) => { /* overlay routing */ },
    })
    return renderFactCheckMarkdown(result)        // result 含 cached: bool
  }
})
```

加入 orchestrator 白名单（agent.ts orchestrator info.tools.include）。

### 4.4 Orchestrator core prompt 增量

`prompt/core/orchestrator-core.txt` 增加一节：

```
## Fact-check dispatch (rule 13: you decide, not the host)

After integrity verdict = pass, you MAY (not MUST) call `fact_check` on a worker session when ALL hold:
1. The worker's terminal report has `fact_check_items.length > 0`, OR the worker's narrative makes
   load-bearing factual claims about external systems (APIs, library versions, third-party protocols, numbers).
2. The downstream consumer (user / next stage) would be materially misled by an incorrect claim.

Idempotency: The tool caches results by (target_session_id, latest_assistant_hash). Calling twice
with no upstream change returns the same report — you do NOT need to track "already checked".

Do NOT call fact_check:
- For trivial / opinion / preference outputs.
- When integrity verdict ≠ pass — fix integrity findings first.

After fact_check returns:
- verdict=clean → proceed.
- verdict=minor_corrections → quote corrections in your next user-facing message, proceed.
- verdict=needs_orchestrator_action → invoke modify_goal / restart_from_stage / fail_task per
  the corrected[i].recommended_action.
- verdict=inconclusive → either retry fact_check (after addressing why_unresolved) or proceed with
  caveat note.
```

---

## 5. Prompt 注入：单源共享片段（v2 重写）

### 5.1 共享 TS 常量

**新文件**：`packages/opencorvus/src/prompt/fragments/fact-check-registration.ts`

```ts
export const FACT_CHECK_REGISTRATION_FRAGMENT = `
## Fact-check item registration

Before calling your terminal report tool, populate \`fact_check_items[]\` with any factual claim
in your output that you have NOT directly verified via tool calls in this session, AND any
placeholder for information you do not have.

Each item:
- \`claim\`: full standalone assertion (≥20 chars, ≤280 chars). No generic words like "tbd",
  "unknown", "n/a", "continue", "next step".
- \`confidence\`: low | medium | high (self-assessment).
- \`category\`: api | library | number | history | path | protocol | other.
- \`source\`: where you got it. "assumed" | "model prior" | "<url>" | "<file:line>" |
  "user-said:<short>". Empty string is REJECTED.

Placeholders: claim="<待填充：...>" + confidence="low" + source="assumed".

DO NOT register: opinions, preferences, plans, your own decisions, tool-call results you observed
in this session, contents of files you read in this session.

This list is consumed downstream by an independent fact-check agent. Being honest about
uncertainty is rewarded; over-claiming verified-ness will be flagged as a violation in fact-check.
`.trim()
```

### 5.2 各 worker 的 prompt 组装

每个覆盖 worker 的 prompt builder（如 `composeBuildCore` in `build/agent.ts`）末尾追加 import 与拼接：

```ts
import { FACT_CHECK_REGISTRATION_FRAGMENT } from "@/prompt/fragments/fact-check-registration"
import BUILD_CORE from "@/prompt/core/build-core.txt"

export function composeBuildCore(autoIteration: boolean): string {
  return [
    BUILD_CORE,
    // ... existing fragments ...
    FACT_CHECK_REGISTRATION_FRAGMENT,
  ].join("\n\n")
}
```

**单源原则**：常量只此一份；改文案只改 fragments/fact-check-registration.ts。
**覆盖范围控制**：只在 §1 覆盖名单的 worker 的 prompt 组装函数中导入。fact-check agent 自己**不**导入（防自递归）；compaction/title/summary/orchestrator/control 不导入。

### 5.3 fact-check core prompt 的反向规则

`prompt/core/fact-check-core.txt` 显式声明：

```
You are a fact-check agent. You verify factual claims; you do NOT make new factual claims.

You MUST NOT:
- Emit fact_check_items in your own terminal report (self-recursion forbidden).
- Use <fact-check> tags in chat text.
- Speculate beyond what evidence supports — if uncertain, classify as "unresolved" with
  why_unresolved set.

Every `verified` and `corrected` item MUST cite at least one `evidence` entry with a concrete
pointer (URL / file:line / memory:id) and excerpt.
```

`report_fact_check_result` schema 本身不含 `fact_check_items` 字段——schema-level 防递归（rule 8 单源，schema 是约束源）。

---

## 6. 影响面 / 调用点清单（v2 扩充，rule 35 全仓 grep 复核）

> ⚠️ 标 `[codex round 1 补充]` 的是 v1 漏掉、codex 指出后核实的。

### 6.1 必改文件

| 文件 | 改动 | 状态 |
|---|---|---|
| `packages/opencorvus/src/agent/role-contract.ts` | AgentRoleID 加 `"fact-check"` + contract 配置 | v1 已列 |
| `packages/opencorvus/src/agent/agent.ts` | 注册 fact-check Info + NATIVE_DEFAULTS + orchestrator info.tools.include 加 `fact_check` | v1 已列 |
| `packages/opencorvus/src/prompt/core/fact-check-core.txt` | 新文件 | v1 已列 |
| `packages/opencorvus/src/prompt/fragments/fact-check-registration.ts` | **新文件**：FACT_CHECK_REGISTRATION_FRAGMENT 常量 | **[codex round 1 补充]** v2 新增 |
| `packages/opencorvus/src/fact-check/index.ts` | 新文件，`FactCheckAgent.run` 实现 | v1 已列 |
| `packages/opencorvus/src/fact-check/tools.ts` | 新文件，terminal tool 与 schema | v1 已列 |
| `packages/opencorvus/src/fact-check/persist.ts` | 新文件，`fact_check_attempt` artifact 读写 + 幂等查询 | **[codex round 1 补充]** v2 新增 |
| `packages/opencorvus/src/orchestrator/tools.ts` | 注册 `fact_check` tool（含幂等查询逻辑） | v1 已列 |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt` | 新增 §Fact-check dispatch | v1 已列 |
| `packages/opencorvus/src/session/session.sql.ts` | `SESSION_KINDS` 加 `"fact-check"` | **[codex round 1 补充]** |
| `packages/opencorvus/src/session/loop.ts` | `runtimeContractRequiredAgentKinds` **保持不变**（fact-check 不需要 runtime contract，理由 §4.1） | **[codex round 1 补充]** 显式不改也要说明 |
| `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts` | `OverlayChannel` 路由覆盖新 SessionKind（按既有模式） | **[codex round 1 补充]** |
| `packages/opencorvus/src/build/agent.ts` | BuildResultSchema 加 `fact_check_items: FactCheckItemListSchema`；`composeBuildCore` 注入 fragment | **[codex round 1 补充]**（v1 §3.2 只提了通用，未列具体文件） |
| `packages/opencorvus/src/requirements/types.ts`（实际路径待 implementation grep 复核） | 同上模式 | **[codex round 1 补充]** |
| `packages/opencorvus/src/architect/types.ts` | 同上模式 | **[codex round 1 补充]** |
| `packages/opencorvus/src/design-analyst/types.ts` | 同上模式 | **[codex round 1 补充]** |
| `packages/opencorvus/src/intent-analysis/types.ts` | 同上模式 | **[codex round 1 补充]** |
| `packages/opencorvus/src/integrity/types.ts`（IntegrityTeamReport） | 同上模式 | **[codex round 1 补充]** |
| `packages/opencorvus/src/decision-log/...`（路径待复核） | 写入 fact-check 事件到 decision_log | **[codex round 1 补充]** |
| `packages/opencorvus/src/orchestrator/tools.ts`（`read_context` 实现处） | 让 read_context 渲染 fact_check_attempt 给 orchestrator 看 | **[codex round 1 补充]** |
| `packages/opencorvus/src/integrity/...`（replay 路径） | integrity replay 能读到 fact_check_attempt artifact | **[codex round 1 补充]** |
| `packages/opencorvus/src/config/schema.ts` | agent 配置允许 fact-check 覆盖 prompt/model/tools/step_cap | v1 已列 |
| **Overlay 前端**：`packages/overlay/src/utils/message.ts` | SessionKind 路由 +「fact-check」角色映射 | **[codex round 1 补充]** |
| `packages/overlay/src/components/Avatar.tsx` | fact-check 角色头像 | **[codex round 1 补充]** |
| `packages/overlay/src/components/Icon.tsx` | fact-check 角色图标 | **[codex round 1 补充]** |
| `packages/overlay/src/utils/card-color.ts` | fact-check 卡片配色 | **[codex round 1 补充]** |
| `packages/overlay/src/i18n/en-US.json`、`zh-CN.json` | fact-check 文案 | **[codex round 1 补充]** |
| `packages/overlay/src/utils/markdown.ts` / `TextPart.tsx`（按需） | v1 错以为要渲染 inline 标签；v2 不再用 inline，**不改** | **[codex round 1 补充]** 显式不改说明 |

### 6.2 测试新增

| 测试文件 | 覆盖 |
|---|---|
| `packages/opencorvus/test/fact-check/agent.test.ts` | `run()` happy / corrected / unresolved / inconclusive / cached-hit / cancel-mid-run / tool-error 七 case |
| `packages/opencorvus/test/fact-check/schema.test.ts` | FactCheckItemSchema 拒绝 generic 词 + FactCheckReportSchema 边界 + verdict 映射 |
| `packages/opencorvus/test/fact-check/persist.test.ts` | `fact_check_attempt` artifact 读写 + 幂等键命中 |
| `packages/opencorvus/test/agent/role-contract.test.ts`（扩展） | 新 role 加入后契约自洽 + `agentKindRequiresRuntimeContract("fact-check") === false` |
| `packages/opencorvus/test/orchestrator/tools.test.ts` | `fact_check` 工具 input schema + dispatch + 幂等查询 + 错误传播 |
| `packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts` | description 含关键词（rule 13 合规检查） |
| `packages/opencorvus/test/build-agent/contract-error.test.ts`（扩展） | BuildResultSchema 增加 fact_check_items 字段后 contract test |
| `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`（扩展） | fact-check-core.txt hygiene + 反向：不含 `<fact-check>` 标签字面 + 不含 fact_check_items 字面（防自递归） |
| `packages/opencorvus/test/prompt/fact-check-fragment.test.ts`（新） | FACT_CHECK_REGISTRATION_FRAGMENT 含必需短语 + 反向：禁止短语不出现 |
| `packages/opencorvus/test/prompt/worker-prompt-composition.test.ts`（新） | 各 worker 的 prompt builder 输出含 fragment / fact-check 自己的 builder 不含 |
| `packages/opencorvus/test/session/session-kinds.test.ts`（扩展或新） | `SESSION_KINDS` 含 `"fact-check"` |
| `packages/opencorvus/test/orchestrator/orchestrator-no-auto-dispatch.test.ts`（新） | 反向：当 worker 输出 fact_check_items 为空时，orchestrator LLM 决定不调 fact_check（验证 LLM 决策能力，非 host 拦截） |

### 6.3 全仓 grep 复核 token

实施前 grep 并审视：
- `fact-check`, `factcheck`, `FactCheck`, `事实核查`
- `verify`, `verifier`, `verification`（避免与 `verification/` 模块语义混淆）
- `factuality`（acceptance/types.ts 已存在的预制 scorer 名）
- `<fact-check`（防止 v1 实验残留）
- 各 worker terminal schema 文件实际路径（`Requirements*Schema`, `Architect*Schema`, `Integrity*Report` 等）

---

## 7. 测试策略（rule 28 / 36）

### 7.1 单测

每个 §6.2 列项含 ≥3 case：happy / 边界 / 反向（禁项不存在）。

### 7.2 集成 / e2e

- **e2e A**：build worker terminal report 含 fact_check_items → integrity pass → orchestrator 调用 fact_check → corrected blocking → recommended_action=modify_goal → orchestrator 据此调用 modify_goal。
- **e2e B 反向**：worker 输出 fact_check_items 为空 → orchestrator 决定**不**调 fact_check（验证 LLM 决策，**非 host 拦截**）。
- **e2e C 幂等**：连续两次同参数 fact_check 调用 → 第二次返回 cached=true 且 0 LLM token 消耗。
- **e2e D cancel**：fact_check 跑到一半 task cancel → signal 传播 → artifact outcome="aborted"。
- **e2e E tool 失败**：websearch / webfetch 全失败 → fact_check 返回 verdict=inconclusive + unresolved 全 `why_unresolved="tool_failed"`，**不**伪造 evidence。

### 7.3 Prompt hygiene

`core-prompt-hygiene.test.ts` 规则集扩展到 fact-check-core.txt + fragment。

---

## 8. 实施步骤（每步独立 commit + push，rule 33）

> 顺序按 codex round 1 建议调整：先协议入口（SessionKind / 持久化 schema），再 agent，再 orchestrator，UI 早做。

1. **Spec 落盘**（本文件 v2）→ codex round 2 评审 → v3 等。Commit: `docs(specs): add fact-check agent design (v2)`.
2. **SessionKind + 持久化 schema 骨架**：`SESSION_KINDS` 加 `"fact-check"` / `engine_artifact` 加 `fact_check_attempt` kind / `FactCheckAttemptArtifactSchema`。Commit: `feat(session): register fact-check session kind`.
3. **Overlay UI 骨架**：role mapping / Avatar / Icon / card-color / i18n。先放 placeholder UI，给 SessionKind 落 channel。Commit: `feat(overlay): register fact-check role surface`.
4. **共享 fragment + 各 worker schema 加 fact_check_items**（build / requirements / architect / design-analyst / intent-analysis / integrity） + 测试。Commit: `feat(prompt): single-source fact-check registration fragment`.
5. **Fact-check agent 注册骨架**：role-contract / agent.ts / NATIVE_DEFAULTS / fact-check-core.txt 占位 / 实现 stub + 测试。Commit: `feat(agent): scaffold fact-check agent`.
6. **Terminal tool + report schema** + persist 模块（幂等查询） + 测试。Commit: `feat(fact-check): add report tool + idempotent persist`.
7. **FactCheckAgent.run 实现**（toolKit 组装 + runAgentSession 调用 + 输出解析 + cancel 路径）+ 测试。Commit: `feat(fact-check): implement agent runtime`.
8. **Orchestrator tool 接入**（含幂等命中分支）+ orchestrator-core prompt + read_context 让 fact_check_attempt 可见 + 测试。Commit: `feat(orchestrator): expose fact_check dispatch + read_context integration`.
9. **decision_log 写入 + integrity replay 读取** + 测试。Commit: `feat(decision-log): record fact-check outcomes for integrity replay`.
10. **e2e A-E 五场景** + smoke。Commit: `test(fact-check): end-to-end orchestrator + cancel + idempotency`.
11. 删除草稿、更新文档、commit 最终版。Commit: `docs: finalize fact-check agent spec`.

---

## 9. 已识别风险

| 风险 | 缓解 |
|---|---|
| **R1**：各 worker terminal schema 同步改动多文件，单源原则可能因疏漏破裂 | 通过 `prompt/fragments/fact-check-registration.ts` + 中央 `FactCheckItemListSchema` 双重单源；CI 测试遍历 worker 列表确认每个都引入 |
| **R2**：fact-check 自递归（自己输出含 fact_check_items） | 双重防御：(a) `report_fact_check_result` schema 无 fact_check_items 字段（schema-level 拒绝）；(b) fact-check-core.txt 显式 forbid（prompt-level 拒绝） |
| **R3**：Orchestrator LLM 不调用 fact_check / 反复调用 | (a) 反复调用由 artifact 幂等键自动去重；(b) 不调用属 LLM 决策能力问题，靠 orchestrator-core prompt 引导 + e2e 反向 case 验证，不做 host 兜底 |
| **R4**：worker LLM 不填 fact_check_items / 乱填 | (a) Schema-level 拒绝 generic 词；(b) fact-check 跑出 corrected 项时给 recommended_action="modify_goal"，下次 build 会读到 integrity feedback，迭代学到要登记；(c) prompt hygiene 测试反向覆盖 |
| **R5**：tool 失败时 fact-check 报伪 evidence | core prompt 显式规则 + schema 强制每个 verified/corrected 必须有 ≥1 evidence pointer + e2e E case 验证 |
| **R6**：cancel 没清理 ownership / 留 orphan artifact | (a) 复用 BuildAgent 的 signal 传播 + Ownership 模式；(b) artifact `outcome` 字段标 "aborted" 而非"completed"，read_context 据此处理 |
| **R7**：取代 integrity 的疑虑 | 明确分工：integrity = "是否满足 acceptance / 完整性"，fact-check = "声明是否属实"。fact-check-core.txt §0 + 用户文档说明 |
| **R8**：external executor（codex / claude-code）模式下 fact-check 如何工作 | v1 仅覆盖 opencorvus native；外部 executor 不强制 fact_check_items 字段（schema 在 terminal 处只对 native 强制）；写入 spec 已知限制 |
| **R9**：旧 session 反序列化失败（terminal schema 字段从 optional 升 required） | 按 rule 18 直接 reset DB；DB 不做兼容；spec 记录此为已知 breaking change |
| **R10**：overlay UI 骨架不放可能漏入 channel | §8 step 3 提前到 step 5 之前；e2e 中确认 SessionKind 不落空 |

---

## 10. 已确认架构决策

> 这些是 codex round 1 已澄清、本轮不再争议的：

1. **形态**：新建独立 agent（用户钦定，§1.1 已驳回 codex 替代方案）。
2. **登记 channel**：terminal report schema 字段，不用 inline XML。
3. **触发**：orchestrator LLM 决定（rule 13），host 不拦截，但 artifact 提供幂等。
4. **更正形态**：独立 fact-check session yield 一条 markdown + 持久 artifact；源消息不动。
5. **覆盖范围**：build / requirements / architect / design-analyst / intent-analysis / integrity；coding / general 暂排除（§3.1 方案 B），需用户复核。

---

## 11. 待 codex round 2 复核

请 codex 重点回答：

1. **§3.1 方案 B（coding / general 不参与）是否合理？**Codex 自己提到 fact-check 应"覆盖每个 worker 产物"——coding / general 没有 terminal schema，要么例外，要么也加 inline XML 标签。哪个更合规？
2. **§3.3 幂等键 `target_message_hash` 的取值**：fact-check session 是 sub-agent，被核查的 target session 可能在 fact-check 跑时仍在变（罕见但可能）。如何稳定 hash？建议：fact-check 启动瞬间 snapshot latest assistant message id + hash。
3. **§6.1 触点清单是否还有遗漏？**特别是：
   - decision_log 实际写入接口？
   - read_context 渲染 artifact 的实际位置？
   - integrity replay 路径具体在哪？
4. **§5.2 各 worker prompt builder**：有些 worker（requirements/architect 等）是不是没有 `composeXxxCore()` 函数，而是直接 `import XXX_CORE`？那 fragment 怎么注入？
5. **§6.2 测试目录约定**：`test/fact-check/` 是不是 opencorvus 包内惯例？还是该走 `test/agent/fact-check/`？
6. **新引入的 schema 改动**：BuildResultSchema 加必填字段会破坏既有 build session 的反序列化吗？rule 18 直接 reset DB 是不是合适？
7. **§4.4 orchestrator prompt 中"latest_assistant_hash"措辞**：LLM 看到这个概念会困惑吗？是否需要改为对 LLM 友好的措辞（"the tool dedupes automatically, just call when relevant"）？

---

（v2 结束。等待 codex round 2 评审。）
