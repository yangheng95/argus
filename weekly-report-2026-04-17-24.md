# 周报 2026-04-17 ~ 2026-04-24

## 本周逻辑主线（一条因果链）

> 一句话：**为了让「交付是否合格」这件事从"模糊判断"变成"可度量的硬门"，先拆掉所有藏着决策权的状态机，让状态由事件派生；再把分解权收归 Architect、重试权收归 `startNewAttempt`；最后在 Delivery 出口架上 Quality Gate 做终审。**

```mermaid
flowchart LR
    Q0["❓ 本周起点问题<br/>Delivery 验收靠 agent 自说自话<br/>无法度量,无法复现,无法回滚"]

    Q0 --> S1["① 先拆状态机<br/>(规则#23)"]
    S1 --> S1a["engine_goal.status 列删除<br/>cascade_state 删除<br/>stale-breaker/Arbiter/FSM gate 全清"]
    S1a --> S1b["describe 派生视图成唯一状态源<br/>事件日志 → goalStatusByID"]

    S1b --> S2["② 收归决策入口"]
    S2 --> S2a["分解权 → Architect<br/>(Requirements 收窄到 REQ-N)"]
    S2 --> S2b["重试权 → Goal.startNewAttempt<br/>(所有 retry intent 统一)"]
    S2 --> S2c["调度权 → dispatch_goal + pool<br/>(loop 不再 auto-restart,<br/>用户消息驱动 per-taskID 串行链)"]

    S2a --> S3["③ 架质量门"]
    S2b --> S3
    S2c --> S3

    S3 --> S3a["P0 核心<br/>多模态 tool result / 引用真实性 /<br/>数值硬门 / LKG 回滚"]
    S3 --> S3b["P1 质量<br/>runtime-evidence pre-gate /<br/>fingerprint / 禁 checks_run"]
    S3 --> S3c["P2 可观测<br/>delivery_round 落盘 /<br/>replay 脚本 / per-gate 徽章"]
    S3 --> S3d["submit_verdict<br/>拒绝自相矛盾的 accepted"]

    S3a --> S4["④ 让结果看得见"]
    S3b --> S4
    S3c --> S4
    S3d --> S4

    S4 --> S4a["Overlay 4 层层级<br/>goal→step→phase→session"]
    S4 --> S4b["Rewind per-card<br/>UI 时间轴作为投影"]
    S4 --> S4c["卡片严格 birth-time<br/>SSE after=0 不丢历史"]

    S4a --> S5["⑤ 打底基建"]
    S4b --> S5
    S4c --> S5

    S5 --> S5a["engine_task 拆字段<br/>attachments vs system_artifacts"]
    S5 --> S5b["createEventQueue 统一事件<br/>chunk-driven heartbeat"]
    S5 --> S5c["last_progress_at 独立 liveness scanner"]
    S5 --> S5d["delivery worktree-native<br/>per-round commit + reclaim"]

    S5a --> Q1["✅ 本周终点<br/>交付质量从 agent 自述<br/>变成事件派生 + 硬门 + 可 replay"]
    S5b --> Q1
    S5c --> Q1
    S5d --> Q1

    classDef phase fill:#2d3748,stroke:#4a5568,color:#fff
    classDef pain fill:#742a2a,stroke:#c53030,color:#fff
    classDef win fill:#22543d,stroke:#38a169,color:#fff
    class S1,S2,S3,S4,S5 phase
    class Q0 pain
    class Q1 win
```

### 为什么是这条顺序

| 步骤 | 必须先做它的原因 |
|---|---|
| ① 拆状态机 | 状态机里藏着的 gate 会拦截事件,事件溯源就无从谈起 |
| ② 收归入口 | 如果分解/重试/调度有多个入口,质量门就有多个绕路 |
| ③ 架质量门 | 入口收敛后,才有唯一出口可以装门 |
| ④ UI 层级 | 门的判决需要被人看见,否则 agent 陷入"自嗨回路" |
| ⑤ 打底基建 | 前四步暴露出来的基础设施缺口(事件队列/liveness/worktree 提取)补齐 |

---

## 工作主题分布（Mermaid 思维导图）

```mermaid
mindmap
  root((本周<br/>~180 commits))
    Delivery Quality Gate
      P0 核心
        Stream A 多模态 tool result + render-prereq 短路
        Stream B 引用真实性门
        Stream C 数值硬门
        Stream C' LKG 分数驱动回滚
        P0-B 视觉阈值并入 EngineConfig
      P1 质量
        Stream E runtime-evidence pre-gate
        Stream F.1 content fingerprint API
        Stream F.2 禁用 checks_run inline
      P2 可观测
        G.1 delivery_round CRUD
        G.2 replay 脚本
        G.3 deliver 工具落盘
        per-gate 徽章 + --gates
      submit_verdict 强制拒绝自相矛盾
    Orchestrator 去状态机
      Phase1-3 事件溯源
        describe 取代 cache
        删除 status/cascade_state 列
        describe/goalStatusByID 派生
      重试统一入口
        Goal.startNewAttempt
        delivery reject 接入
        superseded_reason 升一等列
      Loop/Chain
        用户消息驱动
        per-taskID 串行链
        detach chain tail 修死锁
        dispatch_goal fail loud
      FSM 清理
        删 deterministic Arbiter
        删 stale-state 断路器
        删 quality-score retry gate
    Architect/Requirements
      Architect 成权威分解器
      Requirements 收窄到 REQ-N
      phase-shaped decomposition
      物理搬离 requirements/
    Overlay / UI
      4 层层级
        goal → step → phase → session
        session 终态联动
      Rewind
        per-card 按钮
        增量 prune
        UI 时间轴回滚
      视觉打磨
        right rail / board / dialog
        chat-header 3 列 grid 居中
        ChangesPanel pill tabs
      卡片契约
        strict birth-time
        lazy step/phase birth
        SSE after=0
        atomic rename 修崩溃
    Executor / Engine 基建
      engine_task 拆字段
      createEventQueue 统一事件
      chunk-driven heartbeat
      last_progress_at liveness scanner
      Delivery 归因 agent 自填
      worktree-native 提取
      per-round commit + reclaim
    工具链 / 规范
      design-analyst 抛 webfetch
      mirror 工件统一
      webpage-clone task_signals
      CLAUDE.md 规则编号重排
      gitignore Windows 保留名
```

## 时间分布（Gantt）

```mermaid
gantt
    title 本周 commit 密度分布
    dateFormat YYYY-MM-DD
    axisFormat %m-%d

    section Delivery QG
    P0 Stream A/B/C + LKG      :done, 2026-04-23, 2d
    P1 E/F.1/F.2               :done, 2026-04-24, 1d
    P2 G.1/G.2/G.3 + replay    :done, 2026-04-24, 1d

    section Orchestrator
    Phase 1-3 事件溯源         :done, 2026-04-21, 2d
    FSM gate 清理              :done, 2026-04-22, 2d
    Loop/Chain 修复            :done, 2026-04-24, 1d

    section Architect/Req
    Architect 成权威分解器     :done, 2026-04-22, 1d
    phase-shaped decomposition :done, 2026-04-23, 1d

    section Overlay
    4 层层级改造               :done, 2026-04-19, 1d
    Rewind 能力                :done, 2026-04-21, 1d
    视觉打磨                   :done, 2026-04-22, 2d

    section Engine 基建
    engine_task 拆字段         :done, 2026-04-22, 1d
    liveness scanner           :done, 2026-04-24, 1d
    Delivery worktree-native   :done, 2026-04-22, 1d
```

## 架构演进（Before → After）

```mermaid
flowchart LR
    subgraph Before[Before:状态机驱动]
        A1[engine_goal.status 列] --> A2[dispatch gate]
        A2 --> A3[execute_goal]
        A3 --> A4[deterministic Arbiter]
        A4 --> A5[stale-state 断路器]
    end

    subgraph After[After:事件溯源 + LLM 自主]
        B1[event log] --> B2[describe<br/>派生视图]
        B2 --> B3[dispatch_goal<br/>pool 驱动]
        B3 --> B4[Goal.startNewAttempt<br/>统一重试]
        B4 --> B5[submit_verdict<br/>强质量门]
    end

    Before -.规则 #23 重构.-> After
```

## 下周焦点

```mermaid
flowchart TD
    N1[Delivery QG Phase 2<br/>replay 端到端验收] --> Next
    N2[事件溯源架构<br/>benchmark 回归] --> Next
    N3[4 层层级<br/>真实任务保真度] --> Next
    Next((下周))
```
