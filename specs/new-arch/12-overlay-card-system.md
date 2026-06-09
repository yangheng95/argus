# 12 — Overlay 统一卡片系统

> 对应代码：`packages/overlay/src/store/card-tree.ts` · `packages/overlay/src/services/tree-writer.ts` ·
> `packages/overlay/src/components/Card.tsx` · `packages/overlay/src/components/CardHeader.tsx` ·
> `packages/overlay/src/utils/card-tree.ts` · `packages/overlay/src/utils/card-color.ts` ·
> `packages/opencorvus/src/workbench/board.ts`
>
> 本文档定义 Overlay 消息卡片 / 任务卡片 / 过程卡片的统一抽象。所有新增卡片必须通过本协议
> 接入，禁止继续以"新增一个专用 kind + 新增一套专用组件分支"的方式扩张卡片系统。
>
> **状态（2026-04-27）**：`store/card-tree.ts` 与 `services/tree-writer.ts` 已落地（commit
> `8156e36e0` 把 CardNode 双源合并到 store/card-tree）；但本文档定义的 **Shell / Variant /
> Payload / UiHints 四元抽象尚未实施** —— 当前实现仍以扁平的 `CardKind` + `StepPayload` +
> ad-hoc 字段（`toolPart`、`integrity` 等）承载差异。本文档当前是"目标设计"，不是"代码现状"。

---

## 一、目标

Overlay 当前已经具备单一 POJO 卡片树、单写入口、统一递归渲染三项基础能力，但缺少一份
正式的卡片系统规范，导致新卡片需求容易继续复制以下隐式模式：

- 在 writer 某个 handler 里临时拼一个新 shape
- 在 `Card.tsx` 里再加一个 `kind === ...` 分支
- 在 `CardHeader` 之外临时定义专用头部样式
- 在局部逻辑里手写排序、嵌套、默认展开规则

本设计的目标不是新增更多卡片类型，而是把“卡片类型爆炸”收敛为以下四个统一维度：

1. **统一 Shell**：所有卡片共享同一外壳、标题栏和嵌套容器规则
2. **统一 Payload**：业务差异进入 `payload`，而不是继续扩展顶层字段
3. **统一 Policy**：排序、嵌套、默认展开、颜色、动作由策略统一决定
4. **统一 Writer**：只有 `tree-writer` 可以创建和更新 store-backed 卡片

---

## 二、现状真相

### 2.1 已有的正确基础

- `cardTreeStore` 已经是 Overlay 会话视图的单一响应式真值源
- `tree-writer.apply(event)` 已经是唯一的 store-backed 卡片写入口
- `Conversation` / `Card` 已经直接消费 `CardNode`，不是消费类实例
- `CardHeader` 已经是统一的标题栏外壳
- `defaultExpandedForNode()` 与 `stageAccent()` 已经是独立策略函数

这些现状意味着：**Overlay 卡片系统天然适合 POJO 协议，而不适合 OOP 卡片类层次。**

### 2.2 当前的结构问题

| 问题               | 现状                                                                        |
| ------------------ | --------------------------------------------------------------------------- |
| 顶层协议不够收敛   | `stepPayload`、`fidelity`、`toolPart` 各自占一个专用字段                    |
| 壳层和业务语义耦合 | `kind` 同时承担“渲染壳层”和“业务语义”两种职责                               |
| 规则散落           | 排序、嵌套、默认展开、颜色分别散落在 writer / utils / 组件里                |
| 扩展入口不统一     | 新卡片很容易通过局部分支接入，而不是走统一协议                              |
| 类型存在双源风险   | `store/card-tree.ts` 与 `utils/card-tree.ts` 各持有一份 `CardNode` 结构镜像 |

### 2.3 本文档的结论

- 不引入 OOP 卡片类
- 继续坚持 POJO 卡片协议
- 通过“Shell + Payload + Policy + Writer”四层模型收敛现有体系

---

## 三、核心原则

### 3.1 单一 POJO 协议

所有 store-backed 卡片都必须使用统一 `CardNode` 协议。禁止以下设计：

- `BaseCard` / `AgentCard` / `StepCard` 这类前端类继承体系
- 把方法挂在卡片对象上
- 用 class instance 作为响应式 store 值

原因：当前卡片系统依赖 Solid 的细粒度响应式、SSE 回放、JSON 快照、定点 path 写入。类实例会增加序列化、
快照测试、重建和调试复杂度，不带来等价收益。

### 3.2 kind 只表示 Shell，不表示业务语义

卡片顶层 `kind` 只允许表达渲染外壳差异，禁止继续承载业务语义。

业务语义必须进入：

- `variant`
- `payload.type`

### 3.3 默认可嵌套

任何卡片默认都可以作为另一个卡片的 child 被挂载。是否允许顶层出现、默认挂到哪里、是否吸收 session parts，
由统一 placement policy 决定，不由具体组件自行决定。

### 3.4 单写入口

只有 `packages/overlay/src/services/tree-writer.ts` 可以创建和更新 store-backed 卡片。禁止：

- 组件直接 mutate `cardTreeStore`
- service 旁路写入 `cardTreeStore`
- board / chat / interaction 各自维护一套独立卡片树

### 3.5 无 fallback

未知卡片 payload、未知 writer projector、未知 renderer registry 命中时，必须直接抛错。禁止：

- 退回一张“通用 unknown 卡片”继续跑
- 静默忽略 payload 字段
- 在组件里做“兜底一下先渲染文本”

---

## 四、统一抽象

## 4.1 CardShell

CardShell 只定义渲染外壳，不定义业务语义。

```ts
type CardShell = "message" | "session" | "process" | "tool"
```

四种壳层的语义如下：

| Shell     | 用途                                                      | 默认行为                                                                                                       |
| --------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `message` | 用户请求、系统消息、interaction 消息                      | 默认展开；弱容器；通常不含复杂 child                                                                           |
| `session` | agent 会话卡、子 agent 会话卡                             | 默认展开；统一标题栏；吸收本 session parts                                                                     |
| `process` | goal step、phase、fidelity、acceptance verdict 等过程节点 | 默认可折叠；强状态；允许嵌套子卡                                                                               |
| `tool`    | promoted tool card                                        | 默认运行中展开；正文由 tool payload renderer 决定；展开后直接显示结果，禁止再套 `<details>` / summary 二次展开 |

### 4.2 CardVariant

业务语义由 `variant` 表达。示例：

```ts
type CardVariant =
  | "user-request"
  | "interaction-message"
  | "orchestrator-session"
  | "requirements-session"
  | "architect-session"
  | "planner-session"
  | "build-session"
  | "acceptance-session"
  | "goal-step"
  | "goal-phase"
  | "fidelity-verdict"
  | "tool-call"
```

规则：

- 新增业务卡片时，优先新增 `variant`
- 禁止优先新增新的 shell kind

### 4.3 Unified CardNode

统一的 store-backed 卡片协议如下：

```ts
interface CardNode {
  id: string
  shell: CardShell
  variant: string
  title: string
  subtitle?: string
  status?: "pending" | "running" | "completed" | "error" | "skipped"
  role?: string
  stage?: string
  accent?: string
  round?: number
  goalID?: string
  stepID?: string
  phaseID?: string
  time: number
  parentID?: string
  childIDs: string[]
  parts: CardPart[]
  payload?: CardPayload
  ui?: CardUiHints
}
```

### 4.4 CardPayload

所有业务差异统一进入 `payload`。禁止继续扩张顶层专用字段，如：

- `stepPayload`
- `toolPart`
- `fidelity`

统一写法：

```ts
type CardPayload =
  | { type: "goal-step"; planNodes?: ...; changedFiles?: ...; checks?: ... }
  | { type: "goal-phase"; sessionKind: string }
  | { type: "fidelity-verdict"; verdict: ...; issues: ...; corrections: ... }
  | { type: "tool-call"; toolName: string; state: unknown; input: unknown; output: unknown }
  | { type: "message-meta"; attachments?: ... }
```

规则：

- 所有 renderer 只认 `payload.type`
- 禁止 renderer 读取 ad-hoc 顶层字段再猜业务语义

### 4.5 CardUiHints

允许极少量 UI 覆盖，但不能替代统一 policy：

```ts
interface CardUiHints {
  defaultExpanded?: boolean
  accentRole?: string
  hideCopy?: boolean
  hideRewind?: boolean
}
```

---

## 五、默认公共行为

### 5.1 默认标题栏

所有 `message` 之外的 shell 默认使用统一标题栏。标题栏由以下元素组成：

- status badge
- leading glyph
- title
- round
- subtitle
- context token hint
- copy action
- rewind action
- chevron

这套结构以 `CardHeader.tsx` 为唯一实现来源。新增卡片不得再定义第二套标题栏。

### 5.2 默认展开规则

默认展开规则必须集中在一个 policy 函数中，禁止散落在组件分支里。

默认规则：

| 条件                                            | 默认展开 |
| ----------------------------------------------- | -------- |
| `status === "running"`                          | 是       |
| `shell === "message"`                           | 是       |
| `shell === "session"`                           | 是       |
| `shell === "process" && status !== "completed"` | 是       |
| `shell === "process" && status === "completed"` | 否       |
| `shell === "tool" && status !== "completed"`    | 是       |
| `shell === "tool" && status === "completed"`    | 否       |

覆盖规则：

1. `ui.defaultExpanded` 可以覆盖默认策略
2. 用户手动折叠 / 展开优先级高于默认策略
3. 状态变化会使过期 override 失效，恢复为默认策略

### 5.3 默认嵌套规则

所有卡片默认允许被挂载为 child。嵌套关系由 `CardPlacementPolicy` 统一定义。

默认规则：

1. `message` 默认挂到所属 `session` 下
2. `tool` 默认挂到当前 `session` 或 `process` 下
3. `goal-phase` 默认挂到 `goal-step` 下
4. `fidelity-verdict` 默认挂到 `requirements-session` 下
5. `user-request` 默认顶层
6. orphan interaction 默认顶层

禁止：

- 在组件里通过 `children.push(...)` 决定嵌套
- 在某个局部 handler 里私自发明新的挂载规则

### 5.4 默认排序规则

排序必须是统一 policy，而不是 writer 某个分支的临时 append 结果。

父作用域内的默认排序键：

1. `time` 升序
2. `shellPriority` 升序
3. `id` 升序

其中：

```ts
const shellPriority = {
  message: 10,
  session: 20,
  process: 30,
  tool: 40,
}
```

说明：

- `time` 是主要排序真值
- `shellPriority` 只在相同时间戳下打破并列
- `id` 用于稳定排序，保证快照可重复

### 5.5 默认颜色规则

颜色规则由 `stageAccent()` 决定：

1. 已知 stage 使用固定 CSS 变量
2. 未知 stage 使用 deterministic hash 色
3. variant 只允许通过 `ui.accentRole` 指定角色，不允许直接写死颜色值

---

## 六、渲染架构

### 6.1 Card 是统一 Shell

`Card.tsx` 只负责：

- 统一外壳 DOM
- 统一标题栏
- 统一递归 child 渲染
- 根据 `payload.type` 分发正文 renderer

禁止：

- `Card.tsx` 继续累积大量 `variant === ...` 的业务分支
- 每个业务卡片新增一个平级根组件替代 `Card`

### 6.2 BodyRendererRegistry

定义正文 renderer 注册表：

```ts
interface CardBodyRenderer {
  payloadType: string
  render(node: CardNode): JSX.Element
}
```

典型 renderer：

- `message-meta`
- `goal-step`
- `goal-phase`
- `fidelity-verdict`
- `tool-call`

新增业务卡片时：

1. 新增 `payload.type`
2. 新增对应 body renderer
3. 注册到 registry

禁止新增新的根卡片组件类型。

---

## 七、Writer 架构

## 7.1 三层职责

`tree-writer` 必须拆解为三层职责：

### Event Adapter

负责把 SSE / board / message 变化转换成标准输入事件。

### Card Projector

负责把标准输入事件投影为 `CardNode` 草稿。这里只生成统一协议，不决定排序和挂载。

### Card Reconciler

负责：

- upsert
- parent/child 归属
- 排序
- GC
- dangling child 清理

规则：

- 新卡片 variant 只能通过 projector 注册
- 不允许在 `applyEvent()` 某个分支里临时拼一段 ad-hoc `CardNode`

## 7.2 单写入口约束

任何 store-backed 卡片都必须经过 `tree-writer` 写入。禁止：

- `chat.ts` 直接写卡片树
- `Board.tsx` 直接产卡
- `Conversation.tsx` 根据消息临时建 store-backed 卡

允许的例外：

- renderer 内部为了表现某个 part，临时构造 transient card
- 这种 transient card 不进入 `cardTreeStore`

---

## 八、禁止项

### 8.1 禁止继续扩张 kind

新业务需求禁止以下路径：

- 新增 `kind: "acceptance"`
- 新增 `kind: "architect"`
- 新增 `kind: "review"`

应改为：

- 复用 `shell: "process"` 或 `shell: "session"`
- 新增 `variant`
- 新增 `payload.type`

### 8.2 禁止双源 CardNode

`CardNode` 类型只能有一个真值源。`utils/card-tree.ts` 不得再维护第二份结构定义。

### 8.3 禁止组件内 placement

组件不得决定：

- 这个卡片挂在哪个父节点下
- 这个卡片是不是顶层
- 这个卡片是不是要吸收某个 session 的 parts

这些都必须由 placement policy 与 writer 决定。

### 8.4 禁止局部排序

禁止在 handler 中通过“先 append 谁、后 append 谁”隐式定义排序。排序必须由统一排序器决定。

---

## 九、迁移方案

### P1 — 统一协议

- 以 `store/card-tree.ts` 为唯一 `CardNode` 真值源
- `utils/card-tree.ts` 只保留纯函数与 type re-export
- 新增 `CardShell` / `CardVariant` / `CardPayload` / `CardUiHints`

### P2 — 收敛字段

- `stepPayload` → `payload.type = "goal-step"`
- `toolPart` → `payload.type = "tool-call"`
- `fidelity` → `payload.type = "fidelity-verdict"`

迁移完成后，删除旧专用字段。

### P3 — 提取 policy

把以下规则集中抽出：

- `CardPlacementPolicy`
- `CardSortPolicy`
- `CardExpandPolicy`
- `CardAccentPolicy`

`Card.tsx` 与 `tree-writer.ts` 统一调用，不再各自保留私有规则。

### P4 — 引入 registry

- `CardBodyRendererRegistry`
- `CardProjectorRegistry`

新卡片只能通过 registry 接入。

### P5 — 回归验证

验证项：

1. 现有 card tree 快照不出现层级回退
2. `Card.tsx` 不再增加新的业务分支
3. 新增一个卡片业务无需新增 shell kind
4. 所有排序由统一排序器输出
5. dangling child / orphan node 可被统一 reconciler 发现并拒绝

---

## 十、验收标准

完成本设计后，必须满足：

1. Overlay 中所有 store-backed 卡片都符合统一 `CardNode` 协议
2. `CardNode` 不再存在第二份独立结构定义
3. 新增卡片业务时，优先新增 `payload.type`，而不是新增 shell kind
4. `Card.tsx` 不再继续膨胀为业务总控组件
5. writer 的排序与挂载逻辑由统一 policy 驱动
6. `CardHeader.tsx` 继续是唯一标题栏实现
7. 任何未知 payload / projector / renderer 命中都会直接报错，而不是 fallback

---

## 十一、相关文档

- [07-panel-reactivity.md](07-panel-reactivity.md) — cardTreeStore 与 tree-writer 的反应式约束
- [07-panel.md](07-panel.md) — Overlay / Workbench 的整体面板布局
- [01-agents.md](01-agents.md) — GoalWorkflow 与 session kind 的来源
- [99-principles.md](99-principles.md) — 无 fallback、无双源、无补丁式扩张的总原则
