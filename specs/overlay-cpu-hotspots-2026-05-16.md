# Overlay CPU 热点修复 spec — 2026-05-16

> 背景:两轮独立 agent 审查 overlay CPU 占用,**第三轮逐行复核发现前两轮具体行号大量不可靠**
> (text-part-model:255 不存在;card-tree 递归被 expanded()/status 短路;DiffView LCS 仅 tool 完成时算一次;
> "O(n²) 逐 token" 实为按 rAF 帧合并)。本 spec **只收录由 owner 亲自逐行核实过的项**,
> 并要求 codex 在改动前对每项再次复验前提,前提不成立即跳过并说明(rule 20/35)。

## 执行约束(codex 必须遵守)

1. **先复验,再改**:对下面每个 in-scope 项,先读当前代码确认前提仍成立。前提不符 → 跳过该项,在最终报告里写明"前提已变/不成立,未改"。禁止凭 spec 文字盲改(CLAUDE.md rule 20)。
2. **每项一个 commit**,message 前缀 `[overlay-cpu]`,英文,说明改了什么+为什么。
3. **每项配测试**(rule 28/36)。验证顺序:`bun run typecheck`(或对应包 typecheck)→ 仅跑新增/相关 test 文件。**禁止无参数 `bun test` 整套跑**。
4. 不传 `--no-verify`;pre-push hook 失败修根因(rule 33)。改完所有项后 push。
5. 范围之外的项(见 §4)**一律不要碰**——它们的前提已被复核证伪,改了就是制造噪音/技术债。

---

## §1 [in-scope, 高置信, 低风险] 定时器隐藏窗口时未真正暂停

### 已核实事实
- `packages/overlay/src/components/TracePanel.tsx:239-260`:`setInterval(..., 4_000)`(行 242)回调内仅 `if (document.hidden) return`(行 243);已有 `visibilitychange` 监听(行 248-254)但**只在变可见时 refresh,不暂停/重启 interval** → 定时器后台仍每 4s 唤醒 JS 事件循环。
- `packages/overlay/src/services/connection.ts`(`_monitorTimer = setInterval(tick, intervalMs)`,约 line 201):`tick` 内部 `isHidden()` 检查,但**定时器本身未暂停**。
- `packages/overlay/src/services/sse.ts:212-216`:`taskListRefreshTimer = setInterval(loadTasks, 30_000)`,**完全没有 visibility 检查**,后台仍每 30s 全量拉 task list。

### 正确范式(已存在于仓库,必须复用而非复制粘贴 — rule 9)
- `packages/overlay/src/services/clock.ts:43-57` `ensureVisibilityListener`:`visibilitychange` 时 `start()`/`stop()` 真正启停定时器。
- `packages/overlay/src/components/ChatComposer.tsx:201-211` `onVisibility`:hidden → `stopHint()`,visible → 重启。

### 要求
- 抽出**单一可复用工具**(如 `src/utils/visibility-interval.ts` 导出 `createVisibilityInterval(fn, ms): { start, stop, dispose }`):内部在 `document.hidden` 时清掉 timer、`visibilitychange` 变可见时重建;`dispose` 移除监听并清 timer。
- TracePanel / connection.ts / sse.ts 三处改用该工具。**不要改动 clock.ts**(它有自己的 refcount 变体,正常工作,属另一来源不在本次范围)——只为这三个未覆盖点提供复用件。
- 保留各处原有语义:TracePanel 仍需 `hasTarget()` 守卫;sse.ts 30s 刷新仍需在 SSE error 时存在的重连逻辑不被破坏;connection.ts monitor 间隔不变。
- **测试**:对工具单测——模拟 `document.hidden=true` 后推进时间,断言回调不触发且 timer 被清;`visibilitychange` 变可见后恢复触发;`dispose()` 后不再触发、监听被移除。

---

## §2 [in-scope, 平凡, 安全] Tauri release 构建包含 devtools 特性

### 已核实事实
- `packages/overlay/src-tauri/Cargo.toml:11`:`tauri = { version = "2", features = ["tray-icon", "devtools"] }` —— release 也编入 devtools 支持。

### 要求
- 改为 cargo feature 条件化:声明本 crate `[features]` 中的可选 `devtools = ["tauri/devtools"]`;默认 dependencies 不带 `devtools`;debug 场景按需 `--features devtools`。确保 `overlay_toggle_devtools` 相关命令在不带该 feature 时用 `#[cfg(feature = "devtools")]` 妥善条件编译,**不带 feature 时编译通过**。
- `cargo check`(必要时 `cargo build`)验证两种配置都编过。
- **不要改 `opt-level`**:`opt-level="s"→3/z` 属推测性低价值改动,本轮明确不做(rule 5/6 禁过度工程)。
- **测试**:Rust 侧 `cargo check`(默认 + `--features devtools`)作为验证;若有现成 CI/脚本入口走脚本。

---

## §3 [conditionally-in-scope, 真实但在最热数据路径] 流式 part 文本重建 + 整 part 对象 spread

### 已核实事实(注意:前两轮的"逐 token O(n²)"框架是错的)
- `packages/overlay/src/services/tree-writer.ts:272-301`:`queuePartDelta` 把 delta 累积进 `bufferedPartDeltas`,`buffered.delta += delta`(行 276)**只在单个 rAF 帧内累积**,`flushBufferedPartDeltas`(行 287-301)每帧 drain 并清空 buffer。**行 276 不是逐 token O(n²),不要按"整条消息累积"去改它。**
- 真实成本在 flush 后的全文重建:
  - `tree-writer.ts:990` `parts[idx] = { ...parts[idx], text: (parts[idx].text || "") + delta }` —— 每帧 spread 整个 part 对象(其 text 随消息增长)。
  - `tree-writer.ts:676` / `:685` `(prev) => String(prev ?? "") + delta` —— 同类全文重建。
  - 长消息下对 part-text 长度是 O(n²),但被帧率上限(≤60/s)bound,**非逐 token**。

### 要求(谨慎,前提不稳就停)
- 仅当能在**不改变 Solid store 响应式契约**的前提下,减少"整 part 对象 spread / 重复全文重建"开销时才动手(例如:per-part 累积 chunks 数组、flush 时一次 join 写入 text;或对 part.text 用更细粒度 `produce` 仅更新 text 字段而不 spread 整对象)。
- **必须**配回归测试:构造多帧 delta 流,断言最终 `parts[idx].text` 与渲染产物与改动前**逐字节一致**(行为不变,只降开销)。
- 若对 streaming 正确性/响应式订阅影响把握不足 → **停手,在报告里写清风险与证据**,不要打补丁(rule 20:无分析不打补丁;rule 28b:如实承认)。

---

## §4 [OUT OF SCOPE — 前提已被复核证伪,禁止改动]

| 误报项 | 复核结论 |
|---|---|
| `card-tree.ts` collectActivityCounts/collectTodoSummary "每秒 5–20 次全树递归" | 被 `Card.tsx`/`ChatBubble.tsx` 的 `expanded()` + `status==="running"` 两层短路,常见模式根本不执行。**不要优化。** |
| `DiffView.tsx` LCS "write tool 流式期间按 token 重算" | `InlineToolPart` 的 `toolDiffs` memo `if (status() !== "completed") return null`,LCS 仅 tool 完成瞬间算一次。**不要加投机缓存。** |
| `text-part-model.ts:255` 字符串拼接 | 该文件仅 130 行,无此行,findings 系幻觉。**完全忽略。** |
| `opt-level`、`backdrop-filter`、列表虚拟化、`structuredClone` 配置、board fieldChanged stringify | 推测性 / 低严重度 / 需更多证据,本轮不做。 |

> 任何对 §4 的"顺手优化"都视为违反 rule 35(凭单点采样泛化)与 rule 16(制造技术债)。

---

## 验收

- §1 §2 必做且通过测试 + typecheck;§3 视复验结果可做可停(停也要写明)。
- 最终报告需逐项给出:前提是否复验通过 / 改了什么 / 测试命令与结果 / 跳过项及原因。
- 全部完成后 commit(每项一个)并 push,pre-push hook 必须绿。
