# Snapshot 专项 Benchmark 设计与执行计划

> 目标：用一组无人值守可重复的脚本，对 `Snapshot` 子系统进行**正确性 + 安全性 + 性能 + 并发**全面验收，
> 并把每一个被验出来的真实 bug（不是补丁）落到 src，并加防回归用例。

## 0. 适用范围与非目标

- 仅针对 `packages/opencorvus/src/snapshot/index.ts` 与其调用面（`session/processor.ts`、`session/revert.ts`、`session/summary.ts`、`engine/git.ts`、`executor/managed.ts`、`task-api/index.ts`、`project/gc.ts`）。
- 非视觉测试，允许 headless（CLAUDE.md 规则 25 仅约束 overlay 视觉 benchmark）。
- 不引入任何 mock：Bun shell + 真实文件系统 + 真实 git。

## 1. 现状速览（来自源码 2026-04-29）

| 维度 | 结论 |
| --- | --- |
| API | `init / cleanup / track / patch / restore / revert / diff / diffFull` |
| 持久化 | `${Global.Path.data}/snapshot/<project.id>/` bare git repo（无 ref，无 reflog，靠 tree object hash 引用） |
| GC 触发 | 1) Scheduler 每小时跑 `cleanup()` → `git gc --prune=now`；2) `task-api.deleteTask` fire-and-forget 调 cleanup；3) `ProjectGC.apply` 把过期 project 整目录删 |
| 已有测试 | `test/snapshot/snapshot.test.ts`（51 例 unit）；**没有 benchmark / 端到端会话级模拟** |
| 观察到的高危设计点 | 所有 `track()` 写出的 tree 立刻 dangling — `--prune=now` 必然清掉它们；如果 cleanup 在活跃 session 中途触发，session 里保存的 hash **将无法再 restore** |

## 2. 假设清单（benchmark 要逐条验证）

H1. `track → modify → patch → revert` 的 round-trip 在所有平台等价（含 Unicode、binary、symlink、长路径）。

H2. `restore(hash)` 之后 worktree 完全等价于 `track()` 那一刻的状态——包括**snapshot 之外的多余文件应被删除**（否则用户回退后会留垃圾）。

H3. **关键**：`Snapshot.cleanup()` 之后，先前 `track()` 返回的 hash 仍可 `restore` / `patch` / `diff`（否则 hourly scheduler 会破坏活跃 session）。

H4. 多 worktree 并发 `track()` 时，hash 与各自 worktree 一一对应，互不串扰。

H5. `BASELINE_EXCLUDE` 真生效（`node_modules/`、`dist/` 等不会被 track 进 tree object），且用户 `.git/info/exclude` 的 `!negation` 规则比 baseline 优先。

H6. `track()` 和 `patch()` 在面对 `Instance.worktree` 含空格 / Unicode 时可用。

H7. 性能基线：1k 文件 track < 1.5s（非 first-call）、restore < 1.5s、diffFull 100 改 < 1s。

H8. 持续 100 轮 track 后磁盘占用受限于实际 blob 大小，cleanup 后**只回收 dangling 但不破坏当前可达**的对象。

## 3. Benchmark 子套件

文件：`packages/opencorvus/script/benchmark/snapshot-benchmark.ts`

每个套件返回 `{name, passed, durationMs, error?, metrics?}`，主函数收集后打印汇总并以非零退出码反馈失败数。

| 套件 ID | 验证 | 失败判定 |
| --- | --- | --- |
| `core.roundtrip` | track → 增/删/改 → patch.files 集合 = 真实变更集合；revert → 文件树字节级等于 baseline | 集合不等 / 内容不等 |
| `core.restore-removes-extras` | track baseline → 新增 N 个文件 → restore baseline → worktree 多余文件应消失 | 多余文件残留 ≠ 0（H2） |
| `gc.cleanup-preserves-active` | track h1 → cleanup → restore(h1) 必须成功 + 内容一致 | restore 失败 / 内容不符（H3） |
| `gc.task-delete-prune` | track 1 + track 2 → 模拟 task-delete 的 cleanup → 仍应可 restore 最近一次 | restore 失败 |
| `concurrency.parallel-track` | 4 个独立 worktree 同时 `track()`（同一 project.id 共享 bare repo 的话也要测） | 结果 hash 串扰 / write-tree 竞态报错 |
| `boundary.unicode-and-space` | worktree 含 "测试 dir"，文件名 "ümlaut 文件.txt" | track/restore 任一失败 |
| `boundary.binary-and-large` | 1 个 5MB 二进制 + 1 个 10MB 文本，verify diffFull 标 binary、track 不爆内存 | 二进制误标 / OOM / 超时 |
| `boundary.exclude-baseline` | worktree 内 `node_modules/x.js` + `src/x.js`，patch 只看到 src | node_modules 进了 patch（H5） |
| `perf.thousand-files` | 1000 文件 × 200 字节，记 track / restore / diffFull(100 改) p50/p95 | 越过预算 1.5×（H7） |
| `disk.cleanup-reclaim` | 100 轮 modify+track 后 du；cleanup 后 du 应明显下降；同时 H3 仍成立 | cleanup 不回收 OR 回收破坏可达 hash |

## 4. 输出与产物

- stdout：每个套件单行 `[ok|fail] name dur=__ms metrics=...`
- 末尾汇总：通过 / 失败 / 总耗时 / 退出码 = 失败数
- 失败时打印 expected vs actual 的 diff（必要时）。
- 不写入永久文件；临时目录 disposable。

## 5. 修复流程（每个 bug 一个 commit）

1. benchmark 跑出失败 → 在 `test/snapshot/snapshot.test.ts` 新增最小复现 `bun test`。
2. 必须 reproduce 后再改 src/snapshot；不允许只改 benchmark / 只改 test 来"绕过"失败（规则 20）。
3. 修源码，删旧分支（规则 16-17，no fallback）。
4. 重跑 unit + benchmark 两层 → 全绿 → commit + push（规则 33）。
5. 进入下一个 bug。

## 6. 已识别的高风险候选（先于 benchmark 的代码 review 发现）

### R1（高）— `cleanup()` 与活跃 hash 的冲突
所有 `track()` 写出的 tree object 一离开 `indexFile` 就成 dangling，`git gc --prune=now` 必然回收。Scheduler hourly 触发 + `deleteTask` 触发，都会使活跃 session 在保存的 hash 上失去 restore 能力。

可能的根治方向（实施前必须先用 benchmark 证实）：

- 选 A：每次 `track()` 把 hash 临时挂到 `refs/snapshots/<sessionId>/<n>` 这类引用上，cleanup 不会动它；session/task 终结时再删 ref。
- 选 B：把 GC 改为只在 instance dispose 后才跑，并加白名单 hash 集合。
- 选 C（不推荐 — 违反规则 7 fallback 哲学）：`--prune=2.weeks`。

### R2（中）— `restore()` 不删 snapshot 之外的多余文件
`read-tree + checkout-index -a -f` 只把 index 文件写出，不会清理 worktree 中"index 没有但磁盘有"的文件。这跟用户预期的"回到那一刻"不符。

### R3（中）— `syncExclude` 是 git/info/exclude 共享文件
并发 `track()` 共享 `info/exclude` 写入；per-call `indexFile` 解决了 index 竞态，但 exclude 仍是单文件，多 worktree 同时调 track 会相互覆盖。

### R4（低）— `track()` 错误未抛出
`.nothrow().text()` 若 git 失败会把 stderr/stdout 当 hash 返回，调用方拿到非 SHA 字符串也能跑下去，错误被静默吞掉（规则 1）。

## 7. 节奏与 cron

按 CLAUDE.md 附录，已设置 5min session-cron 警告自身严守规则。修复期间每个 commit 都 push；benchmark 全绿后再删 cron。

## 8. 验收

- benchmark 全绿；
- `bun test test/snapshot/snapshot.test.ts` 全绿；
- pre-push hook（typecheck / api:routes-check / docs:check）全绿；
- 二次 review：grep `Snapshot.cleanup`、`git gc`、`prune=` 三个关键字，确认没有遗留双源逻辑；
- 删 cron。
