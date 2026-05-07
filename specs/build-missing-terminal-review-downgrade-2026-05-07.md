# Build Missing-Terminal Review Downgrade（路径 C）

**日期**: 2026-05-07
**状态**: 设计中（**等待 user 决定 C-A / C-B / C-C**）
**前置 PR**: `691cc5bfb` + `b07c1e8e6`（信号 + 信道修复，spec `build-missing-terminal-signal-restore-2026-05-07.md`）。本 spec 的实施依赖前置 PR 提供的 typed `BuildAgentContractError` + `retryGuidance` 字段 + `modify_goal` no-op 检测。

## 0. 术语

- LLM: Large Language Model.
- C-A / C-B / C-C: 本 spec 提出的三个候选设计变体。
- B10: spec `architecture-rework-loosening-plan-2026-05-06.md` 第 10 项决议——删除 build agent same-session recovery，由 orchestrator LLM 决定是否再开 build。

## 1. 现状（前置 PR 修复后）

`build/agent.ts:convertMissingTerminalToolError` 把 `AgentRunError(cause=TerminalToolMissingError)` 转抛 `BuildAgentContractError("missing_terminal_report")`，`orchestrator/tools.ts` catch path 走"标失败 + 写 phase=retry decision_log"。下一次 build attempt 收到含有"standard build-agent contract"恢复提示的 retry section。

**仍未解决的问题**（user 在前置 PR 实施过程中提出的洞察）：

模型已经在 worktree 写了 13+ 组件文件 + 跑过测试 + 在 markdown 里写了完整总结——产物**实质完成**，唯一缺的是 tool call 形式。当前 catch path 把这个 build 标 failed 并触发重试，**等价于把已经写好的代码扔了**，下次 attempt 必须从"刚启动 + 一堆 read"重新攒上下文，token 消耗放大且仍可能撞同一面墙（长上下文场景下 prompt 衰减是 LLM 行为不变量）。

> **真正的问题**："missing terminal tool call ≠ failed work"——只有"完整性问题"（产物缺失 / 测试失败 / merge_back 失败）才该真正返工。

## 2. integrity reviewer 现状（path C 命名误导）

调研发现 `@/integrity/agent.ts` 当前 review 的是 **architect 输出**（goal 拓扑结构），不是 build 产物：

| 项 | 值 |
|---|---|
| input | user request + REQ-N + decisions + design specs + goal contracts + decision log |
| dimensions | goal_fidelity / technical_feasibility / hallucination / solution_quality（全部针对 architect 决策） |
| output | `IntegrityResult { verdict: pass\|concerns\|needs_correction, dimensions, issues, corrections, missingGoals }` |
| corrections 类型 | `modify` / `split` / `remove` ——都是 **architect 层 contract 修订** |
| 是否看 worktree | 否 |
| 是否看 build session prose | 否 |

**结论**：路径 C 不能简单"复用 integrity reviewer"——需要新机制（新 agent / 新 tool / 新 host 启发式之一）。本 spec 提出三个候选。

## 3. 三个候选设计

### Option C-A：新建 build-completion reviewer agent

新模块 `@/build-completion/`：
- 专用 reviewer agent
- input: build session 的 prose 总结尾段 + worktree git diff + bash 命令历史 + acceptance_specs
- output: 合成 BuildResult `{ status: "passed"|"failed", summary, files_changed[], tests[], error? }`
- orchestrator 在 missing_terminal catch path 调它（替换当前的 synthFailed 直接判 failed 路径）
- 失败 → 走原 retry path；通过 → finalizeBuildAttempt as completed

**优势**：
- LLM 决定"产物是否实质完成"——rule 13 契合
- 决策载体跟现有 build agent 输出格式一致（BuildResult），下游 finalizeBuildAttempt / deliver 不需要改

**劣势**：
- 中等改动：新 agent + 新 prompt + 新 schema + 新 dimensions
- 增加一次 LLM 调用（但成本 << 重新跑一次完整 build attempt）
- 与现有 reviewer 矩阵（integrity / prosecutor / delivery）多一种 reviewer 类型——抽象上 OK 但 surface 增加

**适用场景**：当下游 deliver 不能可靠拦下"假 passed"时（例如 task 没走 deliver pipeline 或 deliver 自己跳过 missing_terminal 类问题）。

---

### Option C-B：host 端启发式合成（不引入 LLM）

orchestrator catch path 改为：

```text
if missing_terminal:
  collect worktree git diff
  if diff非空:
    synth BuildResult {
      status: "passed",
      summary: <extract from session prose tail or "build agent ended without report; <N> files changed">,
      files_changed: <derived from git diff: { path, summary: "(auto)", reason: "(auto)" }>,
      tests: [],          // host 不解析 bash history
      error: undefined,
    }
    if !merge_back invoked: trigger host-side merge_back
    finalizeBuildAttempt as completed
  else:
    保留当前 retry path（build 真没干活，retry 有意义）
```

**优势**：
- 范围最小（只改 orchestrator catch path 30 行）
- 不引入新 agent / prompt / 调用
- 与 rule 5（不过度工程）契合
- 后续 deliver 阶段做完整性 review，所以"乐观接受"在系统层面安全

**劣势**：
- LLM 在 markdown 说"测试通过"但实际未跑——host 看不出（deliver 兜底）
- "acceptance_specs 是否满足"由 deliver 判断，不在 build 层判断
- 决策不在 LLM —— 略违 rule 13？但实际上把判断**推迟**到 deliver（仍是 LLM）
- "git diff 非空 ⇒ 实质完成"是启发式，rule 20 边缘（不是关键字匹配但是非纯逻辑判断）

**适用场景**：信赖下游 deliver 兜底质量。

---

### Option C-C：扩展 orchestrator LLM 决策权（推荐）

不在 host 层做合成。改动两点：

1. **`build` tool 的 markdown 返回扩展**：missing_terminal 失败时附加：
   - worktree git diff 摘要（path + line counts）
   - build session 末尾 N 行 prose
   - bash 命令历史 + exitCode
   - merge_back 状态

2. **新 tool `accept_build({ goalID, synthesized_result })`**：让 orchestrator LLM 在看到上述信息后**自主决定**接受 build 实质产出：
   - host 验证 worktree 非空 + worktree_branch ahead of base
   - host 触发 merge_back（如果 missing_terminal 时未 invoke）
   - host 把 LLM 提交的 synthesized_result 当作 BuildResult 喂给 finalizeBuildAttempt as completed
   - 写 decision_log entry "orchestrator accepted missing_terminal build via accept_build"

orchestrator LLM 的决策空间扩展为：
- `accept_build({ goalID })` —— 接受实质产出
- `build({ goalID })` —— 重新尝试（同当前）
- `build({ goalID, request: "..." })` —— 带 retry guidance 重试
- `modify_goal({ goalID })` —— 修 contract 重试
- `fail_task` —— 放弃

**优势**：
- rule 13 极致 —— 全 LLM-driven，host 只校验 invariant（worktree 非空 / merge_back 完成）
- 与 B10 完全一致（"orchestrator LLM 决定是否再开 build"——本设计扩展决策空间，没违 B10 字面也没违 spirit）
- 与现有 build tool 返回模式一致（orchestrator 已经看 markdown 决策）
- 新 tool 是**显式加路径**，不是 fallback 掩盖（rule 7）——orchestrator LLM 必须明确选择 accept_build 才发生
- 中等改动（一个新 tool + build 返回 markdown 扩展）

**劣势**：
- 增加 orchestrator LLM 上下文负担（要看 worktree diff 摘要 + prose tail）
- 需要 orchestrator prompt 训练 LLM 何时该用 accept_build vs build retry
- accept_build 的 host-side invariant 验证逻辑要严格（防止 LLM 接受空 worktree 等错误情况）

**rule 7 / fallback 边界讨论**：
- fallback：host 自动绕过协议（例如 host 看到 missing_terminal 直接当 passed 处理）—— 这是 rule 7 禁止的
- accept_build：orchestrator LLM **显式决定** + host 校验 invariant —— 这是 LLM-driven 路径扩展
- 区分点：**谁是决策者**。host 自动判断 = fallback；LLM 显式选择 = 决策权扩展。C-C 属于后者。

## 4. 推荐：C-C

理由：
- **rule 13 最契合**：状态推进 100% LLM-driven，host 仅校验 invariant
- **B10 spirit 延续**：B10 把决策权交给 orchestrator LLM，C-C 提供**更具体的工具**让这个决策可执行
- **避免 rule 11 抽象违规**：C-A 引入新 reviewer agent → 多一种 reviewer 类型；C-B 引入 host 端启发式 → rule 20 边缘。C-C 把判断挂到既有的"orchestrator LLM 看 build tool markdown 做决策"模式上，没新加抽象层。
- **可观测性**：`accept_build` 调用本身被 decision_log 记录，audit 友好
- **rule 5（不过度工程）次优**：C-B 改动更小，但牺牲 rule 13 + 引入启发式

## 5. 实施方案（C-C minimum viable，user 已选定 C-C）

### 5.1 调研成果（rule 35）

- `finalizeBuildAttempt` (`engine/persist.ts:1704`) 接受 `{ status: "completed"|"failed", commitRef, diffs[], fileChanges[], summary, ... }`，completed + 非空 diffs 时附带写 `delivery` artifact。
- `Worktree.mergeSafely({ branch, worktreeDir })` (`worktree/index.ts:312`) 是公开 export，host 可直接调用——不必经过 build session。返回 `{ status: "merged"|"conflict"|"blocked"|"infra_error", primaryHead?, primaryBranch?, conflictPaths?, ... }`。
- `collectGoalContributionDiffs(worktreeDir, baseRef)` (`build/agent.ts:1772`) 内部 helper（非 export）。本 PR 无需访问，因为 catch path 已经持有 `managedWorktree` 三元组，可直接用 `runGit(["diff", ...])`。
- 当前 missing_terminal catch path（`tools.ts:4807-4866`）的 synthFailed 路径：`diffs / worktreeHead / actualChangedFiles` 全 `undefined`，导致 build tool 返回 markdown 的 fact block 全是占位文本。`mergeBackStatus="not_invoked"`。
- 现有 build tool 返回 markdown（`tools.ts:5068-5087`）已经有完整的 worktree facts 渲染逻辑——只要 catch path 把数据填满，markdown 自然带上事实。

### 5.2 改动列表

**A. catch path 现场采 worktree facts**（`orchestrator/tools.ts` BuildAgentContractError catch 块）

当 `runErr instanceof BuildAgentContractError` 且 `managedWorktree` 存在时，现场跑：
- `git diff --numstat <baseRef>...HEAD` 派生 `actualChangedFiles[]`（path / additions / deletions / status）
- `git rev-parse HEAD` 取 `worktreeHead`
- 不在 catch path 跑 collectGoalContributionDiffs（`FileDiff[]` 重，且本 PR 不需要 diff 内容，只需 path summary）

把这些 facts 填进 `buildOutcome.result`，自然让 build tool 返回 markdown 含 worktree facts。

**B. 新工具 `accept_build`**（`orchestrator/tools.ts` 在 build / modify_goal 区域新增）

```ts
accept_build: tool({
  description: <详细使用场景说明 — 何时用、何时不用>,
  inputSchema: z.object({
    goalID: z.string(),
    summary: z.string().optional(),
    reason: z.string(),
  }),
  execute: async ({ goalID, summary, reason }) => {
    // 1. invariant: latest goal_run for goalID 必须是 failed + missing_terminal_report 错误标记
    // 2. invariant: worktree dir 存在且 valid + git diff vs baseRef 非空
    // 3. host-side merge_back: Worktree.mergeSafely → 必须 status="merged"（conflict / blocked / infra_error 拒绝 accept_build，让 LLM 走 build retry）
    // 4. 合成 BuildResult { status: "passed", commit_ref: mergedHead, summary, files_changed: <derived from git diff>, tests: [] }
    // 5. finalizeBuildAttempt as completed + 写 delivery artifact
    // 6. 写 decision_log entry { phase: "build", key: "accept_build", value: <reason>, reason: <orchestrator-supplied reason> }
    // 7. 返回 markdown 描述结果
  },
}),
```

**核心 invariant**:
- 必须存在 latest goal_run + 是 failed + error 含 `BuildAgentContractError` 痕迹（通过 error 字符串包含 `code=missing_terminal_report` 或类似）
- worktree git diff vs baseRef 必须非空
- `Worktree.mergeSafely` 必须返回 `status="merged"`（不接受 conflict —— LLM 应走 build retry 解决冲突）

**C. tool description 详细使用场景**（不动 orchestrator prompt 文件）

description 说清：
- 何时用：上一次 build attempt 因 missing_terminal_report 失败 + worktree facts 显示产物完整（actual_changed_files 与 LLM prose 一致）
- 何时**不**用：build 真正失败（worktree 空 / 测试失败 prose 显式 / merge_back blocked）—— 仍走 build retry / modify_goal / fail_task
- host invariant 校验细节 + 拒绝路径返回的 markdown 描述

### 5.3 测试矩阵（rule 36）

| 测试文件 | 断言 |
|---|---|
| `test/orchestrator/accept-build.test.ts`（新增） | invariant 校验：goal_run 不存在 / 不是 failed / 不含 missing_terminal 标记 / worktree 空 / merge_back 非 merged —— 全 reject + 返回错误 markdown |
| 同上 | happy path：合成 BuildResult.status=passed + commit_ref=mergedHead + files_changed 来自 git diff；finalizeBuildAttempt 被以 completed 调用；decision_log 写 accept_build entry |
| `test/orchestrator/build-missing-terminal-facts.test.ts`（新增） | mock build path 抛 BuildAgentContractError + managedWorktree 存在 → buildOutcome.result 的 actualChangedFiles / worktreeHead 不为空；build tool 返回 markdown 含 actual_changed_files 列表 |

### 5.4 不在本 PR 范围

- orchestrator prompt 文件 (`@/prompt/core/orchestrator.txt`) 更新教 LLM 何时用 accept_build —— 用 tool description 自描述代替（rule 5 不过度工程）
- accept_build 处理 conflict 路径（merge_back 冲突）—— 当前 reject conflict 让 LLM 走 build retry
- accept_build 的 overlay UI 渲染
- 其他 BuildAgentContractError code 扩展（当前仅 missing_terminal_report）

## 6. user 决策点

请选一个：

1. **C-A**（新 reviewer agent）——希望由 LLM 严肃 review build 实质完成性，不依赖 deliver 兜底
2. **C-B**（host 启发式合成）——信赖 deliver 兜底，要最小改动
3. **C-C**（orchestrator LLM accept_build tool，**推荐**）——rule 13 极致，决策权延伸
4. **延后**——本 PR 范围已经够大，路径 C 推到下一个 milestone

## 7. CLAUDE.md 合规性 self-check（C-C 前提下）

- **Rule 5（不过度工程）**：C-C 不引入新 agent / 新 prompt 文件，仅扩展 orchestrator tool 集 + build tool 返回 markdown。
- **Rule 7（无 fallback）**：accept_build 是 LLM 显式决策路径，不是 host 自动绕过。
- **Rule 8（单源）**：accept_build 的 invariant 校验逻辑 + decision_log 记录都集中在 orchestrator/tools.ts 的 accept_build tool execute 里。
- **Rule 11（拦截抽象违规）**：不新建 reviewer 类型，复用 orchestrator LLM 决策权（既有抽象）。
- **Rule 13（无状态机）**：状态推进完全由 orchestrator LLM 调 tool 触发；host 不做任何隐式状态转换。
- **Rule 24（二次 review）**：实施完成后必须 codex 复核。
- **Rule 32（方案落盘）**：本文件即 spec。
- **Rule 35（穷举调用点）**：实施时 grep `BuildResult` 消费者 / `finalizeBuildAttempt` 调用点 / `goal_run.status` 更新点穷举完毕后再动手。
- **Rule 36（每改动配测试）**：实施时配 unit test (accept_build invariant 校验) + integration test (orchestrator 收到 missing_terminal → 调 accept_build → finalizeBuildAttempt as completed)。

## 8. 实施前的关键调研（user 选 C-C 后必查）

- `finalizeBuildAttempt` (`engine/persist.ts`) 当前接受的 BuildResult shape，accept_build 合成结果是否符合
- `merge_back` 工具 (`build/agent.ts`) 是否能从 orchestrator 端调用（host-side），还是必须从 build session 内调
- `goal_run.status="completed"` 的下游消费者（deliver / collaboration_closure / overlay）是否对"无 build session 内 report_build_result tool call"的 completed goal_run 有特殊期望
- orchestrator prompt（`@/prompt/core/orchestrator.txt`）是否需要更新教 LLM 何时用 accept_build vs build retry vs modify_goal
- 现有 build tool 返回 markdown 在 missing_terminal 失败时显示什么 —— `synthFailed` 路径下 markdown 内容是否已经含 worktree diff 摘要 / prose tail / bash history（决定 C-C 第 1 项扩展量）
