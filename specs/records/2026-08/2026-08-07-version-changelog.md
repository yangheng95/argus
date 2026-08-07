# Version Changelog

## Recall

### 用户原始要求

- 建立版本更新日志，从当前 `0.0.35beta` 开始记录。

### 验收指标

- 仓库有一个易发现、可持续维护的版本更新日志入口。
- `0.0.35beta` 是明确的记录起点，不倒推或虚构更早版本内容。
- 后续未发布变化与已发布版本有清晰边界，发布流程说明更新日志维护要求。
- 中英文 README 均能直接找到更新日志。

### 硬约束

- `packages/opencorvus/package.json` 仍是 release version 的唯一来源；更新日志不成为第二个运行时版本源。
- 产品展示使用紧凑版本名 `0.0.35beta`，代码元数据继续使用 SemVer `0.0.35-beta`。
- 不修改或运行 User Interface 自动化测试；本任务不改 User Interface。
- 不补写 `0.0.35beta` 之前的历史版本。

### 已读取资料

- 根 `AGENTS.md`。
- `RELEASE.md` 与 `docs/packaging.md` 的发布单一来源说明。
- `packages/opencorvus/package.json`、Tauri 配置及版本同步入口。
- 根中英文 README 的文档入口。
- `specs/README.md`、本月记录索引和 `2026-08-07-v0.0.35beta-branch-bump.md`。

### 全仓 grep 结果

- 仓库当前没有根 `CHANGELOG.md`，仅源码注释中存在一个无落点的 changelog 引用。
- `RELEASE.md` 是发布流程说明，不记录逐版本产品变化，不能同时承担更新日志职责。
- 当前 release family 已统一为 `0.0.35-beta`，当前产品分支为 `v0.0.35beta`。
- 根中英文 README 的 Documentation / 文档与贡献区是稳定的发现入口。

### 独立 Agent 反馈

- 用户未要求子 Agent 或并行审计；本次不启动子 Agent。

## Plan

1. 新增根 `CHANGELOG.md`，采用“未发布 + 按版本归档”的单一线性结构，并把 `0.0.35beta` 记为起始基线。
2. 在 `RELEASE.md` 写明发布时归档更新日志的责任与版本命名规则。
3. 在中英文 README 添加更新日志入口，更新 specs 两级索引。
4. 运行文档、版本、链接与 diff 检查，二次复核实际变更后提交并推送。

## Verification Ledger

- Pending implementation.
