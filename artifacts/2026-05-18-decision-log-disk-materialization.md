# Decision Log 完整落盘 + 提示 agent 可参考 — 设计方案（v2，codex 一轮反馈已并入）

> 落盘 2026-05-18 · 分支 codex/agent-boundary-role-contract
> 用户指令：「每次任务把 decision log 完整落盘，提示 agent 可以参考」（opencorvus 运行时 decision log）

## 0. 问题本质（rule 1/2/3）

运行时 decision log = SQLite 表 `decision_log`（`src/decision-log/schema.ts`），单库
per-task append-only 承载 WHY。注入各 agent prompt 时**被截断**（`DEFAULT_ENTRY_VALUE_CAP=600`
/ `DEFAULT_PHASE_ENTRY_LIMIT=15` / `toPromptSection({limit})` 只留最新 N）。`index.ts` 注释说
"完整 body 在 decision_log 行里，靠 `readByKey()` 取"——但 `readByKey()` 是 TS 函数，零 tool
暴露给 LLM agent（已穷举 `tool/registry.ts`/`orchestrator/tools.ts`/`delivery/tools.ts`/
`requirements/output-tools.ts`）。带 worktree+shell 的 build/coding/delivery agent 够不到完整
日志，只见截断摘要。用户要补此 gap。

## 1. 全仓调用点 + proven 范式（rule 35）

- 注入点：`architect/agent.ts:323` / `integrity/agent.ts:982` `toPromptSection()`；
  `delivery/agent.ts:288` `phasePromptSection("design_analysis")`；
  `prompt/upstream-context.ts:20` `phasePromptSectionForGoal("requirements")`；
  `orchestrator/tools.ts:5181/3677/3679` read_context（orchestrator 内部）。
- **proven 落盘范式 = design-analysis handoff**（不是 IntentBundle——见 §7 路径不变量）：
  `orchestrator/tools.ts:430-438` materializer 写 `path.join(projectDir,".opencorvus",
  "design-analysis","prd-spec.md")`，调用点 `tools.ts:2539
  designAnalysisArtifactPaths(Instance.directory)` → projectDir = **primary `Instance.directory`**。
  `design-analyst/handoff.ts:3-4` 定义相对路径常量并由 `renderDesignAnalysisHandoffReference`
  注入 prompt。build-core.txt:53-57 实战文案：「materialized at `.opencorvus/design-analysis/
  prd-spec.md` … read those files when you need the complete source」。
- build agent cwd：`build/agent.ts:658 sessionDirectory: worktreeDir!` = goal worktree
  `<primary>/.opencorvus/worktrees/<branch>/`（`worktree/index.ts:48`）。
- 外部执行器系统 prompt：`build/agent.ts:279 composeExternalCodingSystem` +
  `:883 externalBuildSystemContract`（**不走 build-core.txt**）。
- delivery agent cwd：`delivery/agent.ts:132 sessionDirectory: Instance.directory`（primary）。
- 任务终止：无集中 `finalizeTask()`；`engine/task-status.ts` status 是
  `time_completed` 等事实的派生投影（rule-23，无 FSM 列）。终止 = `time_completed` 被写。
- `.opencorvus/` 已 gitignore（`engine/git.ts:237`）+ `Database.reset` 清理 → 无新清理路径。

## 2. 设计决策（codex 一轮反馈已并入，rule 35 显式标注于 §6）

### D1 单一来源（rule 8/7）— **措辞修订（codex）**
`decision_log` 表 = **唯一 source of truth / 唯一 writer**。新增
`DecisionLogBundle.write(projectDir, taskID)` 把**完整（无 cap/limit）**日志渲染为确定性、
幂等的 markdown 写到 `<projectDir>/.opencorvus/decision-log.md`。host 永不回读做权威，agent
不得写它影响系统语义。**文档/注释禁止**称该文件 canonical/source of truth——只称
"materialized projection / on-disk read surface"（codex 必改项）。非双源：DB 是源，文件是
确定性投影，结构镜像 design-analysis handoff materializer。

### D2 渲染器单一来源（rule 9/8）
抽出 `index.ts` 现有逐条渲染为**一个**共享原语；新增 `toFullDocument()` 用"无 cap/无
limit"调它。**禁止**复制 markdown 拼装。

### D3 写时机 — **修订（codex Q2）：write-before-consume + 任务终止 final write 都要**
(a) write-before-consume：每个带 worktree+shell 的消费 agent 唤醒前重写（幂等覆盖），解决
"工作时可参考当前完整日志"。(b) 任务终止 final write：在 `time_completed` 被写的终止点
再写一次，解决"文件在最后一批 delivery/integrity/abort/agent_error 决策后变旧→名不副实
=技术债 rule 16"。两者皆 DB 幂等投影，非新源非 fallback。非状态机（rule 13：派发/终止
边界的确定性副作用，非流程状态机）。

### D4 提示 agent 可参考 — **修订（codex Q1/rule16）：build-core + 外部执行器 + delivery 三处**
- in-process build：`build-core.txt` 加一行指向 `.opencorvus/decision-log.md`（镜像 :53-57
  design-analysis 文案）。
- 外部执行器：`externalBuildSystemContract`（`build/agent.ts:883`）加同义 bullet（codex
  必改：codex/claude-code 不走 build-core.txt）。
- delivery：`delivery-core.txt` 加同义行（codex 必改：delivery 是确证 worktree+shell
  消费者，`sessionDirectory: Instance.directory`）。
- **architect / integrity 不加**（codex 裁决）：architect 走只读 context/结构化 output
  tool 非 shell；integrity 只有 verdict/submit tool 无文件读/shell——给路径=不可执行提示。
- **修正不可执行旧文案**（codex 必改 rule16）：现"full body in decision_log row /
  readByKey()" 这类对 LLM 不可操作的话，改为指向 `.opencorvus/decision-log.md`。

### D5 rule 7 硬失败（codex 条件）
`DecisionLogBundle.write` 失败必须 hard fail，禁捕获后退回只靠截断 prompt。空日志→空文档
（合法，非 fallback）。

### D6 无技术债（rule 8/16/17）
落 `.opencorvus/` 既有 scratch 树，复用既有 gitignore + reset 清理，零新增路径。

## 3. 测试（rule 36，含 codex 补充缺口）

1. `DecisionLogBundle.write`：文件落预期路径；写一条 value>600 字符 entry，断言文件中
   **未截断**（区别于 `toPromptSection`）。
2. `toFullDocument()`：**phase 分节**（codex Q3 裁决，非扁平）、无 cap/limit、含
   key/value/reason/goalID/timeCreated、时间序；空日志→空文档。
3. write 失败 → **hard fail**（不静默退化）。
4. in-process build：goal worktree 解析后文件存在且反映当前 `decision_log`；新 append 重跑→
   重新物化。
5. 外部执行器：`externalBuildSystemContract` 输出含 `.opencorvus/decision-log.md`。
6. delivery：`DeliveryAgent.verify` 启动前 `Instance.directory/.opencorvus/decision-log.md`
   存在；`delivery-core.txt` 含路径提示。
7. 任务终止 final write：最后追加的 delivery/abort/agent_error 决策出现在落盘文件里。
8. 回归：`test/pipeline/decision-log.test.ts` `toPromptSection` 截断行为不变（共享
   formatter 重构禁回归 caps）。
9. 旧文案修正断言：不再出现"去 decision_log row / readByKey 读完整"这类不可执行提示。

## 4. 实施顺序（codex 二轮共识后）
1. `decision-log/index.ts`：抽共享逐条原语 + `toFullDocument()`（phase 分节）。
2. 新增 `decision-log/bundle.ts`：`DecisionLogBundle.write(projectDir, taskID)`，结构镜像
   design-analysis materializer；hard fail。
3. write-before-consume 接缝：in-process build（`build/agent.ts` worktree 解析后，与
   `stageToWorktree` 块并排）+ external executor 派发点 + `DeliveryAgent.verify` 启动前。
4. 任务终止 final write：`time_completed` 写入点（待 §7 codex 定夺确切单一接缝）。
5. prompt：`build-core.txt` + `externalBuildSystemContract` + `delivery-core.txt` 各加引用；
   修正不可执行旧文案。
6. 测试 1-9。
7. typecheck/docs:check 过 → commit+push（不绕 hook，rule 33）。

## 5. 待 codex 二轮定夺（rule 35 + memory「不确定问 codex 拿定论」）

**Q-PATH（载荷攸关，最高优先）**：goal-worktree build 模式下 cwd =
`<primary>/.opencorvus/worktrees/<branch>/`，而 design-analysis 物化到
`<primary>/.opencorvus/design-analysis/prd-spec.md`（projectDir=Instance.directory）。
`build/agent.ts` 不 stage/copy 该目录进 worktree。那 build agent 究竟靠什么解析
`.opencorvus/design-analysis/prd-spec.md`：(i) 注入的是 `prdAbsolute` 绝对路径而非相对？
(ii) 还是单 goal/direct build 时 worktree 实际就是 Instance.directory？(iii) 还是相对引用
在 goal-worktree 模式下本就是 latent bug？请基于代码事实给定论，并据此定死
`DecisionLogBundle` 对 (1) in-process goal-worktree build (2) 外部执行器 (3) delivery
三类消费者各自**确切可达**的写入路径与 prompt 引用形式（相对 vs 绝对）。

**Q-TERM**：`time_completed` 被写的终止点是否单一接缝？若散落，列出全部终止/abort/failure
路径作为 final write 调用点（rule 35 禁散漏）。

## 6. codex 一轮审查反馈（rule 35：显式标注，禁静默重写）

- rule 8：**NO 违规**，IntentBundle/design-analysis 投影类比成立；**必改**：禁称
  decision-log.md 为 canonical/source of truth → 已并入 D1。
- Q1：delivery **要**（`sessionDirectory: Instance.directory` 确证）；architect/integrity
  **不要**（无 shell/文件读）→ 已并入 D4。
- Q2：write-before-consume **且** 任务终止 final write **都要** → 已并入 D3。
- Q3：`toFullDocument()` **phase 分节**非扁平，仅共享单条渲染原语 → 已并入 D2/测试2。
- rule 6.1/13/15 PASS；rule 7 PASS（条件：write hard fail）→ 已并入 D5。
- rule 16 当前 FAIL：漏 delivery + 外部执行器，且"去 DB row 读"文案不可执行 → 已并入 D4。
- 实施缺口：external `externalBuildSystemContract`、delivery `DeliveryAgent.verify`+
  `delivery-core.txt`、task-end final write、对应测试 → 已并入 §3/§4。
- 一轮结论：**需修订后实施** → 本 v2 即修订；§5 二问待二轮定论后进入实施。

## 8. Q-PATH 代码追踪定论（用户要求"调查现状继续"，已闭环）

逐文件证据链：

- `tool/read.ts:37-38`：相对路径 `path.resolve(Instance.directory, filepath)` → opencorvus
  `read` 工具按 **`Instance.directory`** 解析相对路径，**与 session cwd / goal worktree 无关**。
- `build/agent.ts:658`：in-process build `sessionDirectory: worktreeDir`（goal worktree），
  但其文件读取走 opencorvus `read` 工具 → 相对 `.opencorvus/<f>` 命中
  `Instance.directory/.opencorvus/<f>`。**∴ design-analysis 相对路径范式对 in-process
  build/delivery 是 sound 的，非 latent bug。**
- `build/agent.ts:1457 cwd: args.worktreeDir` + `executor/managed.ts:60/293`
  `input.cwd ?? options.cwd` → 外部执行器（codex/claude-code）子进程 cwd = goal worktree，
  用**自己的原生文件工具**，相对路径解析到 goal worktree。
- `executor/bootstrap.ts:29/53` provider 默认 `cwd:()=>Instance.directory` 被 runInput.cwd
  覆盖（managed 优先级）→ 实际仍是 goal worktree。
- `worktree/index.ts:889+ Worktree.create`：`git worktree add` 到
  `<primary>/.opencorvus/worktrees/<branch>/`，**不** copy/symlink primary 的
  `.opencorvus/design-analysis|intent` 进去；全仓 grep 无 `.opencorvus`→worktree 共享。
- `orchestrator/tools.ts:2548-2549`：`writeDesignAnalysisArtifacts` 唯一调用点
  `projectDir: Instance.directory`；`design-analyst/handoff.ts:3` 注入的是**相对**常量。

**定论：**
1. in-process build / delivery（opencorvus 工具，按 `Instance.directory` 解析）：写
   `Instance.directory/.opencorvus/decision-log.md` + 相对引用 → **可达**。
2. 外部执行器（codex/claude-code，cwd=goal worktree，原生工具）：相对
   `.opencorvus/decision-log.md` → **不可达**。且 design-analysis 现有相对引用对外部执行器
   **同样不可达 = 预存系统性 latent bug**（rule 4：继承/多态——非 decision-log 独有）。
3. ∴ 简单镜像 design-analysis 会继承该 latent bug（违 rule 16 技术债 / rule 4 系统性）。
   外部执行器必须拿**可达路径**：候选 (a) prompt 注入**绝对**路径
   `Instance.directory/.opencorvus/decision-log.md`（`designAnalysisArtifactPaths` 已有
   `prdAbsolute` 先例，绝对路径是既有概念）；(b) 物化进每个 goal worktree（多写点+双位置，
   劣）；(c) 系统性修：外部执行器所有 `.opencorvus/<f>` 引用统一绝对（同根修
   design-analysis+intent+decision-log，rule 4 根因修非症状补）。
4. 设计优化（rule 9 单接缝）：注入不改 build-core/externalBuildSystemContract/delivery-core
   三处，而是镜像 design-analysis——在 `upstream-context.ts` 的
   `buildGoalUpstreamAgentContextSections`（build，含外部）+
   `buildTaskUpstreamAgentContextSections`（delivery）里，于现有
   `renderDesignAnalysisHandoffReference` 旁加 `renderDecisionLogBundleReference`，单一通道
   覆盖三类消费者。**但**该 renderer 对外部执行器须给绝对路径（见定论 3）。

## 9. 待 codex 二轮定夺（精炼，rule 35 + memory）

- **Q-PATH-2**：外部执行器路径，选 (a)/(b)/(c)？(c) 系统性修是否在本次 scope（用户只要
  decision-log，但 rule 4 禁只修单 agent 症状；design-analysis/intent 的外部执行器不可达
  是否本就该一并根治）？请定论并界定 scope。
- **Q-DESIGN**：§8.4 的 upstream-context 单接缝注入（替代 v2 改三处 core prompt）是否更优、
  是否违任何规则？
- **Q-TERM**：`time_completed` 写入点是否单一接缝？（v2 §5 Q-TERM 仍待定）
- 确认 v2 §2-§4 其余决策在 §8 新证据下是否仍成立。

## ⚠ 实施阻塞（2026-05-18，rule 28b 诚实记录）

实施 task 1-3 完成后跑真实 typecheck（清缓存，rule 23），暴露 **~20 个预存
typecheck 错误**，全部在 delivery 子系统，与本任务零因果：

- `delivery/agent.ts` / `service.ts` / `tools.ts` / `orchestrator/tools.ts:4300`：
  `Property 'hostGateFailures'|'runtimeEvidenceFailures'|'visualMetricFailures'|
  'manifestGate'|'manifestFailureDetails' does not exist on type 'DeliveryInfo'` +
  `DeliveryDecision` 类型不兼容。
- 根因：`DeliveryInfo`（定义于 `delivery/checks/types.ts:90`）被**并发改动**——
  `git diff HEAD` 显示该文件缩减 27 行（删掉上述属性），consumer
  agent.ts/service.ts/tools.ts 共 ~347 行 churn 的**他人在途未完成重构**。
- 证据：session 起始 git status **无**这些 delivery 文件 M；session 中途出现 M，
  全程伴随反复 "file modified since read" 漂移 → 分支 `codex/agent-boundary-role-
  contract` 上有**并发 actor（codex 进程/编辑器）正在重构 DeliveryInfo**。

判定（rule 22 / 28b / 2 / 33）：

1. 我的 task 1-3 改动洁净、隔离于非 delivery 文件（decision-log/index.ts、
   decision-log/bundle.ts、design-analyst/handoff.ts、intent/bundle.ts、
   orchestrator/tools.ts 的 import+删重复函数），不产生任何上述错误。
2. **禁止**触碰/"修复"该并发 delivery 重构（rule 22：破坏他人未提交在途工作）。
3. push gate 因该并发重构而红（rule 33：不绕 hook、不 --no-verify）→ 当前**无法
   交付**（task 7 阻塞），非我代码之过。
4. 剩余 task 4 须接线进 `delivery/agent.ts:289` 与 `delivery/tools.ts:962`——
   正是被并发重构的文件，继续必撞车 → task 4-6 **必须暂停**直至并发重构落定或
   决策 decision-log 工作隔离推进。

→ 需用户协调决策（并发 actor 状态/优先级只有用户掌握）。

## 11. 实施进展 + codex D5 精化（rule 28b/35，待复议）

**已落地（隔离、非撞车文件，编辑存活已验证）：**
- task1 `decision-log/index.ts`：`toFullDocument()` + 共享 `capEntryValue` 原语复用
  + 修不可执行旧文案（"decision_log row/readByKey" → `.opencorvus/decision-log.md`）。
- task2 `decision-log/bundle.ts`（新文件，我独有）：`paths/write/reference`，
  write hard-fail。
- task3 `design-analyst/handoff.ts`（单源 `designAnalysisArtifactPaths` + pathMode +
  "Canonical→Materialized"措辞）、`intent/bundle.ts`（`paths()`/`reference()`）、
  `orchestrator/tools.ts`（删重复函数 + import 单源；该文件已撞车，下文）。
- task5 部分 `engine/state.ts`：终止 final-write 钩子（见下精化）。

**codex D5 精化（rule 35：显式标注、非静默重写，待 codex 复议）：**
codex D5 裁"bundle 写失败必须一律 hard fail"。落地时按 rule 1 精化为**双档**：
(a) write-**before-consume**（消费 agent 真正需要该文件）= hard fail，保留 codex D5；
(b) **终止 seam**（`finalizeLiveRunForTerminalTask`，消费已完成，文件仅审计刷新）=
best-effort + `log.error`（不吞、不 throw）。理由：终止 seam 若 throw 会级联打断
任务终止 + live-run 收尾，比"审计投影陈旧"严重得多——非 load-bearing 副作用不应
中止核心终止写（rule 1）。非 rule 7 fallback：无替代代码路径，失败被 loud 记录而非
静默伪成功。**codex 复议结论（2026-05-18，rule 35 共识达成）：精化通过。**
- A：接受双档（YES）——代码事实支持此边界；终止 seam 沿用无差别 hard fail 会把审计
  投影副作用升级成核心终止状态机失败源，违 rule 1 根因权重。
- B：codex 不驳回；并确认"先 updateRun 再写 bundle 再 throw"是更坏语义（核心终止已成功
  却报 updateTask 失败→重试/误报/重复终止），明确不采用。
- C：rule 7 / rule 8 / rule 15 逐条 **PASS**（非 fallback、非双源、非隐藏分叉）。
- D：现有 `log.error`（带 taskID+错误）已足够 loud；新增 EngineProtocol 事件 / staleness
  标记属过度工程（rule 5），**不加**。
- **precondition（强约束）**：恢复 write-before-consume 接线时，档(a) 必须严格按
  hard-fail 落地；终止 seam 通过**不得**成为放松消费前 hard-fail 的理由。
已落地的 `engine/state.ts` 代码与通过设计一致，无需改码。

**因并发重构推迟（rule 22/28b，非放弃）：**
分支 `codex/agent-boundary-role-contract` 有并发 codex 大重构（session 中 40→42+ M
文件、`.codex-*.txt` 痕迹、`orchestrator/tools.ts` 107 行并发 churn、delivery
`DeliveryInfo` 重构未完成致 ~20 预存 typecheck 错）。据用户"继续并行工作"，以下接线
**推迟**至并发重构落定（触碰即撞车，违 rule 22）：
- task4 in-process build 接线：`orchestrator/tools.ts:1998/2775/5797/5863`（撞车）。
- task4 外部执行器接线：`build/agent.ts` external compose（撞车）。
- task4/5 delivery：`delivery/agent.ts:289` 直注 + delivery write-before-consume
  （delivery 文件并发重构中）。
- task7 push gate：被并发 `DeliveryInfo` 预存 typecheck 错阻塞，rule 33 不绕 hook
  → 全分支当前不可 push，非我代码之过。
**可安全推进**：task4 `prompt/upstream-context.ts` 的 `buildTaskUpstreamAgent
ContextSections`（非撞车文件，注入后经 `delivery/tools.ts:962` 流到 delivery-inspect
而无需编辑 delivery 文件）；task6 对已落地部分的测试。

## 12. 本回合最终状态（rule 28b：诚实、不包装为"基本完成"）

**已落地且已验证（隔离文件，编辑存活已核）：**
- `decision-log/index.ts`：`toFullDocument()`（共享 `capEntryValue` 原语复用，无
  cap/limit，phase 分节）+ 修不可执行旧文案。
- `decision-log/bundle.ts`（新）：`paths/write(hard-fail)/reference`。
- `design-analyst/handoff.ts`：单源 `designAnalysisArtifactPaths` + `pathMode` +
  "Canonical→Materialized"措辞。
- `intent/bundle.ts`：`RELATIVE_PATH/paths()/reference()`。
- `orchestrator/tools.ts`：删重复 `designAnalysisArtifactPaths` + import 单源
  （⚠ 该文件并发撞车，最终态依赖并发重构 merge）。
- `prompt/upstream-context.ts`：delivery-inspect 注入 `DecisionLogBundle.reference`
  （relative，不碰 delivery 文件）。
- `engine/state.ts`：终止 seam final-write（codex Q-TERM；best-effort 精化 §11）。
- 测试：`test/pipeline/decision-log-bundle.test.ts`（9 pass）+
  `test/engine/terminal-decision-log-bundle.test.ts`（3 pass）+ 回归
  `test/pipeline/decision-log.test.ts`（11 pass，toPromptSection 截断无回归）。

**未完成（推迟，非交付，rule 28b 不掩盖）：**
- task4 in-process build 接线（orchestrator/tools.ts 4 处）、外部执行器绝对路径接线
  （build/agent.ts）、delivery/agent.ts:289 直注、core-text 双源清除 —— 全部因目标
  文件处于**并发 codex 大重构**中（rule 22 禁触碰）。
- task5 write-before-consume（build/agent.ts 撞车）。
- task6 上述推迟项的测试。
- task7 push gate：被并发 `DeliveryInfo` 重构的 ~20 预存 typecheck 错阻塞
  （rule 33 不绕 hook、不 --no-verify）→ **全分支当前不可 push，非本工作之过**。

**commit/push 暂缓理由（rule 33 vs rule 22 冲突的取舍）：**
`orchestrator/tools.ts` 被我编辑且被并发 codex 107 行 churn——`git add` 会捕获并发
重构半成品中间态、割裂他人在途工作（rule 22 + memory codex_git_pathspec_pitfall
"并发 git surgery"高危）。故工作留工作树，本 artifact 为 durable 笔录（rule 32）。

**恢复路径（并发重构落定、分支重新 typecheck 通过后）：**
1. 复核 `orchestrator/tools.ts` 我的单源改动是否被并发 merge 保留/冲突，按需重做。
2. 接线推迟项（4 个 orchestrator build 点 relative、build/agent.ts external absolute、
   delivery/agent.ts:289、core-text 双源清除）+ write-before-consume。
3. 补对应测试；跑 `bun run typecheck` 全绿后 commit + push（不绕 hook）。
4. ✅ 已完成：§11 codex D5 双档精化已取 codex 复议共识（精化通过）。
   恢复 write-before-consume 时**必须**严格遵守 precondition：档(a) hard-fail 不放松。

## 7. codex 二轮审查反馈（rule 35：显式标注，禁静默重写）

定论（已我方代码核实，部分修正 codex 措辞）：

- **Q-PATH-2 → (c)**：外部执行器所有 load-bearing `.opencorvus/<f>` 引用统一**绝对路径**
  （`Instance.directory` 根）；in-process build/delivery 保持相对（走 opencorvus `read`，
  `read.ts:38` 按 `Instance.directory` 解析）。不选 (a)/(b)。
- **SCOPE**：必须同根一并修 intent bundle + design-analysis materialized files +
  decision-log bundle 三者对外部执行器的可达性（同一 latent bug，rule 4/1）；**边界**：仅限
  外部 build executor 被要求读取的任务材料，不扩到所有 `.opencorvus` config/plugin/trace。
- **Q-DESIGN**：共享 renderer 方向对，但 §8.4 接缝**错**——核实确认
  `buildGoalUpstreamAgentContextSections` **零调用点**（dead/未接线）。goal build 真实接缝
  在 `orchestrator/tools.ts:1998/2775/5797/5863` 手工 `renderDesignAnalysisHandoffReference`；
  delivery startup 在 `delivery/agent.ts:289` 直接 `phasePromptSection`，delivery inspect
  走 `delivery/tools.ts:962 buildTaskUpstreamAgentContextSections`。renderer 必须接入这些
  **真实**调用点，禁止新增未被调用的 helper。
- **Q-TERM**：单一终止逻辑接缝 = `engine/state.ts:33 updateTask`，intent
  `completed/failed/cancelled`→`time_completed=now`（state.ts:67-79）。核实补充：`active`
  分支（state.ts:63-65）会清 `time_completed`（终止非单调，可 terminal→active→terminal）
  → final write 须**每次进入终止都写**，并覆盖"row 已 terminal 的重复 update"守卫分支
  （否则首次 terminal 后 bundle 写失败、重试时 row 已 terminal 会漏写）。汇入 updateTask
  的终止入口：fail_task、accepted delivery completion、cancelTask、abortRun active-run
  failure、orchestrator startup model failure、stream-error fuse、project shutdown abort。
- **v2 §2-§4**：D1 PASS（并修 design-analysis "Canonical … file" 文案，decision-log 文件
  只称 materialized projection/read surface）；D2 PASS；D3 PASS（final write 落 updateTask
  seam）；D5 PASS；Q3 PASS；**D4 改**：不以改三处 core text 为主方案——core text 现有
  hardcoded design-analysis 相对路径不得与 renderer 形成双源（rule 8），统一到 renderer。
- **补缺口**：`renderDesignAnalysisHandoffReference` 加 path-mode 并审全调用点；IntentBundle
  暴露 paths + reference renderer（外部执行器拿绝对 intent 路径）；删/改
  `decision-log/index.ts` "full body in decision_log row / readByKey" 不可执行旧文案；
  测试覆盖见 §10。
- **结论：需修订后实施** → 本 v3（§10）即修订定稿。

## 10. v3 实施定稿（codex 二轮共识，rule 32 实施依此盘）

**新增组件**
- `decision-log/index.ts`：抽共享单条渲染原语；新增 `toFullDocument()`（phase 分节、无
  cap/limit、含 key/value/reason/goalID/timeCreated、时间序、空→空文档）。删除/改写
  "full body in decision_log row / readByKey" 旧注释为指向 materialized 文件。
- `decision-log/bundle.ts`：`DecisionLogBundle`，含
  `path(projectDir) -> {relative:".opencorvus/decision-log.md", absolute}`、
  `write(projectDir, taskID)`（渲染 `toFullDocument()` → 写
  `Instance.directory/.opencorvus/decision-log.md`，**hard fail**，空日志写空文档）、
  `reference({ taskID, mode:"relative"|"absolute" })`（prompt 文案 renderer）。
  结构镜像 `design-analyst/handoff.ts` + `intent/bundle.ts`。

**系统性绝对路径修（Q-PATH-2 (c) / SCOPE）**
- `renderDesignAnalysisHandoffReference(taskID, { …, pathMode })`：新增 pathMode；relative
  保持现状，absolute 用 `designAnalysisArtifactPaths(Instance.directory).prdAbsolute/...`。
- `IntentBundle`：暴露 `paths(projectID) -> {relative, absolute}` + `reference({pathMode})`。
- 三者的外部执行器引用走 absolute；in-process/delivery 走 relative。
- core text（build-core/delivery-core/externalBuildSystemContract）现有 hardcoded
  `.opencorvus/...` 路径文案：移除，改由 renderer 单源注入（消除 rule 8 双源）。

**接线（真实调用点，禁 dead helper）**
- 外部执行器派发：`build/agent.ts` external 组装（composeExternalCodingSystem /
  externalBuildSystemContract 处）注入三 renderer 的 **absolute** 文案。
- in-process build 上下文：`orchestrator/tools.ts:1998/2775/5797/5863` 现有
  design-analysis 注入处，并排加 decision-log（relative）。
- delivery：`delivery/agent.ts:289` startup + `delivery/tools.ts:962`
  `buildTaskUpstreamAgentContextSections` 各加 decision-log（relative）。
- write-before-consume：build（in-process & external）派发前、delivery verify 前
  调 `DecisionLogBundle.write(Instance.directory, taskID)`。
- final write：`engine/state.ts updateTask` terminal intent（completed/failed/cancelled）
  调 `DecisionLogBundle.write`，覆盖 row-已-terminal 重复 update 分支。

**dead code 处置（rule 17）**：`buildGoalUpstreamAgentContextSections` 零调用点——向用户
报告，不在本任务擅自删；本任务不依赖它，接线走真实调用点。

**测试（rule 36）**
1. `toFullDocument()`：phase 分节/无 cap-limit（value>600 不截）/含全字段/空→空。
2. `DecisionLogBundle.write`：落 `Instance.directory/.opencorvus/decision-log.md`；写失败
   **hard fail**。
3. 外部执行器引用 = **绝对**路径（decision-log + design-analysis + intent 三者断言）。
4. in-process build / delivery 引用 = 相对路径且经 `read.ts` 解析可达
   `Instance.directory`。
5. `updateTask` completed/failed/cancelled 各触发 final write；row 已 terminal 的重复
   terminal update 仍写（no-op 守卫覆盖）。
6. 回归：`test/pipeline/decision-log.test.ts` `toPromptSection` 截断不变；core text 不再
   含与 renderer 重复的 hardcoded `.opencorvus` 路径（双源回归）。
7. 旧文案断言：`decision-log/index.ts` 无"去 decision_log row/readByKey 读完整"。
