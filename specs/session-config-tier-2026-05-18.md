# 会话级配置分级（Session Config Tier）方案

> 日期：2026-05-18
> 状态：团队共识已达成，**3 个产品/范围决策用户已拍板**（见 §6，已锁定）
> 参与：Explore×3（现状/影响面/ambient 上下文）、research agent（成熟框架调研）、复核综合（rule 24/11）

---

## 0. 问题陈述

用户报告：**配置只有项目级、没有会话级，导致 model 等配置反复覆盖。**

根因（带证据，来自现状调查）：

1. **首次初始化把默认模型写进项目文件** —— `config/config.ts:252-265` `result.model ??= DEFAULT_MODEL`。项目首次运行无配置文件时，自动把 `DEFAULT_MODEL` 写入项目级 `opencorvus.json`，从此**项目文件遮挡全局配置**。这是一个 rule 7 禁止的 fallback。
2. **UI 切换模型直接写项目文件** —— `server/routes/config.ts:100-108` PATCH /config → `Config.update()` → 持久化到项目级 `opencorvus.json`。用户在某次对话里换模型，污染整个项目。
3. **无会话绑定** —— `session/index.ts:135-179` Session.Info 没有 model 字段；`agent/runner.ts:542-551` 只支持 `input.model` 显式一次性覆盖。同一 task/不同 session 之间，任何对项目配置的改动立即全局生效，造成"反复覆盖"。

结论：这不是单点 bug，是**配置缺少会话作用域**的系统性缺陷（rule 4）。

---

## 1. 成熟框架调研结论（可复用原则）

| 系统 | 分级模型（低→高） | 合并规则 |
|---|---|---|
| Git | system→global→local→worktree | 就近优先，per-key last-wins；worktree 级 opt-in |
| VSCode | Default→User→Workspace→Folder | 类型感知：标量/数组覆盖，对象深合并 |
| Claude Code | User→Project→Local→CLI→Managed | 类型感知合并；`deny` 并集且不可被弱化（pinned invariant） |
| ESLint flat | 单文件有序数组 | 放弃目录级联，单一解析点 |
| npm/Cargo | builtin→global→user→project→CLI/env | 就近优先；列表 join，标量覆盖 |

**提炼的设计原则：**

1. **最具体者胜 + 单调优先级**，永远单向，无 fallback 链、无双向回退。
2. **类型感知合并**：标量 last-wins、对象深合并、数组按字段定策略（不可隐式）。
3. **不可变 base + 稀疏 overlay**，base 单一来源、会话期内冻结。
4. **作用域必须可观测**：每个 key 能报告 `origin: project | session`（等价 `git config --show-scope`）。
5. **pinned invariant 层**：某些 key 会话**不可**覆盖（安全/成本/权限类），overlay 之后强制回灌。
6. **单一解析点优于级联**（ESLint 教训）：opencorvus 只有 project + session 两个概念作用域，绝不引入目录级联。

---

## 2. 共识架构：不可变 base + 稀疏 session overlay + 单一 resolver

```
projectBase  : Config.Info        // 单一来源，Instance 级缓存，会话期冻结、只读
sessionOverlay: Partial<Config.Info>  // 稀疏 delta，会话独占，key 缺席 == 继承 base
resolve(base, overlay) -> ResolvedConfig   // 唯一的 tier 合并点
  标量: overlay 出现即胜；对象: deepMerge(base, overlay);
  数组: 按字段文档化策略并写测试; pinned invariant 最后强制回灌;
  附带 per-key origin
```

- **不是 fallback，是 overlay**：恰好两个输入、一次合并。"会话缺失则查 X 再查 Y"被禁止。满足 rule 7/8（单一来源、唯一合并点在 resolver）。
- **会话隔离**：每 session 独占 overlay；base 不可变 ⇒ 结构上保证 session 之间、session→project 都不可污染。

---

## 3. 关键实现接入点（基于 ambient 上下文调查，避免穿透 95 个调用点）

项目**已有** AsyncLocalStorage 抽象 `util/context.ts`（`Context.create` → `use()/provide()`），已被 Instance（directory 级）、Database（事务级）使用。**复用它新增 session 级 Context，无需改 95 个 `Config.get()` 签名。**

1. **新增 `session/context.ts`**：`export const SessionContext = Context.create<Session.Info>("session")`（rule 9 复用已有模式，非新造）。
2. **唯一注入点 `session/prompt/index.ts:45-72`** —— 每个会话执行必过、与来源（路由/CLI/内部）无关，且 `Instance.provide()` 已在此建 directory 上下文，正交叠加：
   ```ts
   Instance.provide({ directory: session.directory,
     fn: () => SessionContext.provide(session, () => loop({ sessionID: session.id })) })
   ```
3. **唯一 resolver 在 `config/config.ts` `get()`** —— 读取 session overlay（若在 session 上下文中）并 `resolve(base, overlay)`。这是 tier 合并的**唯一**位置。
4. **持久化载体：`Session.metadata.configOverlay`** —— SQLite JSON 列，已有 `Session.mergeMetadata()` 原子 patch，与 executor/gateway 用法一致。无新表、无迁移（rule 18 友好）。

成本估计：约 50–80 行，**无 API 签名穿透、无数据库迁移**。

---

## 4. 复核方对 agent 结论的 challenge 与修订（rule 24/11/35）

> 三个 agent 均未触及以下硬问题，**静默采纳即假共识**。以下为复核修订，已并入上文方案：

- **【修订 A — 拒绝 95 调用点穿透方案】** 影响面 agent 建议给 `Config.get(sessionID?)` 加参数并改 ~95 处。这是 rule 5/6 明令禁止的过度工程，且制造参数穿透地狱。**拦截该设计（rule 11）**，改用已存在的 ambient Context（§3）。

- **【修订 B — `Context.use()` 会抛错】** `util/context.ts` 的 `use()` 在无 store 时 `throw NotFound`。`Config.get()` 也被 CLI / 控制平面（无 session）调用。必须给 `Context` 抽象**新增一个非抛出访问器**（`tryUse()` / 返回 `undefined`），resolver 处 `const s = SessionContext.tryUse()` 缺席即纯 base。这是对共享抽象的正当扩展，非补丁。

- **【修订 C — 写路径必须分流，否则双源仍在（rule 8）】** 仅加 overlay 读不够。当前 PATCH /config（`server/routes/config.ts`）把 model 写**项目文件**——这正是"反复覆盖"主因。若不分流，model 会同时存在于"项目文件 + session overlay"=双源（rule 8 违规）。必须区分两类写：
  - **"改项目默认"** → `Config.update()` → 项目文件（保持）。
  - **"改本会话"** → `Session.mergeMetadata({configOverlay})` → 不碰项目文件。
  这是接口契约变更，需 rule 36 测试（正反例 + OpenAPI/SDK 同步 + 前端客户端路由决策表）。**写路径分流的 API 形态是待决策项**（§6-3）。

- **【修订 D — 首次初始化的默认写入是独立 fallback bug（rule 7/17）】** `config/config.ts:252-265` `result.model ??= DEFAULT_MODEL` 把默认模型写进项目文件、遮挡全局，本身是 rule 7 禁止的 fallback、rule 17 的过度行为。**建议删除该自动写入**，model 必须来自全局或项目的显式配置，缺失则维持 `MissingModelConfigError`（`agent/model.ts` 现有严格行为，符合 rule 1）。**是否本次一并删除是待决策项**（§6-2）。

- **【修订 E — pinned invariant 集合必须显式（研究原则 5）】** 必须明确哪些 key 会话**不可**覆盖，并在 resolver 中 overlay 之后强制回灌，附测试断言"session 无法弱化它们"。集合内容是待决策项（§6-1）。

---

## 5. 哪些配置需要分级（分类草案，待 §6-1 确认）

| 层级 | 字段（示例） | 理由 |
|---|---|---|
| **Session 可覆盖** | `model`、`agent.<name>.model`、`prompt`/`agent.<name>.prompt{,_append}` 覆盖、temperature 类运行期旋钮 | 一次对话内的实验性/任务性选择，不应污染项目 |
| **Project 级（base，session 不写）** | 路径、构建/交付流程、workflow、provider 默认 | 团队共享、跨会话稳定 |
| **Pinned invariant（session 不可覆盖）** | 工具/命令权限、MCP server 定义、provider 凭据、安全/成本闸门、channel 配置 | 安全与成本边界，类比 Claude Code `deny` 并集不可弱化 |

---

## 6. 用户已拍板的 3 个决策（已锁定）

1. **Session 可覆盖集合 = 最宽**：放开 `model`、`agent.<name>.model`、`prompt`/`agent.<name>.prompt{,_append}` 覆盖、temperature 类运行期旋钮。§5 表格"Session 可覆盖"行即最终集合。
2. **本次一并删除 `model ??= DEFAULT_MODEL`（修订 D）**：删除 `config/config.ts:252-265` 的默认写入；首次运行无 model 配置直接 `MissingModelConfigError`（更严格、显式，符合 rule 7/16/17）。需配测试断言"首次初始化不再自动写 model"。
3. **新增独立路由 `PATCH /session/:id/config`**：作用域显式、与 Session 资源对齐。`PATCH /config` 维持仅写项目级、语义不变（避免一个路由双语义=隐式双源）。新路由需 OpenAPI/SDK 同步 + 前端客户端路由决策表测试（rule 36）。

---

## 7. 影响面（rule 35 穷举普查结论）

- 配置读取调用点 ~103 处（Config.get ~80 / EngineConfig.get ~15 / 其他 ~8），写入 4 处。
- **采用 ambient Context 方案后，读取调用点零改动**（核心收益）。
- 需改：`util/context.ts`（+非抛出访问器）、`session/context.ts`（新增）、`session/prompt/index.ts`（注入 1 处）、`config/config.ts`（resolver + 删 D）、写路径路由（按 §6-3）、`session/index.ts`（overlay schema 入 metadata）。
- 测试（rule 28/36）：resolver 类型感知合并正反例、pinned invariant 不可弱化、session 间隔离、写路径分流契约 + OpenAPI/SDK 同步、"首次初始化不再自动写 model"断言。
