# OpenCorvus headless 并发卡死根因调查与 queue=false 修复报告

日期：2026-05-18  
范围：opencorvus headless server 并发 workflow 卡死调查；`CreateTaskInput.queue` 语义校准。  
交付状态：已改源码；未启动 7878 server；未跑 17 个真实任务。

## 0. 约束与方案 recall

改动前已读取落盘约束和历史方案：

- `AGENTS.md` -> `CLAUDE.md`：禁止 fallback/兜底、禁止状态机式掩盖、测试需定向、超时应按真实无活动判定。
- `specs/new-arch/2026-04-30-llm-activity-redesign.md`：LLMActivity 设计含 first-byte gate、idle gate、total deadline、终端事件持久化。
- `specs/new-arch/2026-05-13-task-queue-opt-in.md`：旧语义要求 `queue:false/omitted` 直接启动，`queue:true` 排队。
- `specs/new-arch/2026-05-14-directory-queue-hard-gate.md`：后续方案把所有新任务硬性送入目录队列，目的正是避免 17 个同目录 active 任务并发。
- `specs/new-arch/16-unified-teardown.md`、`2026-05-15-orchestrator-resume-ladder-plan.md`：当前 Orchestrator 单次 wake、队列/恢复/清理边界。

本次用户需求明确覆盖了 2026-05-14 hard-gate 方案：`queue=false` 必须绕过 directory queue 立即执行。因此代码按用户需求实现，但风险部分明确标注这会重新打开同目录并发入口。

## 1. DB 取证摘要

取证方式：对 `C:\Users\chuan\.local\share\opencorvus\opencorvus.db` 使用 `sqlite3 -readonly` 查询。未主动写入业务 DB；但在后续测试验证阶段发现测试 fixture 误用全局 DB 并执行了 `resetDatabase()`，导致当前 DB 已被清空。下面证据来自误触发测试前已采集的只读输出；误写事故与防护见第 6 节。

关键证据：

- 标题匹配“重写测试”的 17 个任务中，快照时 15 个为 active，2 个 cancelled，0 个 completed。
- 这 17 个任务共有 17 条 `engine_artifact.kind='orchestrator-stream-error'`。
- 17 条 stream error 的 `payload.reason` 均为：`MessageAbortedError: LLMActivity total deadline 3600000ms exceeded`。这证明线上实际 total deadline 是 60 分钟，不是设计文档/问题描述里的 30 分钟。
- `engine_artifact` 中有大量 `goal_run_attempt`：`attempt-running` 143、`attempt-completed` 128、`attempt-failed` 21、`attempt-aborted` 6；同一任务内可见 running tip 与后续 terminal attempt 混杂，符合外部 retry/resume 反复唤醒后追加 attempt 的形态。
- `protocol_event` 中 `session.status` 很多，其中包含大量 `retry`：TLS backoff、`server_5xx`，并有 `session.error` 记录 HTTP 502、外部 abort、LLMActivity total deadline。
- 没查到 `llm_activity` 类 artifact，说明活动 gate 的 terminal/retry 事实没有按设计持久化到 engine artifact，只能从 `protocol_event/session/message/part` 间接还原。

## 2. 失败模式清单

1. LLM total deadline 卡死模式  
   `packages/opencorvus/src/llm/activity.ts::DefaultLLMActivityPolicy` 当前是 `totalMs: 60 * 60_000`、`idleMs: 180_000`、`firstByteMs: 60_000`。DB 中所有 stream error 都是 3600000ms total timeout。该错误在 `session/processor.ts` 被转成 `Session.Event.Error` 和 `SessionStatus idle`，不是 task terminal。

2. first-byte / idle gate 模式  
   `withLLMActivity` 支持首字节和 idle gate；如果首字节超过 60s 或流 chunk 间隔超过 180s，会 abort。当前事故主因不是这两个 gate，而是 60min total；但它们仍是并发下的独立失败模式。

3. tool-call idle 暂停模式  
   `session/processor.ts` 在 tool-call 期间会暂停 idle gate，tool-result/tool-error 后恢复。长工具、子 session 或 executor 如果不产生可观测活动，父 LLM 流不会按 idle gate 终止，只会继续吃 total deadline。

4. provider transient / gateway 退避模式  
   DB 里有 TLS retry、`server_5xx` 和 hexin HTTP 502。`withLLMActivity` 内部 retry/backoff 会让单次 orchestrator wake 在 provider 抖动下持续很久；17 并发会放大 TLS/502 与上游限流。

5. Kimi/hexin 适配风险  
   `provider/hexin-profiles.ts` 对 `kimi-k2.6` 标记 `reasoning: true`、`interleaved.reasoning_content`、`output: 128_000`；`provider/transform.ts` 又对 hexin+kimi-k2.6 强制 request body `temperature: 1`。这不一定是本次 DB 中直接错误，但它使流很长、reasoning/tool 事件复杂，对 provider 协议兼容性和 stall 风险敏感。

6. orchestrator_stream_error 非终结模式  
   `orchestrator/agent.ts` 捕获 streamErrors 后只记录 `orchestrator-stream-error` artifact，并调用 `blockActiveRunForTask(... blockingReason: "orchestrator_stream_error")`。注释明确“不 fail task，不 auto-rewake”。这会让任务停在 active/blocked，等待下一次外部 wake。

7. stream-error fuse 窗口过窄  
   `engine/persist.ts::maybeTripOrchestratorStreamErrorFuse` 只处理短时间重复 stream error。当前错误是约 60 分钟一轮，天然绕过“3 次/短窗口” fuse，于是永不收敛。

8. executor / goal-run lease 清理缺口  
   `engine/runtime.ts::syncGoalRuns` 当前是空实现；per-goal 模式存在时，普通 `syncRun` 的 `RUN_STALL_MS` 单 run watchdog 不进入。goal_run attempt 可能保持 running/blocked tip，依赖 orchestrator 下一次 wake 解释和清理。

9. directory queue 饥饿  
   在 hard-gate 方案下，同目录 queued task 只有 active loop 退出才会 advance。若 leader active 卡在 orchestrator_stream_error/blocked 而不 terminal，后续 queued sibling 会长期饥饿。

10. directory queue bypass 并发争用  
    17 个同目录 workflow 同时 active 会共享 git/worktree、DB、provider、executor 和协议事件流；这会显著提高 provider stall、构建冲突、文件覆盖和 task.time.updated 停滞概率。2026-05-14 hard-gate 方案正是为阻止此模式。

11. retry/resume 反馈环  
    外部编排器 retry/resume 把 active/blocked 任务重新踢回可调度路径，但没有消除 provider stall、同目录争用、stream error 非终结这三个结构性原因；结果只是追加 attempt、再次等待 60 分钟 total timeout，继续耗预算。

12. agent report 空摘要模式  
    DB 中至少一个任务有 `agent report summary is empty`。`agent/report.ts::paragraphSummary` 对空 final text 抛错，`orchestrator/agent.ts` catch 后记录 task error，但不一定形成干净 terminal 收敛路径。

13. task_queue_service timeout 与 runtime timeout 不一致  
    `scheduler/task-queue-service.ts` 的 recover 使用 `time_updated` 判定 stale，符合“无活动后超时”的方向；但 `engine/runtime.ts` 外层 `Promise.race(syncRun, setTimeout(SYNC_RUN_TIMEOUT_MS))` 是从 syncRun 启动开始的 wall-clock timeout，不是无活动 timeout。它不是本次主因，但违反统一超时原则。

14. 可观测性缺口  
    LLMActivity terminal/retry 没有以 artifact 方式持久化，`task.time.updated` 又不是 LLM token/activity 心跳。因此 UI/外部编排看到“task.time.updated 长期不变”时，无法直接区分 provider 正在 retry、tool 正在跑、orchestrator blocked、还是真正 idle。

## 3. 根本原因

根因不是单个 `orchestrator_stream_error`，而是四个机制叠加后形成系统性不收敛：

1. 同目录 17 个 workflow 并发让 provider、git/worktree、executor 与 DB/protocol event 都进入高争用状态。  
2. hexin/kimi-k2.6 在长 reasoning/tool stream 下出现 TLS/5xx/backoff/stall 后，LLMActivity 实际要等 60 分钟 total deadline 才失败。  
3. Orchestrator 对 stream error 的处理是“记录 artifact + block active run”，不是 task terminal，也不 auto-rewake；短窗口 fuse 对 60min 间隔错误无效。  
4. 外部 retry/resume 没有降低并发或修复 provider/queue 结构，只是把任务再次唤醒，重复消耗 60min deadline 和预算。

因此 17 并发下系统不会自然收敛：失败不会快速 terminal，队列不会稳定推进，retry 不会改变失败条件，最终只能被预算 cancel。

## 4. 彻底解决方案优先级

P0：

- 对同一 cwd 的批量 workflow 默认使用 `queue:true`，或为每个任务分配独立 worktree。按本次需求 `queue:false` 已恢复直接并发能力，但它不适合 17 个同目录 C#->React 大任务。
- 增加 provider/model 维度并发阀，至少对 `hexin/kimi-k2.6` 限制同时活跃 orchestrator LLM streams。目录队列只解决 cwd 争用，不能解决 provider 争用。
- 让 LLMActivity 的 `totalMs`、`firstByteMs` 可配置，并将默认值与设计统一；当前 60min 与问题描述/文档的 30min 不一致。
- 将 LLMActivity terminal/retry 事实持久化为 artifact，包含 activity id、provider/model、gate、attempt、last activity、outcome。不要只靠 `session.status` 临时事件。
- 改造 orchestrator stream error 收敛策略：按任务/模型记录长窗口错误预算，例如同一任务 2 次 total timeout 或累计 N 分钟无有效进展后 terminal fail 或进入需要人工确认的 blocked 状态，不能无限 active。

P1：

- 实现 per-goal `syncGoalRuns` watchdog，用 goal_run 的真实 last activity 判断 running/blocked attempt 是否 stale，并做 terminal cleanup。
- tool-call 暂停 idle gate 时必须有嵌套 tool/executor heartbeat；长工具无活动也应触发明确错误。
- 对 provider transient 增加 circuit breaker：连续 TLS/502/total timeout 后暂停该 provider/model 的新任务调度，而不是让所有任务同时 retry。
- 为 `hexin/kimi-k2.6` 增加协议契约测试：`reasoning_content`、tool-call、temperature/body、长输出流、stream abort。

P2：

- UI/外部编排不要用 `task.time.updated` 代表 LLM 活动；应展示 LLMActivity last activity、provider retry、active run blocking_reason、goal_run tip。
- 给 `retryTask/resume` 增加结构性前置检查：如果上次失败是 provider total timeout 或 orchestrator_stream_error，resume 前要求降低并发、换模型或显式确认。

## 5. 任务 2：queue=false 语义修复

### 5.1 行为变化

| 场景 | 修改前 | 修改后 |
| --- | --- | --- |
| `queue` omitted/default false，cwd idle | 先创建 queued，再由目录队列认领 active | 创建时直接 active 并启动 loop |
| `queue:false`，同 cwd 已有 active task | 仍进入 directory queue | 直接 active，绕过 directory queue，与同 cwd active task 并发 |
| `queue:true` | 进入 directory queue，等待 cwd 空闲 | 不变 |
| operator message revival / retry queued path | 通过 queue coordinator，不绕过 active sibling | 不变 |

默认行为说明：schema 默认值仍是 `false`，但此前 hard-gate 代码把默认 false 解释成“目录空闲时启动”；现在默认 false 恢复为“立即启动并绕过 directory queue”。这对批量同目录 workflow 是重大行为变化。

### 5.2 修改文件与逻辑

- `packages/opencorvus/src/engine/pipeline.ts`
  - `persistQueuedTask` 增加 `queue: boolean`。
  - `queue=true`：保持 `time_started=null`、progress `created`、`TaskCreated(status="queued")`。
  - `queue=false`：创建时写 `time_started=now`、progress `active`、`TaskCreated(status="active")`，并额外发 `TaskUpdated(status="active")` 以保留“启动”事件。

- `packages/opencorvus/src/task-api/index.ts`
  - `EngineService.createTask` 将 `input.queue` 传给 `persistQueuedTask`。

- `packages/opencorvus/src/engine/model.ts`
  - 更新 `CreateTaskInput.queue` 注释，使 schema 文档与行为一致。

- `packages/opencorvus/src/engine/queue.ts`
  - 更新模块注释：directory queue 只保证 `queue=true` admission 串行；`queue=false` creation 明确可绕过。

- `packages/opencorvus/src/tool/panel.ts`
  - 面板确认文案从“空闲即启动”改为“立即启动”，说明会绕过目录队列。

- `packages/opencorvus/src/orchestrator/tools.ts`
  - `propose_task.queue` 描述改为 false 立即启动并绕过目录队列。

- `packages/opencorvus/src/gateway/decompose.ts`
  - `recommended_queue` 描述同步新语义。

- `packages/opencorvus/src/control/message.ts`
  - control-plane prompt 同步： omitted queue 会立即启动并绕过目录队列。

- `packages/opencorvus/test/engine/queue.test.ts`
  - 更新 `queue=false` 用例：active sibling 存在时也应直接 active；`queue=true` 仍 queued。

- `packages/opencorvus/test/gateway/e2e.test.ts`
  - 同目录第二任务等待用例改为显式 `queue:true`，避免用旧的 `queue:false` hard-gate 语义。

- `packages/opencorvus/test/gateway/tools.test.ts`
  - 更新测试注释。

### 5.3 测试工具链防护

发现 `packages/opencorvus/test/fixture/db.ts::resetDatabase()` 在未加载 package preload 时会删除 `Global.Path.data/opencorvus.db`，即真实用户 DB。已修复：

- `test-preload.ts`：root 级 bun test 现在设置临时 `OPENCORVUS_HOME`、XDG 路径、测试 home 和 managed config dir。
- `packages/opencorvus/test/preload.ts`：同步设置临时 `OPENCORVUS_HOME`。
- `packages/opencorvus/test/fixture/db.ts`：`resetDatabase()` 删除前校验 DB path 必须位于 `os.tmpdir()` 下，否则直接抛错。

### 5.4 风险

- 最大风险：`queue=false` 会重新允许同 cwd 多 active task，这与 2026-05-14 hard-gate 方案相反，也正是 17 并发事故的重要放大器。批量 rewrite 应使用 `queue:true` 或独立 worktree/provider concurrency limit。
- direct-start 任务创建时直接产生 `TaskCreated(active)` 和 `TaskUpdated(active)`；若某些消费者假定 task.created 必为 queued，需要同步消费逻辑。
- `queue_order` 仍为 direct-start task 写入，但 direct-start task 因 `time_started != null` 不会出现在 directory queue snapshot 中。

## 6. 验证结果与限制

已执行：

- `bun test packages/opencorvus/test/engine/queue.test.ts`：12 pass。
- `bun test packages/opencorvus/test/gateway/e2e.test.ts -t "queue=true second same-directory task stays queued"`：1 pass。
- `bun test packages/opencorvus/test/gateway/e2e.test.ts -t "create → message → cancel → delete"`：1 pass。
- `bun test packages/opencorvus/test/gateway/tools.test.ts`：4 pass。
- `bun run --cwd packages/opencorvus typecheck`：pass。
- `git diff --check`：pass。

限制：

- 整文件 `gateway/e2e.test.ts` 曾在 `POST /gateway/task/decompose...` 用例 60s timeout；该用例走 decompose/LLM 路径，与本次 queue 行为无关，未作为验收阻塞。
- 在发现并修复测试隔离前，运行定向测试触发了既有 `resetDatabase()` 工具链缺陷，真实 `opencorvus.db` 当前 `engine_task/message/part/protocol_event/engine_artifact` 均为 0。已立即停止对该 DB 的测试写入、检查未发现本地 `.db` 备份，并加了 root/package preload 与 reset guard。后续验证确认真实 DB `LastWriteTime` 未再变化。

## 7. 结论

任务 1 结论：17 并发不收敛的根因是同目录高并发 + hexin/kimi-k2.6 长流/provider transient + 60min LLMActivity total timeout + orchestrator_stream_error 非终结处理 + 外部 retry/resume 反馈环。单纯 retry/resume 无法解决，必须在 provider/model/cwd 并发、LLMActivity 持久化与 stream-error 收敛策略上修。

任务 2 结论：源码已按要求改为 `queue=false` 直接 active 启动并绕过 directory queue，`queue=true` 保持排队。该行为满足需求，但会重新引入同 cwd 并发风险；批量任务必须由调用侧显式 `queue:true` 或使用隔离 worktree/并发阀。
