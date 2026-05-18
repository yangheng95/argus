# 会话级配置分级（Session Config Tier）方案

> 日期：2026-05-18
> 状态：codex 审查 R1→R4。**架构共识达成且边界已定稿**（R4：§11.2/11.3/12 闭环；§11.1 按 codex 定解写死于 §13）。唯一人工前置 = §13.4 死代码删除需用户 rule 17 确认。§6 用户决策有效。**最终架构 = §9 + §11 + §12 + §13（定稿）。§2/§3 历史推导已被推翻。**
> 参与：Explore×4 + research agent + 复核综合（rule 24/11）+ codex 审查×2（rule 35 末条）

---

## 0. 问题陈述

用户报告：**配置只有项目级、没有会话级，导致 model 等配置反复覆盖。** 根因：
1. `config/config.ts:252-265` `result.model ??= DEFAULT_MODEL` 写项目文件遮挡全局（rule 7 fallback）。
2. `server/routes/config.ts:100-108` PATCH /config → `Config.update()` 持久化项目级，对话内换 model 污染全项目。
3. Session.Info 无 model 字段，项目配置改动立即全局生效 → "反复覆盖"。

系统性缺陷：配置缺少会话作用域（rule 4）。

---

## 1. 调研结论（可复用原则）

Git/VSCode/Claude Code/ESLint/npm/Cargo → ① 最具体者胜 + 单调优先级，无 fallback 链 ② 类型感知合并 ③ 不可变 base + 稀疏 overlay ④ 作用域可观测（per-key origin）⑤ pinned invariant 层 ⑥ 单一解析点优于级联（opencorvus 只有 project+session，绝不目录级联）。

---

## 2-3. 架构（历史推导，已被 §8/§9 推翻）

初版主张"resolver 放 `Config.get()` 内、零穿透、唯一注入点 prompt/index.ts" —— **错误**，见 §8。最终架构 §9。

---

## 4. 复核方修订（rule 24/11/35）

- **A** 拒绝 `Config.get(sessionID?)` 改 95 处（rule 5/6/11 过度工程）。
- **B** `util/context.ts` 须加非抛出 `tryUse()`（CLI/控制平面无 session）。
- **C** 写路径分流，否则双源（rule 8）。
- **D** 删除 `config.ts:252-265` `model ??= DEFAULT_MODEL`（rule 7/17）。
- **E** pinned invariant 显式 + 测试。

---

## 5. 配置分级分类

| 层级 | 字段 |
|---|---|
| **Session 可覆盖**（§6 用户定最宽）| `model`、`agent.<name>.model`、`prompt.core_header`、`agent.<name>.prompt{,_append}`、`agent.<name>.temperature/top_p` |
| **Project base** | 路径、构建/交付流程、workflow、provider 默认 |
| **Pinned invariant** | 工具/命令权限、MCP server、provider 凭据、安全/成本闸门、channel |

---

## 6. 用户已拍板（锁定）

1. Session 可覆盖集合 = 最宽（model + agent.model + prompt 覆盖 + 运行期旋钮）。
2. 本次一并删除 `model ??= DEFAULT_MODEL`；首次无 model → `MissingModelConfigError` + 测试断言。
3. 新增 `PATCH /session/:id/config`；`PATCH /config` 语义不变；OpenAPI/SDK + 前端路由决策表测试（rule 36）。

---

## 7. 影响面（rule 35 穷举，以 §9 R2 修订后为准）

`Config.get()` 71 处 / `EngineConfig.get()` 25 处（单点入口 engine/config.ts:263）/ Agent registry 缓存全不动（§8.3 结构性免污染）。**会话可覆盖键的真实运行时出口见 §9.1**（R1 的"6 个 Config.get() 点"模型不完整，已被 §9 取代）。

注入侧 5 个会话执行入口（穷举 `loop(`/`SessionLoop`/`deps.loop`）：`session/prompt/index.ts:71`、`server/routes/session.ts:487`、`task-api/index.ts:320`、`session/wake.ts:91`、`session/shell-exec.ts:45`。统一 `SessionContext.provide(session, fn)`（复用 `util/context.ts`，rule 9）+ `tryUse()`。

测试（rule 28/36）：类型感知合并正反例 · pinned 不可弱化 · 并发 session 隔离 · `Agent.state` 不被污染 · 写路径分流契约 + OpenAPI/SDK · 前端读写一致 · "首次不再自动写 model" · overlay 深合并/null 删除。

---

## 8. Codex R1 审查反馈与修订（rule 35 末条）

| # | 原声明 | 判定 | 证据 |
|---|---|---|---|
| 1 | prompt() 唯一注入点 | 不成立 | `createUserMessage` 在 `Instance.provide` 前；绕过路径 session.ts:477/task-api:320/wake:91/shell-exec:44 |
| 2 | tryUse() 即可 | 存疑 | `EngineConfig.merge` 默认层 engine/config.ts:277 须定性为 engine 默认 base |
| 3 | 新路由消除双源 | 存疑 | `mergeMetadata` 浅合并 session/index.ts:399 |
| 4 | 删 config.ts:252-265 | 成立 | 严格解析已存在 model.ts:59,64、provider.ts:1017 |
| 5 | §7 满足 rule 35 | 不成立→重做 | **致命**：`Agent.state` Instance 缓存 agent.ts:83,432、state.ts:12 不分 session |
| 6 | 无状态机 | 存疑 | ambient 不算过度工程 |

**R1 修订**：① `Config.get()` 保持 base 不注入 overlay（结构性解 #5）② 注入 = 覆盖 5 入口的统一 wrapper ③ overlay 深合并 ④ 写路径 API+前端同改 ⑤ `EngineConfig` DEFAULTS 注释为 engine 默认 base。

**#5 解决依据**：`State.create`(state.ts:12) 缓存键 = `Instance.directory` 无 session 维度；`Config.get()` 不注入 overlay ⇒ `Agent.state` 读纯 base ⇒ 结构性免污染。codex R2 已确认此点闭环。

---

## 9. Codex R2 复审反馈与再修订（rule 35 末条，禁止静默重写）

> codex R2 结论：**NO**（#5 已闭环，但 §7.1 出口模型不完整 + §7.3 合并方案不安全 + 前端读源未定义 + 残留双实现）。逐条再修订：

### 9.1 【R2-1 取代 §7.1】会话可覆盖键的真实运行时出口（按数据流，非按 `Config.get()`）

codex 证实 prompt/temperature **不经** `Config.get()` 干净出口，而是经 `Agent.state` 缓存进运行时。按真实数据流分两类：

**(a) model —— 走 model 解析链，逐出口接 sessionID：**
- `agent/model.ts:59/78` `resolveAgentModel`/`resolveConfiguredModelRef`（已有 sessionID 入参，当前忽略 model.ts:53）
- `provider/provider.ts:1018` `Provider.defaultModel`
- **R2 新增遗漏出口**：`session/prompt/parts.ts:95`（createUserMessage 前置解析 `input.model ?? agent.model ?? defaultModel`）、`session/command-exec.ts:92-104,151-155`、`session/shell-exec.ts:52-55` —— 全部改走 `resolveAgentModel(agentName,{sessionID})`，否则 prompt 前解析绕过 overlay。

**(b) prompt(core_header / agent.prompt / agent.prompt_append) + temperature/top_p —— 经 `Agent.state` 缓存消费，需"session-resolved agent view"：**
- 真实出口：`session/llm.ts:68`（composeSystem 读 agent.prompt）、`session/system.ts:80`（`SystemPrompt.provider` 读 `cfg.prompt.core_header`）、`session/llm.ts:159`（temperature/top_p LLM 参数）、`agent/runner.ts:1276`、`build/agent.ts:1416`、`delivery/agent.ts:551`（prompt_append）。
- **不**改 `Agent.state` 缓存（保持 §8.3 免污染）。改为：新增**单一** helper `resolveSessionAgent(baseAgent, overlay)`（rule 9 单一抽象），在"agent 有效配置被消费以构造请求"的边界统一应用 —— 即 `session/llm.ts` composeSystem/params 与 runner/build/delivery 的 prompt 组装点。这是有界、可枚举的消费边界，仍单一来源、不双源、不级联。

### 9.2 【R2-4 阻塞】不得改通用 `Session.mergeMetadata` 为深合并

codex 证实：`mergeMetadata`(session/index.ts:400) 顶层浅合并，改深合并会破坏 `executor/session-ref.ts:68`（依赖整体替换语义，深合并会残留旧 `native_session_id` 等）。且 `mergeConfigConcatArrays`(config.ts:82) 私有、null 删除在另一私有 `mergeWithNullDelete`(config.ts:1698)。

**再修订**：① **不动** `Session.mergeMetadata`。② 从 `config.ts` 导出**单一** `Config.mergeOverlay(base, patch)`，内聚 concat-arrays + null-delete 两语义（合并两私有 helper 行为为一个导出 API，rule 9 单一来源、禁平行实现）。③ `PATCH /session/:id/config` handler：先 `Config.mergeOverlay(当前overlay, patch)` 得到完整新 overlay，再用现有浅 `mergeMetadata` 把 **整个 `configOverlay` 键**替换写入（浅替换一个已深合并好的子树，语义安全、不碰 mergeMetadata）。

### 9.3 【R2-5 阻塞】前端读源必须随写路径一起改

codex 证实：`AgentModelsPanel.tsx:85/105` 读 `appStore.config.*`（project base），若仅改写路由 → 显示 base、写 overlay，读写不一致。

**再修订**：新增 `GET /session/:id/config`（返回该 session 的 effective config + per-key origin，§1 原则④）。前端 session 场景：读走 effective、写走 `PATCH /session/:id/config`；项目设置场景仍读写 `/config`。两场景各自读写自洽，非双源（语义不同）。`overlay/src/services/config.ts` 新增 `patchSessionConfig`/`getSessionConfig`（不复用同名，语义分离）。

### 9.4 【R2-3/6 残留双实现，rule 17 须先报用户】

codex 发现 `session/prompt/command.ts`↔`session/command-exec.ts`、`session/prompt/shell.ts`↔`session/shell-exec.ts` 疑似重复实现（公开入口走 `*-exec`，旧文件 `deps.loop` 残留 rule 8/17）。**这是预存死代码，按 rule 17 不在本方案内静默删除**——单列为前置清理项，需用户确认后处理（见 §10）。它不阻塞本方案主体，但 §7.2 wrapper 落点须避开死路径。

### 9.5 成本再评估（诚实）

R1 的"6 消费点"被 R2 修正为"model 多出口接 sessionID + 单一 `resolveSessionAgent` 消费边界 helper"。总面：model 出口×6 + `resolveSessionAgent` + 5 入口 wrapper + `tryUse()` + `session/context.ts` + `Config.mergeOverlay` 导出 + `GET/PATCH /session/:id/config` + 前端读写双改 + SDK/OpenAPI + 测试。**中等偏大重构**。架构方向（base+overlay 单 resolver、不双源/不级联/不状态机）仍成立。

---

## 10. 待用户确认的前置清理项（rule 17，非阻塞主体）

`session/prompt/command.ts`、`session/prompt/shell.ts` 疑似与 `command-exec.ts`/`shell-exec.ts` 重复的死代码。是否在本方案前先清理？（rule 17 要求先报，不静默删。）—— 此项不阻塞共识，记录待答。

---

## 11. Codex R3 复审 + model 单源原则（rule 35 末条；架构共识定稿）

> codex R3 结论：#9.1(b)/§9.2 方向确认正确、`resolveSessionAgent` 不构成 rule 8/13；剩 3 项有界细节。**codex 同时揭示真正的根：model 在仓内本就有"config base / 消息信封 msg.info.modelID / `agent?.model ?? defaultModel` / 历史派生"多来源 —— 这是预存 rule 8 债**，session overlay 不能再叠一层来源，必须借本方案收口为单一来源。

### 11.1 model 单源原则（取代 §9.1(a) 的"逐出口"列法）

**唯一 model 解析器 = `resolveAgentModel(agentName, { sessionID | taskID })`，优先级单调单一**：

```
显式 per-request input.model（用户当次明确指定）
  > session overlay（agent.<name>.model > model）
  > project base（agent.<name>.model > model）
  > 无 → MissingModelConfigError（rule 7：不历史派生、不 defaultModel 兜底）
```

所有 codex R3 列出的并行 model 派生点 **全部收口到此解析器**（rule 8 去双源，rule 16 删旧范式）：
`session/prompt/parts.ts:95`、`session/command-exec.ts:92-104,151-155`、`session/shell-exec.ts:52-55`、`session/wake.ts:53-56,101-103`、`task-api/index.ts:466-479,192-220,267-274`、`agent/runner.ts:548`（taskID→session overlay 解析）、`tool/task.ts:111-140`（subagent：父 session overlay 经 SessionContext 继承）、`control/message.ts:58,217-230`。`Provider.defaultModel()` 的 `cfg.model` 读取并入 `resolveConfiguredModelRef`，不再独立兜底路径。

> rule 35 满足方式：本节给出**原则 + 全仓 grep 出的迁移目标清单**（codex R1+R2+R3 三轮累计穷举），而非"零遗漏"断言；任何新增 model 派生点即 rule 8 违规。

### 11.2 §9.2 并发写 → 事务化合并（codex R3-3 定解）

不做 caller-side read-merge-write（`session/index.ts:385-388` 已警告 race）。新增 **`Session.mergeConfigOverlay(sessionID, patch)`**：在 `storage/db.ts` 已有事务 Context 内做行内 `read → Config.mergeOverlay → write`，单行事务，杜绝并发丢更新。不动通用 `Session.mergeMetadata`。

### 11.3 §9.3 前端 session 源 → 明确组件状态（codex R3-4 定解）

`AgentModelsPanel` 增加显式 `scope` prop/状态（`'project' | 'session'`，由打开入口决定：会话设置入口=session、项目设置入口=project）。`scope==='session'`：读 `getSessionConfig(sessionID)`（effective+origin）、写 `patchSessionConfig`；`scope==='project'`：读 `appStore.config`、写 `patchConfig`。两路各自读写自洽，语义不同非双源。

### 11.4 共识声明

R2→R3 codex **无新增架构性反对**，仅枚举完整性（→§11.1 原则化解决）+ 2 个有界机制（→§11.2/§11.3 定解）+ 预存死代码（§10 待用户答，非阻塞）。**架构共识达成**：不可变 base + 会话独占 overlay + 单一 `resolveSessionAgent`/`resolveAgentModel` 消费边界 + 事务化 overlay 写 + ambient SessionContext，无双源/无级联/无状态机。实施面：中等偏大重构 + 收口预存 model 多源债。

---

## 12. 会话级可观测性隔离（用户 2026-05-18 追加）

用户要求：**trace log 等可观测产物也必须分会话隔离**。

借 §7.2 的 ambient `SessionContext`（已携带 sessionID）天然落地，无需额外穿透：

- **trace / log / 诊断**：写出时统一从 `SessionContext.tryUse()` 取 sessionID 打标；存储/查询按 sessionID 分桶；无 session 上下文（CLI/控制平面）归入对应非会话域，不混入任意会话。
- 范围：grep 现有 trace/log 出口（`trace`、`logger`、诊断/overlay 事件流、benchmark trace），逐处接 SessionContext 标签 —— 列入 §7 影响面普查的补充清单（实施前补全，rule 35）。
- 与配置隔离同构：同一 SessionContext 既驱动 config overlay 解析，也驱动可观测性分桶 —— 单一抽象多用途（rule 9），不新建并行 session 透传机制。

> 此项扩大了实施范围（新增 trace/log 出口普查 + 打标），但**不改动已达成的配置分级架构**，与 §11 共识正交叠加。

---

## 13. §11.1 边界定稿（codex R4：§11.2/§11.3/§12 已闭环，按 codex 定解收口 §11.1）

> codex R4 裁定：架构方向正确，唯一剩余是 §11.1 解析器边界与迁移清单未写死；"补齐后剩余降级为纯实现细节"。按 codex 自身给出的定解逐条写死：

**13.1 唯一解析器签名与单调优先级（写死）**
`resolveAgentModel(agentName, { sessionID?, taskID?, explicitModel? })` —— 解析器**外不允许任何 model 派生**。优先级单调：
```
explicitModel（per-request 用户当次明确指定，经此参数传入，是解析器外唯一允许的 per-request 输入）
  > session overlay（sessionID 或 taskID→其绑定 session 解析；agent.<name>.model > model）
  > project base（agent.<name>.model > model）
  > MissingModelConfigError（rule 7：无历史派生、无 Provider.defaultModel 兜底）
```

**13.2 迁移清单补全（codex R4 新发现并入；全仓三轮累计穷举）**
R3 清单 + 新增：`agent/agent.ts:545 Agent.generate`（`input.model ?? defaultModel` → 改 `resolveAgentModel({explicitModel:input.model})`）、`session/compaction.ts:357`（删历史派生 fallback，改 resolver，rule 7）。`Provider.defaultModel()` **删除为运行时路径**（rule 16 无兼容），其 `cfg.model` 读取并入 `resolveConfiguredModelRef`；保留即并行出口=rule 8 违规。

**13.3 taskID→session 与 subagent 继承（写死其一，消除"泛称 ambient 继承"）**
- `taskID` 解析：Task 有绑定 session，resolver 经 `taskID → task.sessionID → overlay`。
- subagent（`tool/task.ts:111`）：**在父 tool ctx 用 `ctx.sessionID` 解析一次，把 resolved explicit model 经 `explicitModel` 传入 child `SessionPrompt.prompt`**。不依赖 child session 的 ambient 继承（child SessionContext 会覆盖父，父 overlay 不自动传递——codex R4 证实）。即 subagent 显式继承、非隐式。

**13.4 §10 死代码升级为硬前置（rule 17 仍需用户确认）**
`session/prompt/command.ts`、`session/prompt/shell.ts` 含 `Provider.defaultModel()` 并行出口，在删除前是既存绕行点 → 从"非阻塞待答"**升级为 §13 的硬前置**：必须删除（rule 16/17），但 rule 17 要求先报用户确认。这是唯一需用户点头才能解锁实施的项。

**13.5 §12 trace 修订（codex R4）**
`trace/index.ts:252` 当前合成 `helper-*` 伪 sessionID —— 改为**显式 non-session domain 标签**，不得伪装成真实 session 桶（呼应 rule 15 禁伪造）。log 单点出口确认在 `util/log.ts:99 Log.create().build()`，在此接 `SessionContext.tryUse()` ambient tag。

### 13.6 最终共识声明

R1→R4 收敛轨迹：架构方向自 R2 起未再被否定；R4 明确仅 §11.1 精度问题，且 codex 自陈"补齐后降级为纯实现细节"。§13 已按 codex 定解逐条写死 §11.1 边界、迁移清单、subagent 继承、Provider.defaultModel 删除、trace 修订。**架构共识达成且边界已定稿**；唯一解锁实施的人工前置 = §13.4 死代码删除需用户 rule 17 确认。剩余均为纯实现细节，可进入实施。

---

## 14. 实施阶段化 + 每阶段 codex review（用户指令 2026-05-18）

实施分 7 阶段（Phase 0–6），每阶段 commit+push（走 hook）后由 codex 只读 review，NO 则修复后复审，YES 才进下一阶段。

**会话级 git 陷阱（事故记录，已修复 + 守卫）**：`packages/opencorvus` 内曾存在嵌套 `.git`（seeded baseline，全 untracked），Bash 从该目录运行的 git 命令全部打到内层仓而非父仓 `C:/Users/chuan/myhexin-local/opecorvus`（分支 `codex/agent-boundary-role-contract`），导致 commit/push 静默丢失。已隔离内层 `.git`，并新增 `test/project/no-nested-git.test.ts` 守卫回归（用户指令）。后续所有 git 命令用 `git -C <workspace-root>` 显式定位。

### 14.1 Phase 0 codex review 反馈与修订（rule 35 末条，禁止静默应用）

codex Phase 0 裁定 **NO**，4 阻塞项，已逐条修订（commit 见 Phase 0 fix）：

| # | codex 阻塞项 | 修订 |
|---|---|---|
| 1 | `Config.Overlay` 字段非 nullable，但 `mergeOverlay` 声称 RFC7396 null-delete；测试被迫 `null as never` 绕过校验，gate 与 merge API 脱节 | Overlay 全字段改 `.nullable()`：null 成为一等 schema 校验的删除信号；测试用真实 `null` 经 `Config.Overlay.parse` |
| 2 | base "不可变" 仅合并过程不改 target，`mergeWithNullDelete` 只浅 clone 当前层，未 patch 的嵌套子树与 base 共享引用 → 调用方后续 mutate 会污染 Instance 缓存（正是 §8.3 要防的） | `mergeOverlay` 改 `structuredClone(mergeWithNullDelete(...))` 深隔离；新增"mutate 未 patch 嵌套子树不污染 base"测试 |
| 3 | overlay 面比 spec 宽：`prompt` 任意 record、`variant` 未在 spec 记录（rule 35 implicit） | 精确化（见 §14.2）：`variant` 显式归入 model-selection 家族并写入 schema 注释；`prompt` 全 record 是**有意**（用户 §6-1 "最宽"，prompt 无安全/成本边界，区别于 .strict() 排除的 permission/tools/mcp/provider） |
| 4 | `no-nested-git` 第二测试名说 "trees" 实际只查直接子目录 | 测试名/注释收窄为 "no .git directly under src/test/script"，并注明非递归的理由 |

通过项：tryUse、session/context.ts（type-only import 避循环）、零行为变更、`.strict()` pinned-invariant 守门、OverlayAgent 显式声明不构成 rule 8/9 双源（Agent 是 `.transform()` 后 schema 无法 `.pick`）。

### 14.2 会话可覆盖面（精确定稿，取代 §5 草案的模糊表述）

`Config.Overlay`（`.strict()`，全字段 nullable 支持 RFC7396 删除）：
- 顶层：`model`、`prompt`（`Record<string,string>` 系统级 prompt 槽，任意 key，用户 §6-1 最宽决策）
- `agent.<name>`：`model`、`variant`、`temperature`、`top_p`、`prompt`、`prompt_append`

pinned invariant（`.strict()` 在 schema 边界拒绝，session 永不可覆盖）：`permission`、`tools`、`mcp`、`provider`、路径、安全/成本闸门等所有未列键。

