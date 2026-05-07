# Build Missing-Terminal Signal Restore (Spec B8 Compliance)

**日期**: 2026-05-07
**状态**: 实施中
**触发**: live task `tsk_e0033e523001flSn0onlHh4Urh`（聊天UI项目）连续 5 次 build attempt 同形态失败，模型每次写完 13+ 组件文件后用 markdown "## Completed Work" 结束 turn 而非调 `report_build_result`。每个 attempt 收到几乎一字不差的 33k 字符 user prompt，无任何 retry 信号。

## 0. 术语

- LLM: Large Language Model.
- B8: spec `architecture-rework-loosening-plan-2026-05-06.md` 的第 8 号决议项 —— 保留 `missing_terminal_report` 作为显式 typed error。
- B10: 同 spec 第 10 号决议项 —— 删除 build agent 的 same-session recovery loop，让 orchestrator LLM 决定是否重开 build。
- mirrorcode: in-process build executor（默认）；与 codex / claude-code 等 external executor 区分。

## 1. 现象（DB 实证）

| Attempt | Session | 失败时刻 (UTC) | LLM 末尾文字（前缀） |
|---|---|---|---|
| 1 | kKhTFAU2 | 03:09:02 | "Based on the session state and test results... ## Completed Work **All Chat UI Components Implemented (14 components)**..." |
| 2 | plUaQQL8 | 03:38:58 | "## Summary of What Has Been Done So Far..." |
| 3 | szsV82Zg | 03:52:28 | "## 进度总结 ✅ 已完成的工作..." |
| 4 | CxleVvPD | 04:18:58 | "## Completed Work **Components Created (13 total)**..." |
| 5 | 2VoXT37n | 04:19→ 死循环中 | — |

每次 attempt 的 user prompt 字数：32308 / 33407 / 33412 / 33763 / 33243 字符——内容近似一字不差。`AgentRunError: TerminalToolMissingError: Model did not call terminal tool report_build_result before the turn ended (finish=stop)` 是统一失败签名。

orchestrator 24 次 build 调用：23 次 `request=""`；orchestrator LLM **能**正确诊断失败原因（`reason` 字段写满 "MUST call report_build_result at end" 等提示），但 reason 是局部审计字段，**不传到 build agent**。

decision_log 40 行里 0 条 `key=build_agent_contract_violation`；同期 4 条 `key=retry_analysis_<goalID>` 全部由 `modify_goal` 工具写入，内容是通用模板"Goal contract changed... re-read acceptance_specs"——**与 missing_terminal 失败无关的污染信道**。

## 2. 根因（dead code unreachability + 信道断裂）

**Layer 1 — dead code unreachability**：
`build/agent.ts:588-693` 的 `try { ... } finally { }` **没有 catch 块**。`runAgentSession`（line 590）在模型未调 terminal tool 时由 `loop.ts:1343` stamp `Message.TerminalToolMissingError`，再由 `runner.ts:342` `buildHardErrorFromFinalMessage` 包成 generic `AgentRunError`（**类型擦除**：原始 err 没作为 cause 挂上）抛出。AgentRunError 直接穿过 finally 离开 `BuildAgent.run`，**永远到不了 line 695 的 `if (!parsed || !parsed.success)` 检查**——line 704-714 的 `if (executor === "mirrorcode") throw new BuildAgentContractError("missing_terminal_report", ...)` 是完全 dead code。

orchestrator/tools.ts:4742 的 `if (runErr instanceof BuildAgentContractError)` 永远 false → line 4776 的 `decisionLog.append({phase: "retry", key: "build_agent_contract_violation", ...})` 写入路径**永远不执行**。

**Layer 2 — orchestrator LLM 错位响应**：
orchestrator LLM 看到失败后，唯一可用的"重试信道"是 build tool 的 `request` 字段。但 `tools.ts:4544` 让 `requestText` **替换** `goal.objective`：

```ts
objective: requestText.length > 0 ? requestText : goal.objective,
```

LLM 不敢填 `request`——填了等于丢失 architect 决议。它选了"变通"路径——调 `modify_goal` 改 acceptance_specs。`modify_goal` 通过 `startNewAttempt({ feedback })` 写 phase=retry decision_log entry，模板是固定的"Goal contract changed..."（`tools.ts:2496-2499`），**与 missing_terminal 完全无关**。

**Layer 3 — modify_goal no-op 不被识别**：
`tools.ts:2453` `contractChanged = contractFields.some(f => f in setValues)` 只看字段是否**出现**在 `setValues`，不比较实际值。orchestrator LLM 用同样的 acceptance_specs 调 modify_goal 也算 contract change，触发 statusReset + retry feedback 写入——**信道被无意义内容污染**。

## 3. spec 合规性

**B8 当前被静默违反**：
B8 明确说"保留 `missing_terminal_report`（agent 没调 terminal tool 必须抛错，否则消息没传出来）"。当前 `agent.ts:705` 看似在抛，实际上**runAgentSession 总是先抛 AgentRunError**，那段永不执行——B8 的语义被代码假装满足实则未满足。本 spec 的修复**恢复** B8，不是引入新行为。

**B10 不被本修复改动**：
B10 删除了同 session 内 3-turn recovery loop，决议是"missing_terminal_report 直接作为显式失败消息回传 orchestrator；orchestrator LLM 决定是否再开 build"。本修复**保留** B10 的方向——不在 build session 内自救——但修复 B10 隐含前提（orchestrator LLM 能拿到结构化失败信号 + 能传递给下次 build agent）的实际可达性。

## 4. 穷举调用点（rule 35）

```text
runAgentSession 调用者：
  src/architect/agent.ts:127     — 单次
  src/build/agent.ts:590         — 单次（本次修复对象）
  src/design-analyst/agent.ts:86 — 单次
  src/intent-analysis/agent.ts:71 — 单次
  src/requirements/agent.ts:94   — 单次
  src/prosecutor/agent.ts:330    — 单次

runAgentSessionWithRetry 调用者（带 nonRetryable 短路）：
  src/delivery/agent.ts:108      — 唯一

→ build 走单次 runAgentSession，B2 codex BLOCKING（"运行时被 with-retry 透明重试"）当前不存在。
  仍设 nonRetryable=true 防御未来切到 with-retry 时的回归。

BuildAgentContractError 调用点：
  定义: src/build/types.ts:156（保留）
  抛出: src/build/agent.ts:705（dead code，本次删除）
       新增: src/build/agent.ts:587-693 try { } catch（本次新增；唯一抛出点）
  catch: src/orchestrator/tools.ts:4742（保留，识别逻辑不变）

decision_log phase="retry" 写入点：
  src/engine/persist.ts:786       — startNewAttempt({ feedback }) 单一入口
  src/orchestrator/tools.ts:4777  — orchestrator catch 直接 append（保留；写入条件未变）

startNewAttempt({ feedback }) 调用者：
  src/orchestrator/tools.ts:2491  — modify_goal（feedback 为 modify 模板，本次条件收紧）
  src/orchestrator/tools.ts:3591  — restart_from_stage（feedback 由调用者构造）
  src/orchestrator/tools.ts:3814  — delivery_rework / build_retry / manual_retry 路径
  → 后两类调用点本次 PR 不动，scope gap 在 spec 5 节标注。

BuildContext 消费者：
  src/build/agent.ts buildUserPrompt（line 1820+ goal-path、line 2013+ request-path）
  → 双 renderer 都需要新字段 retryGuidance 的渲染分支。

build tool input schema 的 request 字段消费者：
  src/orchestrator/tools.ts:4544  — 当前替换 goal.objective（本次修复）
  src/orchestrator/tools.ts:4653  — request-path target.text（不变）
```

## 5. 修复方案

### 5.1 信号传递修复（rule 8 单源恢复）

**`runner.ts:342` `buildHardErrorFromFinalMessage`**：

- 把原始 `err` 通过 `cause` 挂到 `AgentRunError`（ECMAScript 标准 `ErrorOptions.cause`）。
- 当 `Message.TerminalToolMissingError.isInstance(err)` 时，`nonRetryable=true`（确定性失败，retry 无意义；防御未来切到 `runAgentSessionWithRetry` 的回归）。

**`build/agent.ts:587-693` try 上加 catch 块**：

- 识别 `runErr instanceof AgentRunError && Message.TerminalToolMissingError.isInstance(runErr.cause)`
- 转抛 `BuildAgentContractError("missing_terminal_report", { sessionID, lastMergeBackOutcome }, "<recovery hint>")`
- 其他错误原样 re-throw。

**删除 `build/agent.ts:704-714` dead code 分支**：保留 line 721 的 external executor generic Error throw（针对 external 返回 BuildResult schema 不匹配的真实场景）。

**`orchestrator/tools.ts:4769-4789` decision_log entry value 改用 `runErr.message`**（rule 8 单源 — recovery hint 文本归 `convertMissingTerminalToolError` 单一所有），entry reason 退化为审计 metadata。recovery hint 实际实施措辞（避开 visible-brief-hygiene 禁止字符串列表）：

```text
"Previous build session ended with finish=stop without producing the terminal
 build report. Files already written to the goal worktree by prior attempt(s);
 this turn MUST read/glob what is there and complete the build per the standard
 build-agent contract (structured terminal report, not turn-final prose)."
```

措辞要点：描述失败 FACT + 反指 BUILD_CORE 协议（"standard build-agent contract"）+ 反指 prose 行为，**不内联** prompt 协议文本（如 "call report_build_result exactly once" / "DO NOT write a markdown summary"）—— `test/agent/visible-brief-hygiene.test.ts` 强制 worker agent source files 不得复制 prompt 措辞。

### 5.2 信道还原（拆 objective ↔ retryGuidance）

**`orchestrator/tools.ts:4544`**：`objective` 永远来自 `goal.objective`，移除"requestText 覆盖"分支。

**`build/agent.ts BuildContext`**：新增 `retryGuidance?: string` 字段（语义：orchestrator LLM 在 retry 时希望传给下次 build agent 的自由文本）。

**`build/agent.ts buildUserPrompt` 双 renderer**：
- goal-path（line 1820+）：在 retryFeedback 区块**之前**渲染 `## Retry Guidance From Orchestrator` + retryGuidance。位置选择：retryGuidance 是 orchestrator LLM 的 first-class instruction，应早于 retryFeedback（来自历史 attempt）。
- request-path（line 2013+）：相同 heading + retryGuidance；位置同样早于 retryFeedback。

**`orchestrator/tools.ts:4297-4307` build tool description**：
- 修订措辞：`request` 是**附加 retry guidance**，**不替换 goal contract**。retry / rework 时**应该**填，填了不会丢失 architect 决议。

### 5.3 modify_goal no-op 收紧（S1）

**`orchestrator/tools.ts:2453`**：`contractChanged` 改为深比较——遍历 `setValues` 的每个 contract field，仅当 `JSON.stringify(updates[f]) !== JSON.stringify(goal[f])` 时计入 changed。

效果：
- orchestrator LLM 用同值调 modify_goal 不再触发 statusReset / retry feedback 写入。
- modify_goal 退化为对实际无效操作的 no-op，避免污染 retry 信道。

### 5.4 测试（rule 28/36）

| 测试文件 | 断言 |
|---|---|
| `test/agent/runner-hard-error-propagation.test.ts`（扩展） | `buildHardErrorFromFinalMessage` 在 TerminalToolMissingError 输入下：返回 AgentRunError、`nonRetryable=true`、`cause` 是原始 TerminalToolMissingError；其他 isRetryable=false / true / 无 flag 路径不回归 |
| `test/build-agent/contract-error.test.ts`（扩展） | `convertMissingTerminalToolError`：AgentRunError(cause=TerminalToolMissingError) → BuildAgentContractError；非匹配 cause → null；非 AgentRunError → null；非 Error → null。recovery hint 文本断言：含 "terminal build report" / "standard build-agent contract" / "structured terminal report" / "not turn-final prose"，**不含** "re-read acceptance_specs"（modify_goal 模板）和 "call report_build_result exactly once"（visible-brief 禁止字符串） |
| `test/build-agent/prompt-context.test.ts`（扩展） | retryGuidance 字段存在时，goal-path / request-path renderer 都渲染 `## Retry Guidance From Orchestrator` 区块且位置在 retryFeedback 之前；retryGuidance 不影响 target.objective；空 / 空白 retryGuidance 被 drop |
| `test/orchestrator/modify-goal-noop.test.ts`（新增） | `computeContractFieldChanges` 深比较：updates 全等于 goal → 空 setValues；string / array / 重排 / undefined / 未识别字段 / 数组增删 / priority enum 等场景全覆盖 |

注：原 §5.4 列表里的 `test/orchestrator/build-feedback-context.test.ts` 在实施时改为 `test/build-agent/contract-error.test.ts` 内 pin —— `convertMissingTerminalToolError` 是 recovery hint 的单源（rule 8），断言它的输出等价于断言 orchestrator catch path 写入的 decision_log entry value（catch 直接传 `runErr.message`）。

## 6. scope gap（本 PR 不修，记录待办）

按 codex review，以下调用点同形态信道污染风险存在但本 PR 不动：

- **delivery_rework / manual_retry / build_retry**（`orchestrator/tools.ts:3814` 等 startNewAttempt 调用点）：feedback 字段是 optional，传空时下次 build 收到的 retry section 是空字符串——LLM 看到的就是"没失败信号"。这条路径与本 task 的 missing_terminal 死循环不同形态，但有同样的"信道形似存在实质丢失"风险。建议后续单独 spec 审计每个 callee 的 feedback 写入策略。
- **orchestrator `reason` 字段渲染进 build prompt**：current orchestrator LLM 已经能写出"必须调 report_build_result"等准确诊断到 reason，但 reason 永不出仓。后续可考虑在 buildUserPrompt 加 `## Orchestrator Note` 区块自动注入 reason——本 PR 不引入避免范围扩散。
- `BuildAgentContractError` 当前唯一 code 是 `missing_terminal_report`。type 设计支持未来扩展（如 `merge_back_blocked`，已被 B8 删除），但本 PR 不新增 code。

### 6.1 后续 PR：missing_terminal 降级到 integrity review（路径 C，用户提议）

用户在本 PR 实施过程中提出更深一层的洞察：**模型已经写完了 13+ 组件文件、跑过测试、在 markdown 里写了完整总结；唯一缺的是 tool call 形式的报告。在产物实质完成的情况下，重试本身浪费 token——只有"完整性问题"（产物缺失 / 测试失败 / merge_back 失败）才该真正返工。**

设计方向（独立 spec/PR）：
- orchestrator 收到 `BuildAgentContractError("missing_terminal_report")` 时不直接当 fail，不写 phase=retry 重开 build；而是
- 直接把 worktree git diff + prose summary + bash history 喂给 integrity reviewer
- 让 reviewer LLM 决定 `passed` / `needs_correction` / `failed`
- 与 rule 13（让 LLM 决定状态）契合，与 B10 立场（不在 build session 内自救）兼容

本 PR 是路径 C 的前置——typed BuildAgentContractError 信号、retryGuidance 字段、modify_goal no-op 检测都是路径 C 让 reviewer 拿到准确失败信号的必要条件。

### 6.2 后续清理（codex 二审 SHOULD-FIX 中不在本 PR 处理的项）

- **集成 smoke 测试**：mock `runAgentSession` 抛 `AgentRunError(cause=TerminalToolMissingError)` → 断言 `BuildAgent.run` 转抛 `BuildAgentContractError`。当前两端 unit test 已 pin，中间 wiring 4 行直观，不加；wiring 出 bug 时再补。
- **modify_goal execute 层级 return-string 断言**：`computeContractFieldChanges` helper 已 12 case 覆盖；execute 拼 string 是 pure 操作。

### 6.3 预存测试失败（与本 PR 无关）

跑 `bun test packages/opencorvus/test/agent/ test/build-agent/ test/session/` 时观察到 7 个预存失败：

- `core-prompt-hygiene.test.ts:69 / :89` — 期望 `tools.ts` 含 `"architecture_review_rework"`，但 commit `87541e5cb refactor(orchestrator,build,integrity,delivery): tear out post-build review state machine` 删除了该字符串而测试未同步。
- 5 个 `defaultModel` 类失败 (`session/compaction.test.ts`, `session.prompt missing file`, `wake injects ...`) — `MissingModelConfigError`，环境 `opencorvus.jsonc` 未配置 `model`。

经核实这 7 个失败在本 PR 改动前已存在；本 PR 不修以避免范围扩散，但应被列入后续清理 PR。

## 7. CLAUDE.md 合规性 self-check

- **Rule 1（思考本质）**：诊断从 5 次同形态失败追到 dead code unreachability + 信道断裂双层根因，未做任何关键字补丁。
- **Rule 7（无 fallback）**：本修复不引入 same-session recovery loop（B10 立场不变），仅恢复结构化失败信号 + 修整信道实际可达性。
- **Rule 8（单源）**：`BuildAgentContractError` 抛出移到 catch 块单一处，删除原 dead code；reason 模板单一处定义。
- **Rule 13（无状态机）**：本修复完全 LLM-driven——orchestrator LLM 读 retry section 决定下一步（modify_goal / build / fail_task）；host 不做任何状态推进。
- **Rule 32（方案落盘）**：本文件即落盘方案。
- **Rule 35（穷举调用点）**：第 4 节穷举完毕。
- **Rule 36（每改动配测试）**：第 5.4 节列测试矩阵。

## 8. codex 审查反馈（rule 35）

本方案接受了 codex 全部 BLOCKING：

- **B1（dead code 单源）**：采纳，删除 `agent.ts:704-714`；新 catch 块为 `BuildAgentContractError` 唯一抛出点。
- **B2（with-retry 透明重试）**：当前 build path 不走 with-retry，B2 不可触发；仍按 codex 建议设 `nonRetryable=true` 防御未来回归。
- **B3（双 renderer 拼接对称性）**：retryGuidance 字段语义统一为"裸内容，renderer 自加 heading"，避免重复 retryFeedback 历史包袱中"orchestrator 预渲染 heading"的不对称。retryGuidance 的 heading 由 buildUserPrompt 加；orchestrator 只传 raw text。

接受 SHOULD-FIX：
- **S1（modify_goal no-op 检测）**：纳入本 PR（5.3）。
- **S2（pin failure→feedback mapping）**：纳入测试矩阵（5.4）。

不纳入本 PR：
- **S3（reason 字段渲染）**：scope 风险不可控，记入 6 节待办。

采纳替代方案：
- 不动 runner.ts 的复杂返回类型，仅加 `cause` + `nonRetryable`；recognition 集中在 build/agent.ts catch（codex 推荐 alternative fix）——本地化变更，缩小 surface。

## 9. codex 二审反馈（commit 691cc5bfb post-impl review）

PR commit `691cc5bfb` 实施后由 codex 做对抗性 post-impl review（rule 24 二次审查）。完整结论：

### VERDICT: ship as-is

三个 first-round BLOCKING（B1 dead code 单源 / B2 nonRetryable 防御 / B3 双 renderer 对称）独立逐项验证全部正确实施；零 regression（非 missing-terminal AgentRunError 原样 re-throw、catch 在 finally 之前、abort path 未受影响、external executor 路径不变）；测试 44 / 44 pass。

### NEW SHOULD-FIX（本次反馈处理）

**S2.1 `BuildAgentContractError.diagnostics.parseError` 已成 dead optional**：
- codex 指出 — `convertMissingTerminalToolError` 不传 parseError；former dead branch 删除后 production 代码路径无人写。
- **采纳**：本反馈 commit 顺手清理（rule 17）—— `build/types.ts` 删字段；`contract-error.test.ts:36` 测试改为只测 `sessionID` diagnostic。范围 ~10 行。

**S2.2 集成 smoke 测试 gap**（mock runAgentSession 抛 AgentRunError → BuildAgent.run 转抛 BuildAgentContractError）：
- **不采纳**：当前两端单元测试已 pin（runner-hard-error-propagation pin cause 传递、contract-error pin converter 行为）；中间 wiring 是 4 行直观调用。codex 自评"acceptable per rule 36"。本 PR 不加。如未来 wiring 出 bug，单独补集成 test。

**S2.3 modify_goal "(no changes)" return-string 未在 execute 层级断言**：
- **不采纳**：`computeContractFieldChanges` helper 已 12 个 case 覆盖，return string 拼接是 pure string 操作。rule 5（避免过度工程）。

### SPEC vs IMPL 漂移（本次反馈处理）

**§5.1 reason text 实施措辞为 paraphrase**：
- spec 原文引用了"call report_build_result exactly once / DO NOT write a markdown summary"措辞——这恰好是 `test/agent/visible-brief-hygiene.test.ts` 的 `forbiddenVisibleBriefSnippets` 所禁。实施时已改为 paraphrase（"complete the build per the standard build-agent contract / structured terminal report, not turn-final prose"），保留语义、避开 hygiene 红线。
- **采纳**：本反馈 commit 同步更新 spec §5.1 引用文本到实际实施的 paraphrase + 加 rationale 说明。

**§5.4 测试矩阵把 orchestrator catch path content pin 列在 `test/orchestrator/build-feedback-context.test.ts`，实际放在 `test/build-agent/contract-error.test.ts`**：
- 单源（rule 8）效果等价 —— `convertMissingTerminalToolError` 是 recovery hint 的所有者；它的输出 = orchestrator catch path 写入 decision_log 的 value。
- **采纳**：本反馈 commit 同步更新 §5.4 表格 + 加单源说明。

### 不采纳但记入待办

- 集成 smoke 测试 → 6.2 节追加。
- modify_goal execute return-string 测试 → 6.2 节追加。

### codex 二审 verbatim verdict

> "Ship as-is. All three BLOCKING items from the first-round codex review are correctly addressed with no regressions, the test suite passes (44/44 spec tests + visible-brief hygiene), no duplicate throw sites exist, no fallback was introduced, and recognition is fully `instanceof`-based (rule 20)."
