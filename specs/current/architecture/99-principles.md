# 99 — 核心原则与 Anti-patterns

> 本文档是所有架构决策的宪章。任何新代码/新模块都必须符合这里的原则。
> 对应旧 SVG Section B（Code Architecture + Principles）+ Section E（Anti-patterns）。

## 核心原则

### 1. Orchestrator 是唯一 engine task 调度决策者

- Projected workers 有独立推理，但 engine Task 调度、expert-squad worker 选择和唯一 business lifecycle 决策只由 Orchestrator 负责
- Coding / Chat 可用 `delegate_agent` 决定是否为当前交互请求创建一个 bounded local child session；它不具备 engine Task、Delivery Slice、expert-squad、worktree 或 lifecycle authority
- Infrastructure 只执行，不决策，不自动 dispatch
- 没有固定 pipeline，没有机械 retry，没有自动流转
- Orchestrator 在新执行请求首次 domain dispatch 前建立一次可见的 verification-budget shared mental model：不可降低的 acceptance floor 始终执行；只有超出该底线、且 active package 确实可执行的 additional assurance 才询问 operator 是否投入额外时间与 Token。当前请求已明确偏好时不重复问，拒绝或 deadline expiry 采用 compact `required_only` 并继续。该询问属于 prompt-owned 元认知决策，不是 Host gate、状态字段或第二 workflow source
- Manifest v1 `capability_projection.virtual_workflows` 显式 `{}` 表示没有 binding workflow 的简单 direct-dispatch Squad。每个 graph 是 package-owned immutable scheduler contract；每个 node 在一个 Task 中只实例化一次。Orchestrator 在首次 domain dispatch 前追加一次可见 workflow-selection decision，绑定精确 package revision/digest 与真实 message/tool identity；它不是 active pointer 或 step state。Graph 不自动 dispatch、不取代 Orchestrator 的可见判断
- 跨 squad 交付由 Mission 建立依赖阶段 Task：每个阶段 Task 显式设置且终身固定一个 `promptProfile`，只创建本 squad 的本地 Delivery Slices 并执行其 Task-level binding workflow；Mission 只在前置 Task terminal acceptance 后创建下一 Task

### 2. Sub-agents 是真实 agent session，不是 tool function

- Active expert-squad projection 选择的每个 dynamic agent 都通过其 typed runtime template 创建独立 LLM + tools + 推理循环；base role 只提供模板与 adapter ABI，不构成固定团队成员
- 它们返回结构化结果，Orchestrator 据此推理下一步
- `dispatch_agent` 和 `delegate_agent` 是创建/等待真实 agent session 的调用边界，不得把 sub-agent 降级成宿主函数，也不得把两个工具做成别名

### 3. Goal 是 versioned Delivery Slice，Task 独占 lifecycle

- Goal 是稳定 logical identity 加 immutable revision 的本地交付面；只保存 objective、acceptance、owned paths、priority、kind 与精确 RequirementSet/ContractGraph refs
- Slice 不含 status、attempt、result、retry、workspace、execution owner 或 `depends_on`；ContractGraph producer/consumer 关系只描述接口
- Orchestrator 从 workflow、真实 predecessor evidence、active Session/dispatch、并发容量和 ownership 自然决策；Slice revision 只是 typed input/evidence subject，不扩增 workflow node
- eligible work 在独立 worktree 中并行执行；当前 frontier 返回后 Orchestrator 根据新 evidence 决定下一批
- `owned_paths` 不重叠：执行顺序不能合法化多个 Slice 共享写 ownership；共享面必须单一 owner、合并 Slice 或 Task-level assembly owner
- Goal 面板分别投影 current revision、独立 activity/evidence/review association 和 Task Completion Decision 显式 acceptance；这些 facet 不合成为 Goal progress、display lifecycle 或调度 gate

### 4. 没有 host 固定 pipeline

- 简单任务：只有 active package 中不存在匹配的已声明 virtual workflow 时，Orchestrator 才可直接选择最小充分的 projected worker；一旦选择某个已声明 workflow，就不得跳过其中的 requirements、plan 或其他 node
- 失败处理：Orchestrator 读 evidence 推理，不是 `if bug→re-exec`
- 动态调整：新增 Goal 创建 Slice identity/revision；修改 Goal 在同一 identity 下追加 revision，旧 evidence 不满足新 revision

### 5. 领域完整性由 active package 声明

- 平台只保证动态投影、typed adapter、Delivery Slice、证据与 Task lifecycle 协议，不强制所有 expert squad 使用 Requirements / Architect / Integrity 拓扑；预置 squad 与 portable template 由各自 manifest 显式拥有实现 identity，禁止 Resolver fallback
- 内嵌 `base` 是默认且是 Advanced 的便捷复合型版本，使用 Explore Researcher → Delegated Planner → Build Developer → Delegated Tester binding workflow 和 canonical research、planning、development、testing Artifacts 完成非 Goal 开发；每个身份继承与其职责一致的 typed runtime。内嵌 `advanced` 保留完整 requirements、architecture、specialist investigation、interface 与 review 团队；内嵌 `research-studio` 保留五个研究身份与三张研究交付图。三个 package 都是独立投影，不使用 alias、继承或组合。
- `REQ-N` 穷尽提取、requirement-to-slice 映射和独立覆盖复核由具体 package 声明
- 任意 active package 完整替换先前 active package 投影，不继承 Base、Advanced 或其他 package 的成员、顺序、prompt 或领域验收政策

### 6. 保留的好设计

- Delivery Slice identity/revision Zod schema
- `ArchitectContractGraph` v2（仅 interface `contracts`，无 dependency contracts）
- Decision Log（append-only 共享上下文）
- DB 作为真值源
- Worktree 隔离
- `exports` / `imports` 契约

### 7. Installed executable extension 是显式信任边界

- 显式安装的 expert-squad package tool 与显式安装的 plugin 同属 trusted executable extension；它们在 OpenCorvus host process 中执行，并获得 active projection 授予的真实工具能力
- Package tool 的编译 closure、owner 边界、声明依赖和 SHA-256 校验只证明已安装字节的可移植性、确定性与完整性，不是 hostile-code sandbox
- 禁止用 `eval`、`Function`、`process`、`Bun` 等关键字 blacklist 冒充隔离；这种规则可绕过、会制造错误安全承诺，也会限制可信扩展
- 支持 untrusted executable package code 必须作为独立产品能力设计 process boundary 与 capability RPC（Remote Procedure Call，远程过程调用）membrane，不能作为当前 trusted runtime 的 fallback 或兼容分支

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

### 子进程 / 命令层

- ✗ **Agent shell 执行按名杀进程命令**
  - `taskkill /IM` · `Stop-Process -Name` · `killall` · `pkill`
  - Worktree **隔离文件系统，不隔离进程空间**
  - `packages/opencorvus/src/tool/bash.ts` 的 `HOST_KILLING_PATTERNS` 拦截这些命令

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
  - Observable agent 应在有意义的工作边界输出明文 narrative：已确认事实、当前动作、方向/阻塞变化和验证结果
  - narrative 必须是真实 assistant text，禁止 synthetic heartbeat、host timer 或暴露私密 chain-of-thought
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
- [04-extensions.md](04-extensions.md) — Expert Squad / Plugin / MCP / ACP 的语义差异
- 项目根 `CLAUDE.md` — 调试模板与完整约束
