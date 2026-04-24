# 交付质量门：系统性修复方案

**起因**：2026-04-24 ainvest 任务（`D:/myhexin-local/ainvest`）跑了 26 轮 delivery picky loop，最终交付为空骨架页面（chart 区全是浅灰占位），但全链路自判 accept。时间线证明第 14 轮（22:30）质量最好，之后的 picky loop 反向把内容越修越少，最终定版成空骨架。

**诊断参考**：`.opencorvus/worktrees/goal-goal-ts6r0xni/.opencorvus/goal-report.json`（goal-agent 自述 "SPA cannot be scraped with static tools" + `test -f` 自证 + 67 字节伪造 reference.png）、`.opencorvus/delivery-screenshots/`（26 轮截图退化轨迹）。

---

## 问题本质

最根本的一层（2026-04-24 复盘补充）：**delivery LLM 结构性地看不到自己的渲染结果**。

查 `packages/opencorvus/src/delivery/tools.ts`：

| 工具 | 返回给 LLM 的内容 | 是否包含图像 |
|---|---|---|
| `screenshot` | `path`, `sha`, `bytes`, `pixel_variance`, `degenerate` | ❌ 无图像 |
| `verify_page_integrity` | 6 层 JSON (http / asset / dom / js / pixel / expected) | ❌ 无图像 |

tools.ts:416 原话："When you need to view the image contents, pass the returned path to **read_file on the next iteration** (delivery retries inject prior-run screenshots back as multimodal input)"——工具主动不喂图；LLM 必须显式 `read_file(path)` 才能在下一轮被 multimodal 注入。LLM 看到 `passed: true` 基本不会再走这一步。

加上 run aborted 情况下 `orchestrator/tools.ts:2170+` 的 `deliver()` 未执行，首个 delivery prompt 的 `rendered_output` 多模态注入也没发生——整个 delivery 会话**从开始到 accept 都没有自己渲染页面的图像进入 LLM 视觉输入**。26 轮迭代里 LLM 拿到的是：一张 reference 图（来自用户附件）+ 一串"页面渲染了"的数字/布尔，然后**凭想象**说"差不多"。

其上还叠着几层传统结构缺陷：

- Design-analyst 可以用 67 字节伪造 PNG 做 reference（无 byte/entropy 门）
- Goal-agent 可以用 `test -f` + 自造 grep 规则自证 accept（checks 无 allowlist）
- Picky loop 允许每轮比上一轮更差，没有 last-known-good 回滚，也不 commit 中间态
- 上游"SPA 抓不到就用文本 spec 糊脚手架"这条 fallback 路径没人堵

违反 CLAUDE.md 的 rule 1（禁 fallback）、rule 4（看见 bug 思考本质）、rule 11（禁关键字匹配规则）、rule 12（视觉 benchmark 必须以视觉呈现）、rule 21（改动前后必 commit）、rule 23（禁状态机硬编码流程）。

---

## 修复方案

### P0-0 · Delivery LLM 必须真正看到自己的渲染图（`src/delivery/tools.ts` + `src/orchestrator/tools.ts`）

> **状态（2026-04-24）**：Stream A.A（tool 返回 multimodal）+ A.B（render 失败强制 reject）✅ 已交付。
> 实现要点：
> - `delivery/tools.ts:screenshot` / `verify_page_integrity` 改用 `buildMultimodalToolResult`（来自 Phase 1 stub `delivery/tool-result.ts`）。tool result 现包含 `text`（结构化 JSON）+ `attachments[{type:"file", mime:"image/png", url:"data:image/png;base64,…"}]`，与 `session/message.ts:toModelOutput` 既有约定对齐 → LLM 在**当轮**就看到 PNG，不再依赖永远不会触发的 read_file 自助。失败路径仍 text-only（绝不附带过期截图，rule 1）。
> - `orchestrator/tools.ts:deliver()` 把 render 提升为视觉任务的硬前置：无 `index.html` / puppeteer 抛错 → 立即构造 verdict=rejected（category=visual，attribute 到全部 goal）写 verdict artifact + evaluation + 新 attempt + 决策日志 + `requestStopAfterCurrentStep("delivery_render_rejected")`，**完全跳过 DeliveryAgent.verify**。彻底堵掉 "LLM only sees reference" 降级路径。
> - 未触及 `delivery/agent.ts` picky-loop 内部：每轮 repair 后重新渲染那条还需要 Stream C'（LKG repair loop）一并设计，避免双源改 agent.ts。

**目标**：消除"LLM 只看数字不看图"的架构缺陷。没有这一条，后面所有基于"LLM 视觉判决"的条款都是空的。

违反 CLAUDE.md rule 12（"视觉有关的 benchmark 必须以视觉呈现"）：当前工具把视觉产出降维成数值报告再交给 LLM，相当于 headless overlay。

**两处同时改**：

1. **Tool 返回值本身必须携带 PNG**（不再是 path 字符串）
   - `screenshot` / `verify_page_integrity` 改为返回 multimodal tool result：文本结构化字段 + image content part（AI SDK `ToolResult` 支持 mixed content）
   - 禁止仅返回 `path` + 数字让 LLM 靠 `read_file` 自助——这条"自助"路径事实证明从未被触发
   - Tool 返回的 PNG 进入 **当轮** LLM 的视觉输入，不是下一轮 retry

2. **首个 delivery prompt 强制注入 `rendered_output`**，不分路径
   - `orchestrator/tools.ts:deliver()` 里的 puppeteer 渲染步骤必须成为 delivery session 的**前置条件**，而不是 phase=delivery happy path 里的可选步骤
   - Run aborted 恢复后走 delivery 也必须先跑这一步；渲染失败 → 整个 delivery 直接 `rejected`（禁止"LLM only sees reference" 的降级路径，rule 1）
   - 每一轮 repair 结束后重新渲染 merged worktree，刷新 `rendered_output` attachment；下一轮 LLM 看到的是当前状态的图，不是初始 merge 的图

**验收**：delivery session 的 LLM request 里，message parts 至少包含 1 张 reference image + 1 张 rendered_output image（multimodal inlined，不是文件路径字符串）；每一轮 tool call 后再返回至少 1 张当轮新截图。可通过打印 LLM request body 的 multimodal parts 数量核验。

---

### P0-A · Reference 真实性闸（`src/design-analyst/capture-gate.ts` 新增） ✅ DONE (Stream B, commit 7f53a3de6, 2026-04-24)

> **实现要点**：
> - `capture-gate.ts` 实装 `captureReferenceManifest`：puppeteer networkidle2 → fonts.ready → content-paint waitForFunction（canvas 有像素 OR main bbox > 200×200）；任一环节失败抛 `CaptureGateError(stage)`
> - Manifest 字段全部填实：screenshot/dom sha256、HAR 大小（累加 content-length）、非白像素占比 / 4bit-bucket 唯一色 / top-16 调色板 / layout 命名 bbox（chart/sidebar/toolbar/header/footer/main）/ innerText 归一的 reference_strings
> - 产物落盘 `outDir/{manifest.json, screenshot.png, dom.html}`，供下游 replay / P1-B 消费
> - 像素统计抽到 `src/util/pixel-stats.ts`，P0-A 与 P0-B 单源共享（rule 22）；同时 `visual-metric.ts` 重构为复用，无行为变化
> - 真实性闸整合进两个入口——`url_screenshot` 工具 + `orchestrator/tools.ts` 的 live-URL 自动采集循环；gate violation 直接 throw（`CaptureGateError.stage === "gate"` 冒泡至 design_analysis 失败），浏览器/网络错误仍 warn+continue（区别：真实性 vs 资源可用性）
> - 删除废弃 `src/design-analyst/url-screenshot.ts`（已无 caller，rule 10）
> - **并行陷阱**：未动 `delivery/tools.ts`（Stream A）、未动 `orchestrator/tools.ts:deliver()` 的 render 区块（Stream A）

**目标**：让 reference.png 不可能是伪造的。

- Capture 阶段必须用 puppeteer/CDP 抓图并落 `capture-manifest.json`：URL、viewport、fullpage hash、DOM snapshot hash、HAR 大小、耗时、screenshot byte size、**非白像素占比**、**唯一色数**、OCR 文本长度
- Gate 拒收条件（任一命中 → 任务失败，不得降级）：
  - `byte_size < 20480`
  - `non_white_pixel_ratio < 0.05`
  - `unique_color_count < 16`
- SPA 抓图必须 `waitForNetworkIdle` + `waitForFunction(() => canvas_has_pixels || main_content_bounds_nonzero)`，不能一超时就 fallback 到文本 spec
- 失败路径直接 `rejected`，禁止 "tool unavailable → 走 visual contract" 的静态文本退路

**验收**：伪造或空白 reference 在设计分析阶段即被拒，不进入 goal 队列。

---

### P0-B · 数值门前置于 LLM judge（`src/delivery/verdict.ts` + 新增 `src/delivery/visual-metric.ts`） ✅ DONE (Stream C, commit 0b4c60582, 2026-04-24)

> **实现要点**：
> - `visual-metric.ts` 真实计算 5 条硬门：pHash(aHash 8×8) / SSIM / non-white density ratio / 4bit-bucket unique color ratio / text hit ratio
> - `text_hit_ratio` 等 P1-B (Stream F) 的 `reference_strings` 落地后生效；当前自动 skip 并把权重按比例摊到前三条（score 单调性不变）
> - `visual-thresholds.json` 静态 import（Bun compile 可打包进二进制，无 cwd 依赖），权重 sum-to-1 运行时校验
> - `verdict.ts` 新增 `finalizeVerdict(llm, metric, goalIds)`：gate 未过且 LLM 判 accepted ⇒ 强制翻为 rejected，把每条失败硬门写入 `rejection_details[]`（category="visual"，逐 goal 归因）
> - `service.ts` 单源 rendered：仅现场 `renderPage(findRenderedIndex(Instance.directory))`，不读 Stream A 的 rendered_output attachment 避免双源（rule 22）。有 reference 却渲染不出 ⇒ 直接 `DeliveryFailureError`
> - **并行陷阱约束遵守**：未动 `agent.ts`；verdict 函数签名归 C 所有；Stream D.3 合入 publisher 时与此无交集
> - **未决项**：阈值按经验值写入，尚未用 dev/ 样本标定；P0-C.4 LKG 会复用 `VisualMetricResult.score`；P2 replay 直接读 gates[] 与 score

**目标**：LLM 无权推翻肉眼可见的差距——且即使 P0-0 让 LLM 看得见图，它仍可能判错，数值门是**兜底**。

Delivery 判决流程重构：

```
rendered.png + reference.png
      ↓
  numeric-gate  ← 硬门，无 LLM
      ↓ pass
  llm-judge     ← 只判软性瑕疵
      ↓
  verdict
```

硬门指标（全部必须通过）：

| 指标 | 阈值 | 作用 |
|---|---|---|
| pHash 汉明距离 | ≤ T1 | 整体结构 |
| SSIM | ≥ T2 | 纹理/细节 |
| chart-region non-white pixel density | ≥ reference × 0.6 | **卡空骨架关键指标** |
| unique-color-count ratio | ≥ 0.5 | 卡单色页面 |
| text-string hit ratio | ≥ 0.7 | 卡占位文案 |

阈值以 dev/ 目录下已知 accept/reject 样本标定，落 `packages/opencorvus/src/delivery/visual-thresholds.json`。

任一硬门失败：

- 直接 `rejected`，附结构化 `metrics` + `diff-region.png`
- **不**把判决权交给 LLM
- 写入 `delivery_round` 表（见 P2）

LLM judge 只能在硬门通过后判 "accept with minor issues" 或 "reject on content correctness"，无权覆盖硬门拒收。

**验收**：空骨架场景 chart-region density 必然 < 60%，硬门必拒，不论 LLM 说什么。

---

### P0-C · 单调改进 + Last-Known-Good 回滚（`src/delivery/agent.ts` picky loop）

> **状态（2026-04-24）**：Stream D（P0-C.1 + .2 + .3 — Commit & Diff 纠偏，3 项捆绑契约）✅ 已交付。
> 实现要点：
> - `engine/git.ts` 新增 `EngineGit.commitDeliveryRound`：每轮 `git add -A` + `git commit --no-gpg-sign --allow-empty`，subject=`delivery round N | verdict=X | issues=Y`，body 带 verdict.summary。`--allow-empty` 保证"该轮无代码改动"也有时间锚点。
> - `engine/git.ts` 新增 `EngineGit.reclaimDetachedGoalCommits`：扫所有 goal-run 的 `delivery.result.commit_ref`，`merge-base --is-ancestor` + `log --grep=cherry picked from commit X` 双重判已合，未合则 `git cherry-pick -x`；冲突则 `--abort` 并归到 `unreclaimable`。
> - `orchestrator/tools.ts:deliver()`：执行入口先 reclaim，`unreclaimable.length > 0` → 任务直接 `failed`（禁 squash 绕过）；verdict 落库后立即调 `commitDeliveryRound`，accept / reject 两条路径都走，commit_sha 通过 `log.info` 留痕（待 Stream G 接 `delivery_round` 表）。
> - `engine/publisher.ts:workspaceExportAdapter`：`changedFiles` / `patch` 改由 `git diff baseRef..HEAD` 计算（baseRef 取 `task.metadata.git.baseline.commit`）。彻底废弃 `ctx.delivery.result.{changed_files,diffs}` 与 `createTwoFilesPatch` 旧路径，aborted 路径再也不会 `[]`。
> - 未触及 Stream C / Stream A 的 verdict / agent / tools 文件——遵守"Stream C 拥有 verdict 函数签名 / Stream A 只动 render step 区块"的并行契约。
> - **遗留**：commit message 的 `score=` 字段需 Stream C' 的 LKG score 接入后补；`delivery_round` 表写入由 Stream G 拉起。本 stream 只做契约 1/2/3，契约 4（Overlay Board）在后端契约满足后无需改动。

**目标**：picky loop 不得比上一轮更差；回滚必须有 commit 可依。

**强制前置**：每一轮 repair 结束必须 `git commit`（对应 CLAUDE.md rule 21）。ainvest 事故里 7 个"delivery" commit 都只含 `mirror/*` 脚手架，`src/*` 直到最终空骨架版才首次 commit——意味着 22:30 那版最佳 UI 从未落盘，无任何 last-known-good 可回滚。这是退化不可恢复的物理原因。

**系统里三种 commit 语义的现状**（事故复盘补充）：

| 层级 | 代码路径 | 当前是否 commit |
|---|---|---|
| goal-run 完成 | `goal/runner.ts:deliveryFromWorktree` | ✅ 每个 goal-run 一次 |
| Task 最终 finalize | `engine/git.ts:created_commit` | ✅ 一次 squash |
| Delivery picky repair loop | `delivery/agent.ts` + `engine/publisher.ts` | ❌ **0 次** |

Publisher 里 `workspaceExportAdapter` 仅把 `delivery.patch` 写进 `Global.Path.data/delivery/<id>.patch`；`gitPreviewAdapter` 仅快照 VCS 状态——整条 repair 链路不走 `git commit`。加上 run aborted 时 goal-run 的 7 个 commit 会被丢在 detached branch、不回收进 master，最终就出现 `changedFiles: []` + `src/*` 仅在最后一次 squash 才首次落盘的现象。

**系统性契约（必须同时满足）**：

1. Delivery repair loop 每轮结束强制 `git commit`（本节主体，下文已描述）
2. Run aborted 恢复路径必须把 detached goal-run 的 commits 回收进主任务历史（`engine/git.ts` 增加 `reclaim_detached_goal_commits`；走不通直接任务 `failed`，禁止 squash 绕过）
3. `delivery.result.changedFiles` / `diffs` 必须由 publisher 从 **当轮 commit 的 `git diff baseRef..HEAD`** 计算，不再信赖上游 `ctx.delivery.result.changed_files` 是否被填（当前 aborted 路径没人填就 `[]`）
4. Overlay `Board.tsx` 显示逻辑不变，但后端契约保证：只要有 commit，`changedFiles` 就不为空——否则是后端 bug，不是 UI 判断

- Round commit 规则：每轮 repair 结束前 `git add -A && git commit -m "delivery round N | score=X.XX"`，即使 LLM 说"没改动"也要空 commit 做时间锚点
- commit message 里带 round index + score，方便 `git log --grep` 定位
- 若该轮触发回滚，commit message 加 `rollback_to=<sha>`

每轮 repair 评分与回滚：

1. 打分：`score = w1·phash + w2·ssim + w3·density + w4·hit_ratio`
2. 记录 `{round, score, commit_sha, screenshot_path, metrics}` 到 `delivery_round` 表
3. 维护 `best_score` / `best_commit_sha`
4. 下一轮开始前：`current_score >= best_score × (1 - ε)` 不满足 → `git reset --hard best_commit_sha` 再继续
5. 连续 K 轮无改进（K 默认 3）→ 升级：换更强模型 / 重跑 planner，**不得继续空转**
6. Iteration budget 用完仍未通过硬门 → 最终 verdict `rejected`，禁止 "picky 已跑满 → 勉强 accept" 这条逃生通道

**验收**：重放 ainvest 场景，第 22:30 回合定为 best 且 **有对应 commit**，之后每轮若 score 下降立即回滚至该 commit；最终要么升级成功突破硬门，要么 `rejected`。

---

### P1-A · 禁 SPA 静态脚手架退路（`src/executor/opencode.ts` + `evaluator/`）

**目标**：goal 不得只产 "文本脚手架" 就算完成。

- Executor system prompt 显式禁写：「如果动态抓图失败，改用 visual contract 文本生成 scaffold」这类降级话术
- Evaluator 新增 `runtime-evidence` check：goal 产物必须包含
  - build 成功产物（`dist/` 或 `.next/` 或可运行 `bun run start`）
  - 真 puppeteer screenshot（by evaluator 独立采集，不信 goal-agent 自报）
  - 真 DOM snapshot（非 scaffold 文本）
- 仅 `mirror/scaffold.json` + `App.tsx` 级别的文本脚手架 → `rejected`

**验收**：goal-agent 就算想"躺平写文本"也过不了 evaluator 的 runtime evidence 检查。

---

### P1-B · Goal acceptance 去 `test -f`，换内容指纹（`src/orchestrator/checks/` + 新增 `evaluator/content-fingerprint.ts`） · 🟡 F.1 DONE，F.2 allowlist 接入待跟进

> **实现要点**（Stream F.1，本轮）：
> - 新建 `src/delivery/checks/content-fingerprint.ts`（路径偏离 spec 原拟：`evaluator/` 目录项目里不存在，对齐现有 `src/delivery/checks/` 与 `src/check/policy.ts` 双层抽象更合适 —— 实际检查逻辑归 delivery/checks，check 选择器枚举归 check/policy）。
> - 对外 API：`loadContentAnchors(manifestPath)` / `evaluateContentFingerprint(input)` / 以及三条独立指标 `computeStringHitRatio` / `computePaletteJaccard` / `computeLayoutOverlap`。
> - 实现策略与 CLAUDE.md 对齐：锚点完全来自 P0-A 的 `CaptureManifestType`，缺失即抛；layout 采用 IoU（缺区域记 IoU=0，空骨架必然拉低 averageIoU）；palette 用 Jaccard 集合比较（消费方需先用 `util/pixel-stats.topKPalette` 预处理，rule 22 不重复实现）；string 命中做 lowercase+whitespace normalize 字面匹配，不 fuzzy / 不关键字自推（rule 11）。
> - **F.2 allowlist（未接入）**：`src/check/policy.ts::CheckSelector` 枚举即为允许列表，目前 `test -f` / 自造 grep 并未在枚举中——但 goal-agent 仍能在 `checks_run` 数组里写任意 shell；真正落地需在 `src/delivery/agent.ts` 处理 `checks_run` 时把每条 command 过一遍 allowlist 校验，不合规直接拒录。本轮未改 delivery/agent.ts（Stream A.C 可能仍在迭代其首 prompt 格式），留作独立工单。
> - 无 goal-acceptance 入口接入；消费者是后续工单（goal-check 重构或 delivery agent 硬门扩展）。

**目标**：goal 验收锚点来自外部事实，不得自造。

Capture 阶段生成并只读注入下游：

- `reference-strings.json`：reference 的文字串集合（OCR + DOM text）
- `reference-palette.json`：top-K 主色
- `reference-layout.json`：关键区域 bbox（chart / sidebar / toolbar / cookie banner 等）

Goal acceptance 的 checks_run 必须：

- 从上述 readonly 文件取锚点
- 在 rendered HTML / computed styles / `getBoundingClientRect` 上验证命中率
- 不允许 `test -f`、不允许自造 `grep 关键字` 规则（在 check registry 做 allowlist 校验，不合规直接拒录）

**验收**：goal-agent 无法通过"自己写规则自己过"的方式 pass。

---

### P2 · Delivery Round 可观测（DB schema + 回放脚本） · 🟡 G.1 + G.2 DONE，G.3 write-site 待接入

> **实现要点**（Stream G.1 + G.2，commit 3d5f1d94b + 本轮）：
> - `src/delivery/delivery.sql.ts`：`EngineDeliveryRoundTable` 已 merged（contract stub 预合 638464d32，schema.ts re-export）。列：id / task_id / delivery_id / round_index / commit_sha (notNull) / verdict / score / metrics_json / llm_rationale / screenshot_path / diff_region_path / rollback_from_round / timestamps。uniqueIndex(delivery_id, round_index)。
> - `src/delivery/round-store.ts`：CRUD 层 —— `insertDeliveryRound` / `listByDelivery` / `listByTask` / `findBestDeliveryRound` / `findLatestDeliveryRound` / `markDeliveryRoundRollback`。采用 `Database.transaction` / `Database.use`，与 `engine/persist.ts` 同风格。
> - `src/id/id.ts`：注册 `delivery_round` 前缀（`dlr`）。
> - `script/delivery/replay.ts <taskID>`：按 task 拉全部 round，ASCII 表输出（delivery_id / rnd / verdict / score / trajectory bar / commit / rollback / markers），best 标 `★`、退化轮标 `▼`、回滚轮标 `↺from=N`。结尾汇总 total/scored/degradation_hits/final_verdict/best_score。
> - **G.3 未接入（待跟进）**：Stream D (2b156ceb4) 已实装 `EngineGit.commitDeliveryRound` 并在 `orchestrator/tools.ts:2510` 调用，但 **未调用 `insertDeliveryRound` 写 DB 行**。当前 replay.ts 对真实任务读出空集。修法：在 `orchestrator/tools.ts` 该调用后追加一次 `insertDeliveryRound({ taskID, deliveryID, round_index=iteration, commit_sha=roundCommit.commit, verdict=verdict.verdict, llm_rationale=verdict.summary })`，score / metrics 等 P0-C.4 LKG 接入时再补。此文件当前被其他 agent 占用，本轮未改。

**目标**：26 轮迭代的完整轨迹可结构化查询、可回放。

- Orchestrator DB 新增 `delivery_round` 表：
  - `round_id, task_id, goal_id, round_index, timestamp`
  - `score, metrics_json, verdict, llm_rationale`
  - `commit_sha, screenshot_path, diff_region_path`
  - `rollback_from_round` （若该轮被回滚至 LKG）
- 新建 `script/delivery/replay.ts <taskID>`：
  - 输出每轮 score 曲线（ASCII 或 PNG）
  - 每轮 verdict + rationale 摘要
  - 退化点自动标红
- 现有 `.opencorvus/delivery-screenshots/` 保留，但从"唯一真相"降级为"调试附件"

**验收**：运行 `replay.ts <taskID>` 能一图看出 ainvest 从第 14 轮起质量下滑，无需肉眼翻 PNG。

---

## 并行拆分 & 依赖图

### Stream 视图

```
Phase 1（5 条 stream 并行，无共享代码路径）
├── Stream A · P0-0 · Delivery LLM 多模态  ✅ DONE A.A + A.B (2026-04-24)
│     └── src/delivery/tools.ts（screenshot / verify_page_integrity 改 multimodal）
│         src/orchestrator/tools.ts（render 失败短路 reject；每轮重渲染留给 Stream C'）
├── Stream B · P0-A · Capture 真实性闸  ✅ DONE (commit 7f53a3de6)
│     └── src/design-analyst/capture-gate.ts（新）
│         src/util/pixel-stats.ts（新，与 P0-B 共享）
│         src/design-analyst/url-screenshot-tool.ts（接入 gate）
│         src/orchestrator/tools.ts（live-URL 自动采集接入 gate）
│         src/design-analyst/url-screenshot.ts（删除）
│         产出契约：CaptureManifest
├── Stream C · P0-B · 数值门  ✅ DONE (commit 0b4c60582)
│     └── src/delivery/visual-metric.ts（新）
│         src/delivery/verdict.ts（接入硬门）
│         src/delivery/service.ts（gate 串进 verify 流）
│         产出契约：VisualMetric 类型 + thresholds.json
├── Stream D · P0-C.1/.2/.3 · Commit & Diff 纠偏（不依赖 score）  ✅ DONE (2026-04-24)
│     ├── .1 每轮 repair 强制 git commit            → engine/git.ts:commitDeliveryRound + orchestrator/tools.ts:deliver
│     ├── .2 aborted 恢复回收 detached goal-run commits → engine/git.ts:reclaimDetachedGoalCommits
│     └── .3 publisher 从 commit 算 changedFiles     → engine/publisher.ts:workspaceExportAdapter (git diff baseRef..HEAD)
└── Stream E · P1-A · 禁静态脚手架退路
      └── src/executor/opencode.ts（prompt）
          src/evaluator/runtime-evidence.ts（新，共用 puppeteer helper）

Phase 2（依赖 Phase 1）
├── Stream C' · P0-C.4 · LKG score-driven rollback
│     depends on: Stream C 的 VisualMetric
│     └── delivery/agent.ts 的 repair loop 接入 score + reset --hard
└── Stream F · P1-B · 内容指纹
      depends on: Stream B 的 CaptureManifest
      └── evaluator/content-fingerprint.ts + 扩 goal checks allowlist

Phase 3（依赖 Phase 2）
└── Stream G · P2 · 可观测 & 回放
      depends on: Stream C（score）+ Stream D+C'（round 表）
      └── storage/schema.sql.ts（delivery_round 表）
          script/delivery/replay.ts
```

### 硬依赖边界（只有 4 条，其它全可并行）

| 依赖 | 原因 |
|---|---|
| P0-C.4 → P0-B | LKG 需要 `VisualMetric.score` |
| P1-B → P0-A | fingerprint 消费 `CaptureManifest.{strings,palette,layout}` |
| P2 → P0-B | replay 需要 score 字段 |
| P2 → P0-C.1/.4 | replay 需要 round 表（commit_sha + rollback_from_round） |

### 并行前先对齐的契约（stub 先行） · ✅ 已完成（2026-04-24）

**Phase 1 开跑前 1-2 小时**，由一个人合入 4 个 stub（仅 type / JSON schema / 空函数），之后各 stream 平行推进：

| 契约 | 定义位置 | 消费者 | 状态 |
|---|---|---|---|
| `VisualMetric` TS 类型 | `src/delivery/visual-metric.ts` | P0-B、P0-C.4、P2 | ✅ stub merged |
| `CaptureManifest` JSON schema | `src/design-analyst/capture-gate.ts` | P1-B、P1-A（复用 puppeteer helper） | ✅ stub merged |
| `delivery_round` 表 schema | `src/delivery/delivery.sql.ts`（经 `src/storage/schema.ts` 统一 re-export，遵循现有 domain-local sql 约定） | P0-C.1/.4 写、P2 读 | ✅ stub merged |
| Multimodal `ToolResult` 约定 | `src/delivery/tool-result.ts`（新建 sibling，避免 Stream A 提前改 `tools.ts` 与 C 冲突） | P0-0 全部子项 | ✅ stub merged |

stub 交付物（Stream A–G 可直接 import，未实现部分以 `throw NotImplemented` 暴露路径，禁 fallback）：

- `VisualMetricResult` / `VisualThresholds` / `computeVisualMetric` / `loadVisualThresholds` 类型 + 常量 `VISUAL_THRESHOLDS_RELATIVE`
- `CaptureManifest` zod + `enforceCaptureGate` + `CAPTURE_GATE_THRESHOLDS`
- `EngineDeliveryRoundTable` drizzle 定义（`commit_sha notNull`、`(delivery_id, round_index)` unique），已在 `storage/schema.ts` 中 re-export
- `DeliveryMultimodalToolOutput` + `buildMultimodalToolResult`（对齐 `session/message.ts::toModelOutput` 既有 attachment 约定，与 `design-analyst/url-screenshot-tool.ts` 的成熟形状一致）

验证：`bun run tsc --noEmit` 通过；未触碰 `src/delivery/tools.ts`、`src/delivery/agent.ts`、`src/delivery/verdict.ts`、`src/orchestrator/tools.ts`，保证 Stream A–G 开工时零 merge 冲突。

### 并行陷阱（必须约束，否则 merge conflict）

1. **Stream A + Stream C** 都可能改 `delivery/verdict.ts` / `delivery/agent.ts`
   - 约束：**C 拥有 verdict 函数签名**，A 只改 tool multimodal plumbing
2. **Stream D.3 + Stream A** 都会动 `orchestrator/tools.ts:deliver()`
   - 约束：A 只动 render step 区块，D.3 只动 publisher 调用区块，注释块隔离
3. **所有 stream 都不得动 `src/storage/schema.sql.ts`**
   - 约束：由 G 的先导 stub 一次写死 `delivery_round` 表，其它只读

### 关键路径

**C (P0-B) → C' (P0-C.4) → G (P2)** 是最长路径。P0-B 未 merge 之前不要开工 C' / G，否则返工风险高。其它路径都比它短，Phase 1 的 5 条 stream 在理想情况下一轮同步即可合流。

---

## 实施顺序（单人线性执行时的优先级）

| # | 项 | 杠杆 | 工作量 | 依赖 |
|---|---|---|---|---|
| **P0-0** | **Delivery LLM 真正看到渲染图** | **极高（无此项后续全空）** | 中 | 无 |
| P0-B ✅ | 数值门前置 | 极高 | 中 | 无 |
| P0-C | LKG 回滚 + 每轮 commit | 高 | 中 | P0-B（需要 score） |
| P0-A ✅ | Reference 真实性 | 高 | 小 | 无 |
| P1-A | 禁静态脚手架退路 | 高 | 小 | P0-A（共用 runtime evidence 能力） |
| P1-B | 内容指纹 | 中 | 中 | P0-A（共用 capture-manifest） |
| P2   | Round 可观测 | 中 | 小 | P0-B、P0-C（数据源） |

**验收场景（回归）**：用 ainvest 任务 replay，必须满足：

1. Delivery session 的每一次 LLM request 的 multimodal content 必含 ≥1 reference + ≥1 当轮 rendered；tool call 返回含 image part，不仅是 path 字符串
2. 伪造 reference.png 在 design-analyst 阶段被拒
3. 空骨架 rendered.png 在 delivery 硬门阶段被拒（无论 LLM 说什么）
4. Picky loop 若某轮 score 下降立即回滚至 best；每一轮都有 commit；budget 用尽仍未过硬门则最终 `rejected`
5. `replay.ts` 输出的 score 曲线与截图退化时间线一致

---

## 反模式清单（禁做）

- ❌ 在既有 LLM prompt 里加"你要更严格"一类措辞——已证无效（现有 `src/delivery/agent.ts` 明确写了 adversarial 对比指令，26 轮仍全判 accept）
- ❌ 加 per-check `try/catch fallback`——违反 rule 1
- ❌ 用关键字匹配规则判图（如 `grep "chart-canvas"`）——违反 rule 11
- ❌ 状态机硬编码 "若 round >= 20 则强制 accept"——违反 rule 23
- ❌ 迁移式兼容老 goal-report 格式——违反 rule 13；直接 reset 重建

---

## 备注

- 本方案针对 CLAUDE.md rule 7（"自己验收通过仍需二次 review"）的落地工具化：数值门 + LKG + replay = 二次 review 的自动化载体
- 若 P0-B 数值门阈值校准需要更多 accept/reject 样本，可利用 `overlay-web-benchmark-report-*.json` 的历史交付（百度 / ainvest / 其他 overlay benchmark）打标
