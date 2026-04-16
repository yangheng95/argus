# new-arch — 架构文档（拆分版）

> 替代原 1336 行单 SVG。现在按「4 主题 MD + 3 瘦身 SVG」维护。
> 旧 SVG 已归档为 `_archive-old-arch.svg`，阶段 1 工作笔记为 `00-sync-notes.md`。

## 目录

### 总览（SVG 框图）
| 文件 | 展示内容 |
|---|---|
| [01-agents.svg](01-agents.svg) | 图 1 — Agent 家族调用链（Gateway → Loop → sub-agents → Executor） |
| [02-data.svg](02-data.svg) | 图 2 — 数据面（orchestrator 18 表 + Trace/Bus 横切） |
| [03-control.svg](03-control.svg) | 图 3 — 控制面与扩展入口 |

### 详细文档（MD）
| 文件 | 主题 | 对应旧 SVG Section |
|---|---|---|
| [01-agents.md](01-agents.md) | Agent 家族、调用链、Gateway / build-dispatch 分叉 | A · C · H · I |
| [02-data.md](02-data.md) | DB 表清单、Trace 横切、Decision Log | C · D · K |
| [03-control.md](03-control.md) | Channel / Gateway 路由、Bus、control-plane | L + 新 |
| [04-extensions.md](04-extensions.md) | Executor / Plugin / MCP / ACP 四条扩展入口 | G（扩展） |
| [05-config.md](05-config.md) | Unified Config 三层分离 + PATCH 流程 | F |
| [06-provider.md](06-provider.md) | LLM Provider 六层适配 | G |
| [07-panel.md](07-panel.md) | Workbench / Panel 重设计 + SSE 事件 | J |
| [99-principles.md](99-principles.md) | 核心原则、anti-patterns、非协商约束 | B · E |

### 归档与工作笔记
| 文件 | 说明 |
|---|---|
| [00-sync-notes.md](00-sync-notes.md) | 阶段 1 概念对齐笔记（三张 mental model 初稿） |
| [_archive-old-arch.svg](_archive-old-arch.svg) | 原 `specs/new-arch.svg`（1336 行）归档 |

## 三张总览框图（SVG 瘦身目标）

拆分完成后 `new-arch.svg` 只保留三张图：

1. **Agent 家族调用链**（图 1）—— Gateway → Orchestrator → Orchestrator → sub-agents
2. **数据面**（图 2）—— orchestrator 18 表 + 横切 Trace/Bus
3. **控制面 + 扩展入口**（图 3）—— channel/bus/control-plane + executor/plugin/mcp/acp

详细文字全部迁到上表的 MD。SVG 不再承载大段描述。

## 阅读顺序建议

- 想了解「任务是怎么执行起来的」→ 01 → 03 → 02
- 想接入新 channel 或工具 → 03 → 04
- 想改配置系统 → 05
- 想加新 LLM 提供商 → 06
- 想改面板 UI → 07

## 维护规则

1. **代码改了必须同步 MD**。MD 过时会导致后续读者误判，比 SVG 更糟（MD 权威性更强）。
2. **每个 MD 顶部必须写「对应代码位置」**，做到一键跳转。
3. **新概念先加 MD，再改 SVG**。SVG 只是图形化概要。
4. **禁止把 MD 长文字塞进 SVG `<text>`**。SVG 只留标题和关键词。

## 迁移进度

- [x] 目录 + README + 骨架
- [x] 01-agents.md 填充
- [x] 02-data.md 填充
- [x] 03-control.md 填充
- [x] 04-extensions.md 填充
- [x] 新 SVG 三张总览图（01/02/03-*.svg）
- [x] 旧 new-arch.svg 归档为 `_archive-old-arch.svg`
- [x] 工作笔记归入 `00-sync-notes.md`
- [x] 05-config.md · 06-provider.md · 07-panel.md · 99-principles.md 全部填充
- [x] `src/calculator/` 已删除（零消费者，git rm）
