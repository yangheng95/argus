# 三任务调度与验收复盘：KeyStatisticsMT / CandlestickChart / TrendChart

> 撰写日：2026-05-14
> 取证：`engine_artifact` (kind=run / goal_run_attempt / acceptance / integrity_attempt / verification-evidence / orchestrator-stream-error)、`protocol_event` (workflow.step.updated / integrity.review.\*)、`session` 树、`engine_interaction_request`。
> 数据库快照：`C:\Users\chuan\AppData\Local\opencorvus\.opencorvus\opencorvus.db`，三任务时间窗 2026-05-13 11:20 — 2026-05-14 02:03。

---

## 0. 任务结局速览

| Task             | id                               | 结局                                                                                                       | Goal 数                                                  | 耗时                                                                 | 关键现象                                                                                                                                                                                        |
| ---------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KeyStatisticsMT  | `tsk_e2110fadf001oLDWI9aO0Wrq7U` | **cancelled**（metadata.cancelled=true）；**真正原因是 retired acceptance verifier threw** —— 见 §7-修订 1 | 5 / 5 passed（goal 4 retry=1，superseded=`build_retry`） | 11:20 → 14:16（约 2h 56m）                                           | DAG 串行由 architect 设计强制；无 orchestrator stream error；无 interaction；终态来自 acceptance_review_threw                                                                                   |
| CandlestickChart | `tsk_e21cff31a001KYZ7u8h27S0tKo` | **failed**                                                                                                 | 1 / 1 passed                                             | 14:48 → 17:12（约 2h 24m）                                           | 4 次 deliver 拒绝 + 1 次 worktree 创建失败；component 全部 10 条 spec 通过；系统**确实**发了 `interaction_request` "阻断问题处理"，但 5min 后被自动 reject（见 §7-修订 3）                      |
| TrendChart       | `tsk_e21d04c70001ElmU0hK4MZwZEP` | **cancelled**（用户在凌晨 02:03 手动取消）                                                                 | 1 goal pending（retry=1）                                | 14:49 → 02:03（约 11h 14m，其中 19:33—02:03 共 6.5h 处于 `blocked`） | LLMActivity 总 deadline 3600000ms 触发后无人收拾；6 次 build→deliver 循环；架构师下了缩量修正，executor 仍按全量做；任务前期早有一次 `interaction_request`（C# 源码路径） 也被 5min auto-reject |

---

## 1. CandlestickChart：交付侧基础设施"修一个、坏一个"的级联

CandlestickChart 的 `engine_task.error` 已是教科书级自陈：组件本体 9 文件、10 条 acceptance spec 全过；失败源全部在 host manifest 验收侧。`workflow.step.updated` 时间线印证：

```
15:57 deliver running        →  16:00 deliver failed
16:01 build  running 2 min   →  16:03 build  completed
16:03 deliver running        →  16:07 deliver failed
16:14 build  running 1.5 min →  16:15 build  completed
16:15 deliver running        →  16:32 deliver failed (17 min)
16:33 build  running 18 min  →  16:51 build  completed
16:52 deliver running        →  17:11 deliver failed (19 min)
17:12 build  running         →  17:12 build  FAILED  (worktree 创建失败)
```

四个 deliver 失败对应四次"为了通过交付门禁去改 host 项目本身"，每一次都引入新一类项目级问题：

| #   | 阻断                                         | LLM 修复手段                       | 引入的新问题                            |
| --- | -------------------------------------------- | ---------------------------------- | --------------------------------------- |
| 1   | `package.json` 缺 `packageManager`           | 添加 `pnpm@10.32.1`                | conflicting lockfiles                   |
| 2   | `package-lock.json` 与 `pnpm-lock.yaml` 冲突 | 删 `package-lock.json`             | TrendView 引用不存在的 `useTrendData`   |
| 3   | TrendView 引用缺失模块                       | 创建 `trend-chart` 存根（22 文件） | TS 类型冲突 + 测试页缺 HXKlineChart CDN |
| 4   | 存根 TS 冲突 + CDN 缺失                      | —                                  | `git worktree add` 失败（旧分支残留）   |

**根因**：当 `runtime:web` 之类"硬门禁"需要项目级 dev server 真正能跑起来时，LLM 被迫去修 `package.json`/`lockfile`/`vite.config`/CDN——这是**项目主干的形状**，每一次修都把失败面外扩。组件 goal 与项目级基础设施的失败被混进同一回路，重试只会把雪球滚大。

**对应的项目规则**：

- **rule 7（禁止 fallback）反向破坏**：deliver-fail→build-fix 的循环正是在累积"为了通过门禁的补丁"，每一层都在制造下一层 bug。
- **rule 20（禁止"最简单的修复"）**：每一轮 LLM 都在做"最简单的修复"，没有人 challenge"该不该修 host 配置"。
- **rule 28b（敢于宣告失败）**：终局的 task.error 文本是这条规则的优秀范例——明确列出 4 次拒绝、未解决问题、建议手工恢复步骤。

**整改方向（系统级）**：

1. 引入**故障分类器**：`runtime:*`、`packageManager:*`、`worktree:*` 等环境/基础设施失败必须与"组件 goal 失败"走不同的恢复路径；前者不应触发 goal-level build retry。
2. **冻结 host 主干文件**为交付期不可写白名单：`package.json` / `pnpm-lock.yaml` / `vite.config.*` / 根 `tsconfig` 等。LLM 若要改这些，必须显式 `interaction_request`，不能藏在 deliver-retry 里默默改。
3. worktree 创建失败必须立即降级为不可重试的 fatal，不要继续 deliver-build 循环。

---

## 2. TrendChart：单 goal 跑了 11 小时——验收侧三条死结同时存在

### 2.1 时间线（workflow.step.updated）

```
14:50 intent           18 min
15:15 build (intent后)  3 cycles, 累计 13 min
15:30 requirements      5 min
15:36 architect         6 min
15:43 goal-run started (data layer goal)
16:13 goal_run.passed   ← goal 在 30 min 内首次通过
16:14 build (rework #1) 33 min  ← 已通过的 goal 又开始 build
16:47 build (#2)         6 min
16:53 integrity.review.started → 16:57 review.completed (verdict=needs_correction, 15 issues)
16:58 build (#3)         5 min
17:03 deliver started
17:11 deliver FAILED
17:28 build (#4)         60 min
18:28 build (#5)          5 min
18:33 build (#6)         86 min (最长一段)
19:33 RUN BLOCKED         ← orchestrator_stream_error: MessageAbortedError LLMActivity total deadline 3600000ms exceeded
... 6.5 小时无任何事件 ...
02:03 task.cancelled      ← 用户手动取消
```

### 2.2 三条死结

**死结 A — `runtime:web` 门禁与项目拓扑错配**

最后一条 verification-evidence (`art_e2261d521001sqzBdIYp9FDfIl`) 自陈：

> host manifest 硬门禁报 runtime:web 失败……直接复现表明失败根因是验证侧 dev server 配置：managed_preview_command 启动的是 root electron-vite dev（serve renderer app），而 web 预览页（含 TrendChart）需 `cd src/web && pnpm run dev`。尽管如此，必须按硬门禁要求提交 rejected。

orchestrator 已经准确诊断出**配置错配**，但因为是"硬门禁"，只能 reject。session 列表里可以看到三个补救 build session 全部是为了"修 root vite 配置以 serve `src/web/preview/`"——这是 §1 的 CandlestickChart 同类陷阱：让 LLM 改根目录 `vite.config` 去迁就一个本应被改的 host manifest 字段。

**根因**：`managed_preview_command` 在 host manifest 层就配错了，不是组件的责任，不应进入 deliver-retry 回路。

**死结 B — Integrity 修正与 Executor 行为不一致**

`integrity_attempt` 输出非常清楚：goal 实际只做了"数据层"，但 15 项 requirement uncovered。Architect 给出的 correction 是**缩减 goal 自身的 `requirement_ids` 到 `["REQ-8"]`**（即只 claim 类型/导出），其余 REQ 应由**新 goal** 承接。

但是从 session 列表看，retry=1 之后的 build session 是：

```
ses_1ddb9b28effd40XvHJQd2eDXds  Build: 请读取 src/shared/components/TrendChart/TrendChart.tsx 的完整内容
ses_1ddc2fdddffdlV2iJ3pQPidZXE  Build: 请检查并完成 TrendChart 组件的预览页接入工作
ses_1dde1902bffdVbqXG3P64y5LkX  Build: 请基于已完成的数据层（types.ts/...） ...
```

即 orchestrator 仍把"组件本体"+"预览页"压回**同一个原本只该做数据层的 goal** 里去重做。`engine_goal` 表的 contract 没有再切片，新的 goal/contract 没有被创建。这是 **rule 8（禁止双源）的隐形违反**——同一 goal 同时承载两个语义：integrity 看到的 "REQ-8 only" 与 executor 实际执行的 "全套"。

**死结 C — `LLMActivity total deadline` 触发后无人接管**

run 在 19:33 进入 `blocked`，`blocking_reason=orchestrator_stream_error`，error 文本即 `MessageAbortedError: LLMActivity total deadline 3600000ms exceeded`。这是 `llm/activity.ts` 的总 30 min（这里被覆盖为 60 min）deadline 兜底，做的是它应该做的事情。

然而从 19:33 到次日 02:03 的 **6.5 小时**间，`protocol_event` 完全空白，没有任何后续动作：没有 force_user_input、没有 escalation、没有自动 cancel。最近一次 commit `15506698b Force user input after two deliver attempts` 试图解决 deliver 死循环的用户介入，但**针对 stream deadline 触发后的 `blocked` 态没有任何对称处理**。

最终是用户手动按下 cancel；run.aborted 时连一条 orchestrator-side postmortem（像 CandlestickChart 那种）都没有写——cancel 路径吞掉了诊断输出。

---

## 3. KeyStatisticsMT：成功的也别只看表面

5 个 goal 全部 passed，但有几条细节值得记下：

### 3.1 顺序执行——rule 30 未生效

architect_fidelity.sourceCoverage 列出的所有权区是清晰分离的：

- goal 1 ↔ `KeyStatisticsMTts.types/api` (`src/web/.../KeyStatisticsMTts/`)
- goal 2 ↔ `KeyStatisticsMTts.hooks/config`
- goal 3 ↔ `KeyStatisticsMTts/Component+ContextMenu`
- goal 4 ↔ `KeyStatisticsMTts/index.ts + .cap.md`（依赖 1-3）
- goal 5 ↔ `tests/` 验证（依赖 1-4）

`goal_run_attempt` 时间戳显示这 5 个 goal 严格串行：goal 1 完成在 11:52 → goal 2 在 11:55 起 → goal 3 在 12:14 起 → goal 4 在 12:31 起 → goal 4 retry 在 12:37 → goal 5 在 12:43 起 → 13:46 收尾。**至少 goal 1、2、3 可以并行**（owned_paths 不交叉），但实际为 0 并行。

`AGENTS.md` rule 30："所有的 Explore/SubAgent 任务优先并行完成，除非用户明确要求你串行执行"——这条规则在 orchestrator goal 调度层没有被落地。粗算这点串行成本占了 KeyStatisticsMT 总耗时的至少一半。

### 3.2 `engine_artifact[kind=goal_run_attempt]` 噪声很大

5 个 goal 一共产生了 **42 行 goal_run_attempt**——单个 goal_run_id 会在相隔毫秒级的时间内反复写 `running/running/completed/completed/completed` 多遍 payload。append-only "latest wins" 语义下功能正确，但：

- 排查问题时要先在心里"去重 latest"才能读懂时间线；
- 增加 DB IO 与索引膨胀；
- 暗示 `persist.beginBuildAttempt` / `persist.updateGoalRun` 调用点不止一处写同一态。

---

## 4. 横向看：调度与验收的系统性教训

### 教训 1：交付门禁与 goal-build 回路必须解耦

CandlestickChart 与 TrendChart 共同体现：当 `runtime:web` / `packageManager` / `worktree` 等环境/基础设施类失败被压回 build retry 回路时，LLM 会以"修 host"为捷径，每次修都把失败面外扩。门禁分类要明确：

- **环境配置**类失败 → 必须升级为 `interaction_request`，请用户处理或更新 manifest；不进入 build retry。
- **组件实现**类失败 → 才进 build retry。
- **worktree 创建/合并**类失败 → 立刻 fatal，不可重试。

### 教训 2：Architect correction 必须实际改 goal contract

TrendChart 的 integrity 已经准确指出 goal 范围错了，给出了 `requirement_ids: ["REQ-8"]` 的缩减，并明确说其余 REQ 需要**新 goal** 承接。但实际 retry 之后的 executor session 仍然在做"全套"。这是 rule 8 的隐形违反——goal 的"声明的范围"与"实际执行的范围"产生了双源。落地要点：

- `integrity_attempt.corrections` 一旦带 `action=modify` 或缺失 goal，必须先在 `engine_goal` / `architect_contract_graph` 物化为新的 goal contract / plan_version，再进 build。
- build session 的 prompt 必须从更新后的 contract 派生，不能从 task-level 原始请求派生。

### 教训 3：`blocked` 态需要主动接管

`LLMActivity` 触发 total deadline 是它的本职——但 `run.status=blocked` 不应该是终态。需要至少一个：

- 自动转 `force_user_input`：把 deadline 文本 + 当前 phase + 已有 deliveries 摘要塞进 `engine_interaction_request`。
- 自动 cancel + 写 verification-evidence postmortem：避免像 TrendChart 这样最后由用户 cancel 把诊断信号一并吞掉。

最近 `15506698b Force user input after two deliver attempts` 已经迈出半步，但作用域只覆盖 deliver-fail 次数，未覆盖 deadline-blocked。这是同类问题的不同入口。

### 教训 4：parallelize-by-default 的 goal 调度

KeyStatisticsMT 的 5-goal 顺序执行展示了 rule 30 在 orchestrator 调度层没落地。`architect_contract_graph` 已经知道 `depends_on` 和 `owned_paths`——可以基于 DAG 拓扑天然并行。整改：

- goal scheduler 默认按 `depends_on` 拓扑分层并行，叶子层（无依赖）多个 goal 同时进入 build。
- KeyStatisticsMT 场景下 goal 1/2/3 owned_paths 不交叉，可并行；goal 4 依赖前三，单跑；goal 5 依赖 1-4，单跑。粗估节省 30-40% 总耗时。

### 教训 5：cancel 路径不应吞诊断

TrendChart 终态 cancelled 而非 failed，没有 `task.error` postmortem，没有 verification-evidence。CandlestickChart 之所以可分析全靠 `failed` 路径写出的长文 `task.error`。整改：cancel 与 fail 应**共用**同一 postmortem 写入路径——cancel 时也要把 "已完成的部分 / 未完成的问题 / 失败原因 / 建议后续" 落到 `engine_artifact[kind=verification-evidence, label=cancel-evidence]`。

### 教训 6：stuck-loop 早期检测

复核 `feedback_loop_signals.md` 中的"step 数飙升、toolCalls 不停涨"信号在数据库侧的对应：

- CandlestickChart 的 4 次 deliver-fail，每次 build 5-18 分钟；
- TrendChart 的 6 次 build cycle，最后两次分别 60 / 86 分钟，单次 60 min 已经接近 hourly deadline。

`workflow.step.updated` 同一 phase 在短时间内重复进入 running 状态超过 3 次，即可早期判定 loop，写入 `engine_interaction_request` 而不是等 1 小时 deadline 兜底。

### 教训 7：goal_run_attempt 重复写入收敛

5 goal × 8 行/goal 的写入量当下问题不大，但是 latest-wins 协议背后藏着多写入点的散射。需要审计 `persist.beginBuildAttempt` / `persist.updateGoalRun` 的调用源，把"同态多写"合并为一次。

---

## 5. 行动清单（优先级排序）

| #   | 项                                                                                                     | 影响                                            | 体力估算                                       |
| --- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ---------------------------------------------- |
| 1   | host gate 故障分类器：环境/基础设施类失败不进 build retry，强制走 interaction_request                  | 直接消除 CandlestickChart / TrendChart 失败模式 | 中（host manifest schema + run dispatcher 改） |
| 2   | freeze host 主干文件：`package.json` / lockfile / 根 `vite.config` / 根 `tsconfig` 在交付期 LLM 不可改 | 切断 §1 的级联                                  | 小（工具白名单）                               |
| 3   | integrity correction → 真正生成新 goal / 更新 contract，build prompt 必须从更新后 contract 派生        | 修复 §2 的双源行为                              | 中                                             |
| 4   | `run.status=blocked` 自动派发 force_user_input 或自动 cancel + 写 postmortem                           | 杜绝 TrendChart 的 6.5h 静默                    | 小                                             |
| 5   | goal scheduler 按 `depends_on` 拓扑并行，叶子层同时进入 build                                          | 整体加速 30-40%                                 | 中                                             |
| 6   | cancel 与 fail 共用 postmortem 写入路径                                                                | 复盘可用性                                      | 小                                             |
| 7   | workflow.step.updated 同 phase 重入 >3 次 → 强制 interaction_request                                   | 替代 1h deadline 的早期兜底                     | 小                                             |
| 8   | 审计 `persist.beginBuildAttempt` / `persist.updateGoalRun` 写入点合并                                  | 降噪                                            | 小                                             |

---

## 7. Codex 独立复核：4 处修正与 4 处补充

> 取证：Codex 用同一 DB，独立查 `engine_goal.depends_on` / `engine_interaction_request` / artifact kinds、并对照 `build-core.txt` / `dimensions.ts` / `runtime.ts` / `merge-never-crash-plan.md` / CLAUDE.md。verdict = `agree-with-revisions`。原文档保留以便对比；以下条目为修订与补充，**优先级以本节为准**。

### 修订 1：KeyStatisticsMT 的"成功"是假象 —— `acceptance_review_threw`（原文 §3 错误）

`engine_artifact[task=KSM]` 含三条同时间戳（2026-05-13T14:16:59.293Z）证据：

- `kind=acceptance_review_threw label=acceptance_review_threw payload={"error":"acceptance review failed","iteration":0,"verdict":"rejected"}` (id `art_e21b2b09d001lisYuliorQv72B`)
- `kind=verdict label=acceptance-review-verdict summary="retired acceptance verifier threw before producing a verdict"`
- `kind=verification-evidence label=evidence-acceptance status=failed verdict=rejected`

时间戳与 `engine_task.time_completed=1778681819305` / `error="task cancelled"` 完全重合。即所谓"用户取消"几乎可以肯定是**系统在 verifier 异常时把 task `metadata.cancelled` 翻成 true 并归于 cancel 终态**，并非真正的人工 cancel。原文档把 KSM 当"5/5 passed 但被用户 cancel"是错的——它是个 **acceptance verifier 自身抛异常**的样本，比"串行慢"严重得多。

**对应 AGENTS.md**：rule 28b——cancel 路径在这里又一次吞掉了真实失败语义；用户看到的是 `task cancelled`，而结构化失败原因只能从 artifact 翻出来。

### 修订 2：KSM 的 goal DAG 是 architect **设计成**串行的（原文 §3.1 错误）

`engine_goal.depends_on` 实测：

```
#1 types-and-api:     depends_on=[]
#2 hooks-and-config:  depends_on=[#1]
#3 main-and-menu:     depends_on=[#1, #2]
#4 barrel-and-docs:   depends_on=[#3]
#5 verification:      depends_on=[#1, #2, #3, #4]
```

最多只有 goal 1 是叶子（无依赖），其余按 DAG 拓扑就是严格串行。原文档说"goal 1/2/3 owned_paths 不交叉所以可以并行"——这违反了 **rule 35（不要单点采样泛化）**：我只看了 `owned_paths`，没读 `depends_on`。

**真正的整改方向**：不是"scheduler 没并行"，而是 **architect 是否过度保守地生成串行 DAG**。types→hooks→component→barrel→verify 在工程上确实链式依赖，但若 architect 能识别"hooks 不真正依赖 types 的实现细节、只依赖 type 文件存在"，可以让 hooks 与 component 在 types 落盘后并行。这是 **architect prompt 的问题**，不是 scheduler 的问题。

### 修订 3：`interaction_request` 真的发了，但 **5 分钟自动 rejected**（原文 §4 教训 3 严重欠准）

DB 实测：

- CC 在第 2 次 deliver-fail 后（2026-05-13T12:08:13Z）发了 `int_e22188903001MZCnUSBINrWmxQ`，title `阻断问题处理`，body 是"package-lock vs pnpm-lock 冲突，请选删除 / 跳过 / 暂停"。**12:13:13Z 状态翻 `rejected`，`response={}`**，恰好 300001ms。
- TC 在 11:09:39Z 发了 `int_e21e2eaca001db16c2vGk755BI`，title `C#源码路径 / 备选方案`。**11:14:39Z `rejected`，response={}**，同样 300001ms。

这意味着系统**有**主动求助机制，但是被一个 5 分钟 stale auto-reject（`runtime.ts` 中的 idle 兜底）当成"用户没回应=按默认继续"消化掉了。这直接撞 **AGENTS.md rule 28c（无）**——目前规则里没有"用户输入是真实硬阻塞"的条款；但 commit `15506698b Force user input after two deliver attempts` 的设计意图被这条 5 分钟兜底逻辑空转化。

**对应整改**：见 §8 修订后清单 #1 —— 这是最大的真问题，原文档把它误诊为"没提问"。

### 修订 4：TrendChart 19:33–20:00 父 run blocked 但 child build **仍在跑**（原文 §2.1 描述不准）

原文写"19:33 → 02:03 protocol_event 完全空白"——只对了一半。实测：

- 19:33:24Z run `run-blocked` 写入，`blocking_reason=orchestrator_stream_error`
- 同时段 child build session `ses_1dd621f3effd5qLVEA4xQjfC27` **继续流式产出 274 个 part**（reasoning / tool call / step-start / step-finish，主要在 read / glob / bash）持续到 19:59:54Z。
- 19:59:54Z `session.bridge` 写 `session.status terminal error: TerminalToolMissingError: Model did not call terminal tool report_build_result before the turn ended (finish=length)`。
- **紧接着同毫秒**写 `workflow.step.updated status=completed summary="Step \"Executor\" completed"`——**child terminal error 被记成 step completed**。

这不是"静默"，是**父子生命周期脱钩 + step 真值源错配**——比 stuck-loop 严重得多。19:59 之后才是真正的静默直至 02:03 cancel。

### 补充 1：CC / TC 的真正根因是 architect/integrity 没把 implicit infra goal 建出来

复核 `build-core.txt:89` 与 `dimensions.ts:147`：browser / UI deliverable 的契约**已经规定**：

- 必须有 root `package.json` / `packageManager` / `scripts.dev`，acceptance 从仓库根启动；
- runtime entrypoint / root config 必须被某个 goal owning。

CC 的唯一 goal 仅 own `src/shared/components/CandlestickChart/` + C# 源目录；root `package.json` / lockfile / preview 注册位 / CDN 注入都**没有任何 goal 认领**——按 `dimensions.ts` 的口径这本来就该被 integrity 标 `missing_capability`，但实际没有。也就是说，原文档把 §1 定性为"host gate 错配 + 让 LLM 改 host"是表面诊断，**真正的根因**是 **architect/integrity 在浏览器交付物上没生成 infra goal**，导致环境配置变成"无主之地"，每次 deliver-fail 才被 LLM 临时认领去打补丁。

### 补充 2：`runtime:web` 是契约要求，不是 host 配错

原文档 §2.2 死结 A 把 `managed_preview_command` 定性成"host 配错，组件不该担责"是错的。`build-core.txt` 的契约就是 root pnpm run dev 必须能起。TC 的真正问题是：

- 项目本身把 web 预览拆成 `cd src/web && pnpm run dev`，与契约不符；
- architect 接到这个任务时没在 goal 里 own 这个差异（即"修 root 让 web preview 也能从根起"或"修 host manifest 用子目录 dev"）；
- 于是 deliver 看见契约缺口直接 reject，回路才滚起来。

修正后视角：**这是 contract coverage 漏洞**，不是"门禁误伤"。

### 补充 3：`workflow.step.updated` 真值源可疑

由修订 4 引申：`workflow.step.updated` 是从 assistant 端 emit 的（source=`assistant`），落 `completed` 是基于模型自身宣布"我说完了"，没有交叉校验 child session 是否真的产出了 `report_build_result` terminal tool。**当 child 是 TerminalToolMissingError 终止时，workflow step 还是被错记为 completed**。这是一个跨任务可复现的真值源错配，需要把 workflow step status 改成从 `session.status.terminal.reason` 派生。

### 补充 4：原 §4 教训 6"3 次重入 → 提问"与 rule 28c 撞车

如果 §7 修订 3 落地（deliver 第 2 次 reject 后真实阻塞用户），那么原 §4 教训 6 的"3 次重入再提问"只能作为**低优先级观测信号**，不能替代 deliver 第 2 次的硬停。否则就是 rule 6.1 反向破坏——用 heuristic 状态机去糊弄"该等用户输入"。

---

## 8. 修订后的行动清单（替换原 §5）

| #   | 优先级 | 项                                                                                                                                                                                                                                       | 影响                                                | 体力估算                                                             |
| --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | **P0** | **真正实现"两次 deliver-reject 后硬阻塞用户"**：`engine_interaction_request` 不得 5min auto-reject；至少在 `request_type=question + parent run 来自 deliver-fail` 时不许 stale；commit `15506698b` 是 prompt 级，现在需要 runtime 级保证 | 直接消灭 CC / TC 的失败模式                         | 中（`runtime.ts:48` 的 5min 兜底要分类 + UI 侧需要更显眼地展示求助） |
| 2   | **P0** | **parent run blocked/failed 时 child session 强制接管 + workflow step status 改从 `session.status.terminal.reason` 派生**                                                                                                                | 修复 TC 父子脱钩与 step 错记 completed 的真值源问题 | 中                                                                   |
| 3   | **P0** | **retired acceptance verifier 抛异常的结构化失败路径**：当 verifier 自身抛错时，task 终态不应混淆成 cancelled；要把 `acceptance_review_threw` 标记进 `engine_task.error` 并触发明确的 retry/escalation 语义                              | 修复 KSM 的"假取消"误诊                             | 小                                                                   |
| 4   | **P1** | **architect/integrity 必须为 browser/UI deliverable 物化 infra goal**：root `package.json` / lockfile / preview/test runtime surface / 必要 CDN 要么被某个 goal `owned_paths` 覆盖，要么 integrity 在 `missing_capability` 维度 fail     | 切断 CC 与 TC 的环境补丁雪崩根因                    | 中（`dimensions.ts` 的 capability 维度扩展 + architect prompt 调整） |
| 5   | **P1** | **integrity correction 必须真物化为新 contract / 新 goal**，build session prompt 必须从更新后 contract 派生，不能从 task-level 原始请求派生                                                                                              | 修复 TC 的 goal 双源行为                            | 中                                                                   |
| 6   | **P1** | **cancel 与 fail 共用 postmortem 写入路径**：cancel 时把"已完成 / 未完成 / 失败原因 / 建议后续"落到 `engine_artifact[kind=verification-evidence, label=cancel-evidence]`                                                                 | 解决 KSM/TC 的 cancel 吞诊断                        | 小                                                                   |
| 7   | **P2** | **architect 生成更"宽"的 goal DAG**：识别"只依赖文件存在"而非"实现细节"的弱依赖，提供并行路径。注意：这是 prompt 调整，不是给 scheduler 加调度算法                                                                                       | KSM 风格的多 goal 任务整体提速                      | 中                                                                   |
| 8   | **P2** | `workflow.step.updated source=assistant` 全面切到 `source=session.status` 派生                                                                                                                                                           | 真值源一致性                                        | 小                                                                   |
| 9   | **P3** | 审计 `persist.beginBuildAttempt` / `persist.updateGoalRun` 写入点合并                                                                                                                                                                    | 降噪                                                | 小                                                                   |

### 已撤回 / 重写的原建议

- ❌ ~~"冻结 host 主干文件白名单"~~：与 **CLAUDE.md rule 6.1 prompt-over-host-invariant** 冲突；也容易落成 rule 13 禁止的状态机守门。真正的修复是补 #4。
- ❌ ~~"环境/基础设施失败必须升级 interaction_request"~~：系统**已经**在这么做了，但被 5min auto-reject 空转。真正的修复是 #1。
- ❌ ~~"goal scheduler 按 DAG 并行"~~：KSM 的 DAG 是 architect 定的串行；scheduler 已经按 DAG 跑。真正的修复是 #7（让 architect 生成更并行的 DAG）。
- ❌ ~~"worktree 创建失败立即 fatal"~~：与 `specs/new-arch/2026-05-01-merge-never-crash-plan.md` 冲突；改为 `blocked / infra_error` 结构化态。
- ⚠️ "同 phase 重入 >3 次提问"：降级为**低优先级观测**，不能替代 #1 的两次 deliver 硬停。

---

## 11. opencorvus 机制层结构性根因（Codex 二轮 review 收紧后版本）

> 第一版含 5 条断言被 Codex 用代码定位逐条 challenge，verdict `agree-with-revisions`：1/3/4 表述过强、2 成立、5 错。下面是收紧后的版本 + Codex 独立挖出的第 6 条。

### M-1. 没有"复杂度→goal 粒度"层面的 host invariant（原"无非-LLM invariant 闸"收紧）

- **已有**：`packages/opencorvus/src/architect/fidelity.ts::validateGoalFidelity:174-175` 在多 goal 时硬要求 `assemblyOwners`；`packages/opencorvus/src/pipeline/goal-contract.schema.ts` 硬要求 `acceptance_specs / owned_paths` 非空——这些是真实的 host invariant。
- **缺失**：但**没有一条 invariant 把"任务复杂度（如浏览器组件重写）→最小 goal 粒度（如 ≥3 个 goal、必须有独立 verification goal）"做成 host-side reject**。所以 CC/TC 把整个 C# 组件重写塞进 1 个 goal 仍能通过 architect submit。修法是在 architect submit 阶段加 task-kind-aware 的 minimal-partition 校验。

### M-2. Goal contract 与磁盘事实的双源，无写入门禁（**成立，无修改**）

`packages/opencorvus/src/build/agent.ts:500-503,731-734` 显式写：host 不审计 `files_changed[]` 与 `actual_changed_files` 的对齐，交叉核对留给 orchestrator LLM；`owned_paths` 被定义为 responsibility 而非 sandbox。结果：TC `447494e` 的 `TrendChart.tsx` + `utils.ts` + 集成 `import` 三个文件不在任何 task 的 `engine_artifact[kind=changed_file]` 链里，也不在 goal `owned_paths` 内，但已合到 master。修法是 `merge_back` 时按 `owned_paths` 做 diff-equality 校验作为门禁。

### M-3. integrity advisory + deliver 双层 hard gate 之间的语义错位（原"gate 方向反了"收紧）

- **integrity 确为 advisory**：`packages/opencorvus/src/engine/workflow.ts:386-395` 显式将 `needs_correction / corrections_count / missing_count` 排除出 workflow `failed`，CC 完全跳过 integrity 仍能进 deliver。
- **但 deliver 不止环境 hard gate**：`packages/opencorvus/src/acceptance/checks/project-gate.ts:234` 把 `review:contract_audit` 设成 blocking；`packages/opencorvus/src/acceptance/checks/runtime-evidence.ts:12-14` 也阻止 accepted。
- 真正的错位是：**架构正确性（fallback、死代码、scope drift）由 integrity 评但 advisory**，**部署可行性由 deliver 评且 hard**——前者不可恢复、后者可恢复，硬度与不可恢复性反向。修法是把 integrity 关键维度（`requirement_fidelity` + `solution_quality`）提升为 deliver 的 blocking 输入。

### M-4. fuse 兜底覆盖窗口太窄，TC 风格的"单次 deadline + 长尾静默"漏接（原"无非-LLM 终态收敛"收紧）

- **已有 fuse**：`packages/opencorvus/src/engine/persist.ts:2137-2147` `maybeTripOrchestratorStreamErrorFuse`，**3 次连续 stream error / 60s 窗口** 后转 failed。
- **TC 不在覆盖范围**：TC 是 1 次 `LLMActivity total deadline 3600000ms exceeded`，run blocked 后 6.5h 静默直到用户 cancel；fuse 的 60s 窗口 + 3 次阈值都不命中。修法是为"total deadline 触发后 run.status=blocked 持续 ≥N 分钟"另设独立的 blocked-stale escalation 路径——既不重复 stream-error 短窗口、也不撞 rule 13 FSM 红线。

### M-5. 已有 runtime-evidence hard gate，但其行为级断言无法生成可达性/语义/fallback 检查（原"spec 退化"撤回重写）

- **撤回**："spec 全部退化为 linting++"是错的——`packages/opencorvus/src/acceptance/checks/runtime-evidence.ts:5-13` 强制 live preview / 真实 DOM / walkthrough 作为 host hard-gate evidence；`packages/opencorvus/src/architect/output-tools.ts:397-400` 对 reference-driven 任务强制 `llm_judge`。
- **真正的缺陷收紧为**：现有 runtime-evidence 检查的是"能渲染、有 DOM 节点、文案命中"等**视觉级**事实，无法生成需要执行内部状态的断言——比如 KSM `resolveMarketKey` 的 11 条规则可达性（要 11 个不同 stock 输入）、三组件的 Mock fallback 触发条件（要 `window.dataAccessor` 不可用场景）、CC subscribe streaming 缺失（要观察是否有 onPush 路径被调用）。这些需要**契约级 fuzz / 反例数据驱动**的 spec 生成机制，目前 architect LLM 凭文本无法产出。

### M-6. 未声明 contract 的跨 goal 副作用无 host 发现机制（Codex 二轮独立挖出，本文档没看到）

`packages/opencorvus/src/acceptance/checks/project-gate.ts:234` 只对**已声明的** `review:contract_audit` 做 hard gate。但实际事故里，最大的副作用都来自**未声明的隐式跨 goal 耦合**：

- CC 的"TrendView import 拖垮 root build"——CC goal 没 own `TrendView.tsx`，但其交付改了 lockfile 让 TrendView import 失效；
- TC 的 `447494e` UI 层 commit 改了 `src/web/src/components/index.ts`——这条 import 注入是 cross-goal effect，但不在任何 goal contract 里。

修法是 `merge_back` 时对**整个 worktree 的非-owned-paths 文件 diff** 走一次 host-side scan：如果非-owned 文件有 import / export 增删，就要要么物化成新 contract、要么 reject。这是 M-2（owned_paths 双源）的**充分条件**——M-2 是"goal 内 owned_paths 写没写对"，M-6 是"goal 边界外有没有被动副作用"。

---

### 修订后的根因优先级（替代原 §10 §5 段）

| #       | 根因                                   | 元层归属       | 一旦缺失，导致的真实事故  |
| ------- | -------------------------------------- | -------------- | ------------------------- |
| **M-2** | Contract vs 磁盘双源、无写入门禁       | data integrity | TC `447494e` scope drift  |
| **M-6** | 未声明跨 goal 副作用无发现机制         | data integrity | CC 4 轮 deliver-fail 级联 |
| M-3     | integrity advisory / deliver hard 错位 | gate routing   | KSM Mock+死代码全程未挡   |
| M-1     | 无复杂度→goal 粒度 invariant           | gate routing   | CC/TC 单 goal             |
| M-4     | fuse 窗口太窄                          | recovery       | TC 6.5h 静默              |
| M-5     | spec 无法生成可达性/语义级断言         | verification   | 三组件功能正确性盲区      |

按 CLAUDE.md rule 6.1 的分类：**M-2 和 M-6 属于"数据完整性"类（owned_paths/contract 的形态正确性）**，是 host 必须做的硬不变性；其余 4 条是 prompt/spec/调度算法的协同。若只能修一处，先修 M-2 + M-6，因为它们是元层、能阻断其余 4 条的实际事故路径。

---

## 10. 实地交付物核查 —— 三项目真实完成度评估（rule 3 / 24 复核）

> 方法：去 `C:\Users\chuan\myhexin-local\demos\VibeCodingClient-dev` 实地查文件、读源码、对照 template（`Doc/business-requirement/opus-extract/prd/KeyStatisticsMT.md`、`Doc/components/HQComponent (debugged)/CandlestickChart.md`、`.../TrendChart.md`）。不信 DB 状态、不信 architect/integrity 的 `verdict`、不信 Codex 的 commit message。

### 总体判断

| 项目 | DB 状态                               | 真实完成度                                  | 真实完成度的"假象层"                                                                                                                                               |
| ---- | ------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| KSM  | 5/5 passed，`acceptance_review_threw` | **~85%** 但**核心路由有逻辑 bug**           | integrity `requirement_fidelity=pass` 没接住 `resolveMarketKey` 11 条规则中有 5 条死代码                                                                           |
| CC   | 1/1 passed，task failed at deliver    | **~70%** 且**从未经过 integrity**           | 整个任务全程**没有任何 `integrity_attempt` 行**，所谓 `goal passed` 仅代表 build 通过；`/test/` 页面从未真正渲染过                                                 |
| TC   | 1 goal pending，task cancelled        | **~55%** 且**实际工作量超出 goal contract** | 文件系统上有 481 行 `TrendChart.tsx` + 220 行 `utils.ts` + 集成层（commit `447494e`），但 goal contract 仅声明数据层；DB `pending` 与磁盘"已实现一大半 UI"严重错位 |

### KSM 详细评估

**文件就位** —— 7 文件全部在 `src/web/src/components/composite/KeyStatisticsMTts/`，对应 5 个 feat/fix commit 全部在 master。

**功能逐项核对**：

| template 章节                   | 要求                             | 实现情况                                                                  |
| ------------------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| §3.1 主视图                     | AcrossKeyValue 网格 + 动态列布局 | ✅ `KeyStatisticsMTts.tsx` 引用 `AcrossKeyValue`，`displayLines` 计算正确 |
| §3.2 标题栏                     | FlexibleTitleBar + 折叠按钮      | ✅ `FlexibleTitleBar` + `UpFoldDoubleArrow`/`DownFoldDoubleArrow`         |
| §3.3 折叠/展开                  | folded=3 行 / unfolded=全部      | ✅ `folded ? 3 : Number.MAX_SAFE_INTEGER`                                 |
| §3.4 右键菜单                   | "编辑字段" + "设置显示风格"      | ✅ `KeyStatisticsMTts.menu.ts` `buildContextMenuItems` 恰好这两项         |
| §3.5 字段编辑对话框             | OptionWindow + 系统默认          | ✅ `SYSTEM_DEFAULT_SELECTED_SHSZ` 12 项 + AVAILABLE 10 项                 |
| §3.6 显示风格                   | DisplaySelector                  | ✅ 已 import 复用                                                         |
| §4.1 市场 Key 路由（11 条规则） | resolveMarketKey 11 条规则       | **❌ 严重 bug** —— 见下                                                   |
| §4.2 配置同步                   | 跨实例广播                       | ✅ `DISPLAY_STYLE_CHANGED_EVENT` + `CONFIG_CHANGED_EVENT_PREFIX`          |
| §4.3 分时回放规则               | 状态机                           | 未检（需读 hooks 全文）                                                   |
| §3.x 实时数据                   | request + subscribe              | ✅ hooks 实现 snapshot+subscribe 模式                                     |

**核心 bug —— 11 条市场路由规则有 5 个 USHA/USZA 子分支组不可达**（`KeyStatisticsMTts.api.ts:48-110`，Codex 二轮表述收紧）：

> 注：规则 7/8/9/10/11 处理的是 UHKA / UUSA / UHKI / UHKE / UGLB 等独立市场代码，**不依赖** USHA/USZA 前置门控，因此**仍然活**。死代码限于规则 1 把 USHA/USZA 兜走后、规则 2-6 全部以 `market === 'USHA' || market === 'USZA'` 为门控的 5 个子分支组（A 股指数 / 可转债 / 上海债深圳债 / A 股基金 / 场内 ETF）。原文档"规则 2/3/4/5/6 全局死代码"表述过强。

```ts
// 规则 1: 沪深A股 或 USTM
if (market === 'USHA' || market === 'USZA' || market === 'USTM') return 'SHSZ'

// 规则 2: A股指数（同花顺指数、上证指数、深证指数、同花顺行业）
if (market === 'USHA' || market === 'USZA') {  // ← 死代码：规则 1 已 return
  if (code === '1A0001' || ...) return 'AStockIndex'
}

// 规则 3-6 同样以 market === 'USHA' || 'USZA' 起始 —— 全部不可达
```

整个 USHA/USZA 市场（A 股主力盘）的细分路由（A股指数 / ETF / LOF / 可转债 / 上海债深圳债）**全部失效**，命中即返回 SHSZ。`asp_market_key_rules - resolveMarketKey covers all 11 routing rules` 这条 acceptance spec 在 integrity 验证下被判 pass，因为 integrity 只看了"是否有 11 条规则分支"而**没有跑数据流证明每条都可达**。这是 rule 1（看见 bug 思考本质）的反例样本。

**结论**：KSM 文件完整、UI 完整、看起来"5/5 passed"，但**核心业务规则有 1/11 部分覆盖 + 5/11 死代码**，对生产环境意味着所有沪深A股个股的子类（基金/可转债/债券/指数）都会被错误路由到 SHSZ 默认配置。属于 rule 1（掩盖问题的补丁不算合格修复）。

---

### CC 详细评估

**文件就位** —— 7 文件在 `src/shared/components/CandlestickChart/` + 测试页注册。commit `fc15c0a`。

**致命系统漏洞 —— 整个 CC 任务全程没有任何 `integrity_attempt` 行**：

`SELECT * FROM engine_artifact WHERE task_id='tsk_e21cff31a001KYZ7u8h27S0tKo' AND kind='integrity_attempt'` 返回 0 行。workflow.step.updated 也没有 `integrity` 步。即 CC 跳过了架构与需求保真度审查直接进 deliver。后续 4 次 deliver-fail 全部是 runtime 类失败（packageManager / lockfile / TrendView / CDN），从未审核组件是否真正满足 template。

**功能逐项核对**（template `Doc/components/HQComponent (debugged)/CandlestickChart.md`）：

| 要求                                       | 实现                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| HXKlineChart Canvas 渲染                   | ✅ `window.HXKlineChart.init`                                                                        |
| 周期切换 1m/5m/15m/30m/60m/120m/1d/1w/1M   | ⚠️ PERIOD_OPTIONS 缺 120m                                                                            |
| MA5/10/20/30/60                            | ✅                                                                                                   |
| VOL 指标                                   | ✅                                                                                                   |
| 前复权/后复权/不复权                       | ✅                                                                                                   |
| 十字光标 / 缩放 / 拖拽 / hover             | ✅ subscribeAction('crosshair')                                                                      |
| 右键菜单（周期切换 / 复权切换 / 指标切换） | ✅                                                                                                   |
| 实时数据接入（subscribe streaming）        | **❌** —— `api.ts` 只有 `requestCandleData`，无 subscribe；template 明确"支持实时数据接入"           |
| 画线工具                                   | **❌** 未实现                                                                                        |
| 视觉验证（/test/ 页面）                    | **❌** —— deliver round 3 verdict 自陈"测试页 /test/ 缺少 HXKlineChart 运行时依赖，图表画布无法渲染" |
| MCP 协议周期别名（1h→60m, 4h→120m）        | 未检                                                                                                 |

**结论**：组件代码扎实但有两处明确缺失（实时订阅、画线工具），且 **`/test/` 页面从来没有真正成功渲染过组件**——所谓"10/10 acceptance spec passed"是 build 通过 + 文件存在，不是行为验证。task 自陈的"组件本身已完整实现"经不起 rule 24 复核。

---

### TC 详细评估

**最严重的状态错位** —— DB 说 goal pending、UI 层 0 完成，实际磁盘已有：

- `f17cac4 feat TrendChart 数据层`（goal contract 声明的数据层）
- `447494e feat TrendChart 分时图 UI 层与集成层实现`（**481 行 TrendChart.tsx + 220 行 utils.ts + 集成到 src/web/src/components/index.ts**）—— 这部分**不在任何 goal contract 内**，是 integrity 之后的 scope drift。

**功能逐项核对**（template `Doc/components/HQComponent (debugged)/TrendChart.md` + integrity 列举的 15 项 uncovered）：

| 要求（来自 template + integrity findings） | 实现状态                                                                                                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HXKlineChart line 模式渲染                 | ✅                                                                                                                                                                                             |
| 价格左轴                                   | ✅（HXKlineChart 内置）                                                                                                                                                                        |
| 涨跌幅右轴                                 | **❓** code 里没看到独立右轴配置；可能依赖 HXKlineChart 默认                                                                                                                                   |
| 分时线 + 均价线叠加                        | ✅ `均价线叠加` 块                                                                                                                                                                             |
| 渐变填充                                   | **❌** 无 gradient 代码                                                                                                                                                                        |
| 昨收基准线                                 | ⚠️ **委托 HXKlineChart**（`TrendChart.tsx:204` 调用 `chartRef.current.setPrePrice(data.meta.prevClose)`）。Codex 二轮纠正：组件层未显式绘制，但已通过库 API 传入；缺失与否仅凭 grep 不可定论。 |
| 网格线                                     | ✅（HXKlineChart 内置）                                                                                                                                                                        |
| 成交量量柱图                               | ✅ `成交量副图`                                                                                                                                                                                |
| 十字光标                                   | ✅ `subscribeAction('crosshair')`                                                                                                                                                              |
| hover 提示                                 | ✅                                                                                                                                                                                             |
| 悬浮信息框 7 字段面板                      | **⚠️ 部分** —— tooltip 显示均价/成交量，不到 7 字段                                                                                                                                            |
| 键盘左右键平移十字线                       | **❌** 无 keydown handler                                                                                                                                                                      |
| 顶部摘要栏（证券名/均价/最新价）           | ✅                                                                                                                                                                                             |
| 右键菜单（指标/坐标/刷新/复制）            | ✅                                                                                                                                                                                             |
| Canvas hi-DPI (devicePixelRatio)           | ⚠️ **组件层无引用**，但 HXKlineChart 内部含 `a.width=o*l; a.height=i*l; s.scale(l,l)` 之类 DPR 缩放（Codex 二轮）；可能已被库覆盖，仅凭 grep 不可定论。                                        |
| resize 自适应                              | ✅ `ResizeObserver`                                                                                                                                                                            |
| 主题切换                                   | ⚠️ utils 读 `brush-*` CSS 变量，但无 MutationObserver 响应主题变化                                                                                                                             |
| 空数据 / 加载 / 错误边界态                 | ✅ 三态都有                                                                                                                                                                                    |
| 实时数据推送 (SubscribeTrend)              | **❌** —— `useTrendData` 有 `subscribe` 模式开关但实际未接 SubscribeTrend 接口                                                                                                                 |

**结论**：TC 大约 **55-60%** 的 template 要求在磁盘上有对应实现，但：

- 关键缺失：渐变填充、昨收基准线、键盘导航、hi-DPI、SubscribeTrend 接入；
- DB 状态完全失真：goal=pending 表示"还没做"，但 `TrendChart.tsx 481 行`已在 master；
- 这部分工作是 integrity 标记 11 missing goals 之后由 executor "私自"做的，未被 architect 物化为新 goal，未走 integrity 二审，未进 acceptance 验收范围。

这是**最危险的失败模式**：用户看 UI 以为没做 / DB 以为没做，但代码已写、合并到 master，后续任何人接手都会撞见"有半成品但没人管"的状态。

---

### 跨项目的共性认知更新

1. **`goal status` 与"完成度"**——三层错位都存在：
   - KSM：goal passed，**逻辑错**（死代码）
   - CC：goal passed，**整个 integrity 步被跳过**
   - TC：goal pending，**实际超出 contract 已交付一大半 UI**
     `engine_goal.status` 在三个样本里没有一个准确反映真实完成度。

2. **integrity_attempt 缺失或失真比之前估计的更普遍**——CC 完全没有 integrity 步；KSM integrity 只看了"代码有几条分支"没跑可达性；TC integrity 给的修正没被物化。这条比 §7 修订 1-4 还要严重。

3. **"acceptance specs 通过"≠"功能正确"** —— KSM 的 `asp_market_key_rules` 通过了但 5/11 死代码；CC 的 `asp_interaction` 通过了但实时订阅未实现；TC 的 `ac_trend_adapter_exports` 通过了但实际 UI 又做了一半。Acceptance specs 的颗粒度是"接口/导出/文件存在"，**无法替代功能保真**。

4. **新增 P0 整改**（追加到 §8 清单）：
   - **P0-10**: integrity_attempt 必须强制存在，task 跳过 integrity 直接 deliver 应触发 hard fatal——CC 是这条的最大反例。
   - **P0-11**: acceptance spec 必须包含**数据流可达性测试**（如 KSM 的市场路由 11 条规则需要 11 条测试覆盖每条 return 都被命中），不能只验"分支存在"。
   - **P0-12**: 当文件系统出现 goal contract 未声明的新增改动时，integrity 二审必须重新评估 goal scope；不能让 executor "私自" 超出 contract 而无人识别（TC 反例）。

5. **Codex 二轮独立挖出 / 我漏掉的更本质问题——三个组件都有 Mock fallback，违反 rule 7（禁止 fallback）**：
   - KSM `KeyStatisticsMTts.api.ts:226`：`if (!DA) return KeyStatisticsDataAccessorMock; return KeyStatisticsDataAccessorMock.requestData(...)`
   - CC：hooks 含 `useMock` 路径，`generateMockCandleData` 兜底
   - TC `TrendChart.tsx:106`：`const mode = isElectron ? 'real' : 'mock'`；`useTrendData.ts` import `fetchTrendDataMock / subscribeTrendMock`
   - 这比单个功能漏实现更本质：**生产环境跑起来后，DA 不可用就静默走 Mock**，用户/QA 看不出来；rule 7 明确禁止这种掩盖问题的 fallback；acceptance spec 在"分支级"验过没揪出来。这是 rule 7 的系统性违反，需要 **P0-13**：禁止生产组件含 Mock 兜底分支，Mock 必须只在 dev preview 入口注入。

| AGENTS.md 规则                         | 本次复盘印证                                                                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rule 1（看见 bug 思考本质）            | TrendChart 最后那条 evidence 已经诊断出 `managed_preview_command` 配错，但回路仍在让 LLM 改根 vite 配置——这是没贯彻 rule 1                                     |
| rule 6.1（prompt-over-host-invariant） | host gate 把"环境失败"和"组件失败"混在同一 retry 回路，是错配。环境配错应靠 host manifest 修正（数据完整性范畴），不靠 LLM build retry                         |
| rule 7（禁止 fallback）                | deliver-fail→build-fix 的循环是 fallback 累积的活样本                                                                                                          |
| rule 8（禁止双源）                     | TrendChart integrity 修正缩减 goal claim 但 executor 全量执行，是双源                                                                                          |
| rule 20（禁止"最简单的修复"）          | 每一次 deliver-fail 修 host 的 LLM 行为都是最简单修复                                                                                                          |
| rule 28b（敢于宣告失败）               | CandlestickChart 的 task.error 是优秀范例；TrendChart 的 cancel 路径欠这条                                                                                     |
| rule 30（并行 SubAgent）               | ~~KeyStatisticsMT 的 5-goal 串行违反~~ —— **修订后撤回**：DAG 由 architect 设计为串行，scheduler 已按 DAG 执行；要修就修 architect 让它给出更宽的 DAG（§8 #7） |
| rule 35（穷举调用点 / 不要单点采样）   | 本文档自己第一版犯了——`KSM 可并行`只看了 `owned_paths` 没看 `depends_on`；`TC 19:33 后静默`只看了非 stream event 没看 part 表                                  |
| rule 28b（敢于宣告失败）               | CC 的 `task.error` 是优秀范例；KSM 是反例（`acceptance_review_threw` 被悄悄翻成 cancelled）；TC 也是反例（cancel 吞诊断）                                      |
| rule 28c（无）                         | 当前规则集**缺失**一条"用户输入是真实硬阻塞"——CC/TC 的 5min auto-reject 直接撞这个缺口；建议补 rule 28c                                                        |
