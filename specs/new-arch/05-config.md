# 05 — Unified Config

> 对应代码：`src/config/config.ts` · `src/engine/config.ts` ·
> `packages/overlay/src/store/` · `src/panel/capability.ts`
> （注：旧 `src/panel/settings.ts` 和 `src/panel/api.ts` 均已删除；`src/panel/` 当前只剩
> `capability.ts` — 见 [03-control.md](03-control.md) 对话层 action 白名单）

## 统一设计 — 三层分离

每个关注点**有且仅有一个真值源**，不重复、不跨层同步。

### Layer 1: Config.Info — 项目配置（唯一权威源）

- **存储**：`opencorvus.jsonc`（文件层级合并：managed → global → project → local → env）
- **验证**：Zod schema（完整，无 `as any`）
- **接口**：`GET /config` · `PATCH /config`（JSON Merge Patch RFC 7396）· SSE `config.changed`

**字段分组**（来源：`src/config/config.ts` 的 ConfigSchema）：

```
顶层：      $schema · logLevel · server · share · autoupdate · snapshot · watcher
           disabled_providers · enabled_providers · tool_permissions
           provider · model · small_model · default_agent · agent · mcp · lsp ·
           formatter · permission · compaction · preview · terminal
           channel · command · skills · plugin · prompt · instructions ·
           username · locale

assistant: requirements{} · architect{} · acceptance{} · acceptance_visual{} ·
           frontend_design{} · intent_analysis{} · build{} · activity{} · debug{} ·
           default_workflow · workflows[] · max_executor_groups
           每个 agent 子项的形状是 agent 特化的（例如 build 只有 max_steps + skills；
           acceptance 多一个 max_retries；acceptance_visual 全是数值硬门槛阈值）——
           没有统一的 max_steps/timeout_ms/quality_threshold/max_attempts/skills 模板。

experimental: auto_question · batch_tool · disable_paste_summary · continue_loop_on_deny
             memory{} · mcp_timeout · primary_tools · openTelemetry
```

> 文档此前未列出的顶级 key：`$schema` / `logLevel` / `server` / `share` / `autoupdate` / `snapshot` / `watcher`（含 `watcher.ignore`） / `disabled_providers` / `enabled_providers` / `tool_permissions`（任务级权限默认值） / `small_model` / `default_agent` / `preview` / `terminal` —— 全部以 `config.ts` 现状为准。
>
> **2026-05-11 新增**：顶级 `locale: "en-US" | "zh-CN"` —— operator-selected system language used for assistant replies and Overlay localization（commit `c19da3136` / `bdc33b9b0`）。**这是行为类设置**（影响 LLM 回复语言 + SDK 透传），属 Layer 1，**不**属 Overlay UI 偏好的 `locale`（后者继续存在于 localStorage，仅控制前端 UI 文案）。
>
> **2026-05-12 更正**：以下旧 schema 字段已删除，不再存在：
>
> - `assistant.spec{}` / `assistant.goal{}` / `assistant.planner{}` / `assistant.evaluator{}` /
>   `assistant.adaptive{}` —— planner / acceptance review 整体下线（见 [01-agents.md](01-agents.md)），
>   spec/goal/adaptive 字段在 workflow 系统替代后删除。
> - `experimental.unattended` / `experimental.auto_permission` —— 仅剩 `experimental.auto_question`。

**关键原则**：此层决定「系统做什么」，跨设备/session/客户端一致。
行为类设置（如 `experimental.auto_question`）属于此层，**不属于 UI 偏好**。

### Layer 2: Overlay Preferences — 客户端 UI 偏好

- **存储**：localStorage（每设备/浏览器独立）
- **不同步到 server**
- **不影响系统行为**

**字段**：

- 连接：`serverUrl` · `autoServer` · `password`
- 工作区：`directory` · `directoryMode` · `initGit`
- 外观：`theme` · `zoom` · `locale` · `sidebarCollapsed`
- 布局：`sidebarWidth` · `sectionsWidth` · `showTranscriptDetails`
- 身份：`username`（本地显示名，可选覆盖 Config）

### Layer 3: Session State — 运行态

- **存储**：Solid store（页面关闭即消失）
- 重连时从 server API 恢复，**不从 config 或 localStorage**

**字段**：

- `workspaceTaskID` · `workspaceDirectory`
- `savedDirectory` · `tempDirectory`
- `workspaceEpoch` · `directoryEpoch`

## 已删除的内容（本方案执行后）

| 项                                                                              | 代码路径                         | 状态                                           |
| ------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------- |
| `PanelSettings` namespace                                                       | ~~`panel/settings.ts`~~          | 已删除                                         |
| `panel/api.ts`                                                                  | ~~`panel/api.ts`~~               | 已删除（路由由 `server/routes/panel.ts` 承担） |
| `syncUnattendedConfig()`                                                        | `overlay/src/services/config.ts` | 已移除双向同步                                 |
| localStorage keys `oc_unattended` · `oc_auto_permission` · `oc_auto_question`   | overlay                          | 改读 server config                             |
| Overlay `updateConfig()` 全量替换                                               | overlay                          | 改为 partial diff                              |
| 死字段 `spec{}` · `max_replans` · `same_plan_retry_limit` · `stage_max_retries` | config schema                    | 已废弃                                         |

## 数据流（重设计后）

```
opencorvus.jsonc ──→ Config.get() ──→ Zod 验证 + 层级合并 ──→ 缓存
                      │
                      ├─→ EngineConfig.get()     合并 DEFAULTS，返回完整 typed config
                      ├─→ GET  /config                  → Overlay appStore.config (reactive)
                      ├─→ PATCH /config {partial diff}  → mergeDeep → 写文件 → 重置缓存
                      └─→ Bus "config.changed"          → SSE → 所有 Overlay 实例刷新
```

**关键变化**：

1. Overlay 不再 `GET→clone→mutate→PATCH` 全量，只发变化字段
2. Config 变更后 SSE 推送，所有 Overlay 自动 `setAppStore("config", newConfig)`
3. `scaffoldProjectConfig` 直接导入 `EngineConfig.defaults`，不硬编码

## 并发策略

**不做 ETag / 乐观锁** — 单用户本地工具，并发竞态概率极低，避免过度工程化。

## 相关文档

- [07-panel.md](07-panel.md) — Panel 配置 UI 如何映射到 Config.Info
- [02-data.md](02-data.md) — Config.changed Bus 事件与 SSE 通道
