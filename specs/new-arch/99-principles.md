# 99 — 核心原则与 Anti-patterns

> 本文档是所有架构决策的宪章。任何新代码/新模块都必须符合这里的原则。
> 对应旧 SVG Section B（Code Architecture + Principles）+ Section E（Anti-patterns）。

## 核心原则

### 1. Orchestrator 是唯一决策者

- Sub-agents 有独立推理，但**何时调用谁由 Orchestrator 决定**
- Infrastructure 只执行，不决策，不自动 dispatch
- 没有固定 pipeline，没有机械 retry，没有自动流转

### 2. Sub-agents 是 agent，不是 tool

- Requirements / Architect / Frontend Design / Intent-Analysis / Integrity / Prosecutor / Acceptance 各有自己的 LLM + tools + 推理循环（旧 `Planner` 已下线，相关推理并入 orchestrator 与 build agent）
- 它们返回结构化结果，Orchestrator 据此推理下一步
- 禁止把 sub-agent 降级为 tool function

### 3. Goal 并行执行，依赖驱动调度

- 依赖满足的 goals 在独立 worktree 中并行执行（不限层，跨层依赖满足即可 dispatch）
- 当前 batch 全部完成后 Orchestrator 决定 dispatch 下一批
- `owned_paths` 不重叠：并行 goals 不写同一文件

### 4. 没有固定 pipeline

- 简单任务：Orchestrator 直接 execute，跳过 requirements + plan
- 失败处理：Orchestrator 读 evidence 推理，不是 `if bug→re-exec`
- 动态调整：Orchestrator 随时 `add_goal` / `modify_goal`

### 5. Requirements 必须穷尽提取

- 逐行解析用户输入，提取全部 explicit + implicit 需求，编号为 `REQ-N`
- 每个 `REQ-N` 必须出现在至少一个 goal 的 `requirement_ids` 中
- 输出追溯矩阵（`REQ-N → goal_X`），Fidelity Review 验证完整覆盖
- **10000 行 template 和 1 行 bug report 要求同样的严谨度**

### 6. 保留的好设计

- `GoalContract` Zod schema
- Decision Log（append-only 共享上下文）
- DB 作为真值源
- Worktree 隔离
- `exports` / `imports` 契约

## Anti-patterns — 禁止

### 执行与调度层

- ✗ **Fire-and-forget 触发**
  - `Orchestrator.processTask().catch()` 已删除，用 Task Control Loop（`orchestrator/loop.ts`）替代
  - 任何 `.catch(() => {})` 吞错误、脱离主循环的代码都是这个反模式
- ✗ **硬超时 / 绝对超时**
  - 所有超时必须是 **inactivity-based**，从不从进程启动计时
  - 理由：LLM 调用时长不可预测，硬超时会在正常推理中途杀进程
- ✗ **硬编码状态机**
  - `if status==evaluating → if pass → complete else retry` — 把决策交给 Orchestrator
- ✗ **机械 RetryPolicy**
  - `bug → re-execute` · `plan_wrong → re-plan` — agent 读 evidence 决定，不是查表
- ✗ **Sub-agent 降级为 tool function**
  - 它们有自己的 LLM，是 agent，不是 callable
- ✗ **任何 fallback 逻辑**
  - 修源头，不修消费端；不吞错误；不"兜底一下先让它跑起来"
- ✗ **任何关键字匹配规则**
  - 任何形式的关键词过滤或敏感词屏蔽都是严重违规

### Executor / 进程层

- ✗ **Executor bash 执行按名杀进程命令**
  - `taskkill /IM` · `Stop-Process -Name` · `killall` · `pkill`
  - Worktree **隔离文件系统，不隔离进程空间**
  - `shell/bash.ts` 的 `HOST_KILLING_PATTERNS` 拦截这些命令

### 工作流层

- ✗ **"最简单的修复"**
  - 不要为了快速修复而牺牲代码质量、系统健壮性或长期可维护性
  - 任何"最简单的修复"如果没有经过充分思考和验证，都不是合格修复
- ✗ **无脑打补丁**
  - 先思考本质问题。任何掩盖问题的补丁都不是合格修复
- ✗ **无脑使用 git 回退**
  - 不要通过粗暴回退破坏未提交代码或掩盖真实问题

### 文档与设计层

- ✗ **堆砌死代码**
  - 发现死代码 / 无意义代码 / 过时代码时，先向用户说明并询问是否删除
- ✗ **跳过 benchmark 直接改交付物**
  - benchmark 暴露的问题在 benchmark 里修，交付物由 benchmark 通过后自动产出
- ✗ **长时间闷头执行**
  - 应进行频繁自检与阶段性校验，尽早暴露问题
- ✗ **迎合表面需求**
  - 如果用户的问题定义浮于表面，或当前路径无法根本解决问题，**必须主动警示并重定向**

## 非协商约束（CLAUDE.md 同源）

1. 不允许任何 fallback 逻辑
2. 任务要求与验收指标必须长期保留（即使 context 压缩）
3. 测试超时必须是"无活动后的真实超时"
4. 采用无人值守、自我迭代的方式推进
5. 禁止无脑打补丁 — 先思考本质问题
6. 禁止无脑使用 git 回退修改
7. 如果调试工具本身异常，先修工具
8. benchmark 通过后仍必须复核交付物
9. 不要长时间闷头执行后才暴露问题
10. 问题定义浮于表面时，必须警示并重定向
11. 在必要时查看硬盘上的方案并 recall
12. 不要一味堆砌代码
13. 禁止任何关键字匹配规则
14. 禁止任何"最简单的修复"

## 相关文档

- [01-agents.md](01-agents.md) — 决策者 / sub-agent 的具体边界
- [04-extensions.md](04-extensions.md) — Executor / Plugin / MCP / ACP 的语义差异
- 项目根 `CLAUDE.md` — 调试模板与完整约束
