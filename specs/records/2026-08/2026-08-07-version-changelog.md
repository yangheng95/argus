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

- Root `CHANGELOG.md` now contains one `未发布` staging area and the dated `0.0.35beta` starting baseline; no earlier release history was reconstructed.
- `RELEASE.md` defines the unreleased-to-release archival step without changing `packages/opencorvus/package.json` as release-version authority. Both root READMEs link the changelog.
- `bun run version:check`, `bun run docs:check`, `bun run api:routes-check`, and `bun run overlay:i18n-check` passed.
- The AGENTS-mandated `packages/opencorvus/test/script/historical-docs-links.test.ts` path does not exist in this checkout, so it was not claimed or run.

## Bun 1.3.14 Dependency Continuation

### Recall

#### 用户追加要求

- 更新全仓的 Bun 依赖到 `1.3.14`，改正仍在使用旧版本的现行规范，并移除 lockfile 中的旧 package。

#### 验收指标

- 根 workspace 的 `@types/bun` 与 `bun-types` 解析到 `1.3.14`。
- 可独立构建的 `ai-coding-tool-decision-site` artifact 使用 `bun@1.3.14`，并由同版本 Bun 重新生成 lockfile。
- 旧 `@types/bun@1.3.9`、`bun-types@1.3.9` 和现行 `packageManager: bun@1.3.13` 不再存在于活动依赖图。
- 历史 records 与带日期的调查数据保持原始实证，不把过去实际使用的 `1.3.13` 改写成 `1.3.14`。

#### 硬约束

- 使用 Bun `1.3.14` 自身更新依赖与 lockfile，不手工编辑 lockfile package rows。
- 根 `package.json` 仍是 workspace Bun 版本规范的唯一来源；独立 artifact 明确声明同一版本。
- 删除范围只限被新解析结果取代的旧 package rows；不得按 `pkg` 字样误删业务代码、Cargo `pkg-config` 或历史证据。

#### 全仓 grep 结果

- 根 `packageManager`、构建文档、Docker 默认参数与持续集成 setup action 已使用 `1.3.14`。
- 根 catalog 仍固定 `@types/bun: 1.3.9`，对应 lock rows 仍含 `@types/bun@1.3.9` 与 `bun-types@1.3.9`。
- `specs/artifacts/ai-coding-tool-decision-site/package.json` 是唯一仍使用 `packageManager: bun@1.3.13` 的现行可构建 manifest，并有自己的 `bun.lock`。
- `specs/records/**` 与该 artifact 的研究数据中其余 `1.3.13` 均描述历史运行事实，不是活动版本规范。

### Continuation Plan

1. 安装并验证仓库要求的 Bun `1.3.14` 工具链。
2. 把根 catalog 的 Bun 类型依赖和独立 artifact 的 package-manager 声明统一到 `1.3.14`。
3. 分别由 Bun `1.3.14` 更新两个 lockfile，确认旧 package rows 被新解析结果替换。
4. 完成版本、依赖、类型、文档和 diff 验证，再继续更新日志交付与推送。

### Continuation Verification Ledger

- The official installer placed Bun `1.3.14` at the user toolchain path, resolving the pre-push rejection from Bun `1.3.13` without bypassing the hook.
- Bun `1.3.14` regenerated the root lockfile from catalog `@types/bun: 1.3.14`. The resulting graph contains `@types/bun@1.3.14` and `bun-types@1.3.14`; the old `1.3.9` package rows are absent. Its current lockfile format also canonicalized registry tarball URL fields to empty values.
- The independent decision-site manifest now declares `bun@1.3.14`; Bun `1.3.14` accepted its existing canonical lockfile unchanged and its real Vite production build completed after transforming 612 modules.
- The first normal frozen install passed, but a later full `--force` reinstall encountered Windows `EBUSY` on concurrently used `zod` and Tauri CLI packages. The Bun type packages themselves were present in the `1.3.14` install store; their stale root projections were replaced from that exact frozen store, and both installed package manifests then reported `1.3.14`.
- A second `bun run typecheck:fresh` cleared all task caches and passed all eight workspace TypeScript tasks against the installed `1.3.14` type packages with zero cached tasks.
- Historical records and dated research evidence that truthfully mention Bun `1.3.13` remain unchanged.
- Commit `22ee7bcf9a` contains only the changelog, its README/release links, Bun dependency metadata, the Bun-generated lockfile, and this record. Concurrent open-source acknowledgement and index edits remained unstaged.
- The full pre-push hook passed typecheck, API routes, documentation, Overlay internationalization, and secret scan. GitHub then rejected the already-converged branch history because historical package commits contain multiple files above GitHub's 100 MB object limit; no history rewrite or Git Large File Storage migration was attempted inside this changelog task.
- Two direct legacy remote refresh attempts, including the canonical `.git` URL with Schannel and OpenSSL backends, failed during TLS negotiation before Git could read the remote ref. The local delivery is therefore committed and verified but not remotely published.
