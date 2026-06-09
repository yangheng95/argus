# 2026-04-30: LLM Activity 统一抽象 — 单一来源 / 可终结的流式生命周期

> 已经过 codex review（v1 → v2 修订点见文末"Review 收口"）。本版为最终落地稿。

## 触发事故

| Task                                | 现象                                                      | 真因                                                                                                                                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsk_ddc529dfd0011ajJTgBqdlroyk` G3 | board 显示"运行 28 分钟无更新"                            | provider 持续返回 HTTP 429（usage allocated quota exceeded），底层每 30s 退避一次重试 24+ 次，没有 totalMs 上限、没有重试上限、没有 fail-fast 路径                                                                                                                |
| `tsk_ddc529dfd0011ajJTgBqdlroyk` G4 | board 显示"运行 18 分钟无更新"                            | TLS 流式错误 `unknown certificate verification error` 后 session 5s 内连发 `idle / status=aborted / status=completed` 三条互相冲突的 terminal 事件；`engine_artifact kind=goal_run_attempt` 没有写入对应的 `attempt-completed/failed`，attempt 永远停在 `running` |
| `tsk_ddc67008f001pRQAXurqfkwPtT`    | architect 之后短暂有 6 个 0ms 寿命的 orchestrator session | TLS 错触发 5 次重试，每次起一个新 orchestrator session（重试粒度 = session 级而不是 activity 级）                                                                                                                                                                 |

**共性**：每一处都是因为 LLM 网络/流式调用层缺一个**单一来源、可终结的活动单元**。`util/stream-activity.ts` 已经把"物理活性探针"做对了（idle gate + pause/resume + abortableIterable + winner cause via DOMException reason），但**没有人**在它之上提供重试调度、错误分类、终态事件、状态机收口——这一层是本次新增。

## 抽象边界

> **`LLMActivity`** = 从"我决定调用 provider"到"我拿到 final outcome"之间的全部网络/流式生命周期，包含其内部的所有自动重试、心跳监测、错误分类、退避。

- 一个 activity 终态后**只有一条 terminal 事件**，下游所有状态机（session.bridge、goal_run_attempt、board watchdog、orchestrator）都订阅这条事件。
- activity 内部的 retry 不外泄成"新建 session"或"新 attempt"——重试是 activity 自己的事。
- 调用方不再写 `try { stream() } catch { setTimeout(retry) }`——调用方只 await runner 的 final 结果。

`LLMActivity` **复用** `withStreamActivity` 做底层心跳门（idle + pause + abortableIterable），自己只负责加：firstByteMs、totalMs、retry 调度、错误分类、terminal 事件、artifact 落盘。

## 错误分类（按优先级，互斥）

429 永远是 transient（用户事故复盘已确认）；不存在永久 quota 类。下面**按优先级**取第一条匹配的；上层错误（external abort / total timeout）压制下层。

```ts
export type ErrorClass =
  // 优先级最高，非重试 ──────────────────────────────────────────
  | "external_abort" // 外部 AbortSignal 触发；下游必须翻译成 aborted（非 failed）
  | "total_timeout" // 整个 activity 跨重试累计超出 totalMs；非重试
  // 单独成类，可重试（默认） ───────────────────────────────────
  | "first_byte" // 请求发出后 firstByteMs 内未收到第一帧
  | "idle" // 第一帧后帧间静默 > idleMs
  | "rate_limit" // HTTP 429（永远 transient）
  | "tls" // 证书 / handshake / SNI / SSL
  | "network" // ECONNRESET / ETIMEDOUT / DNS / fetch failed
  | "server_5xx" // 500 / 502 / 503 / 504
  | "stream_protocol" // SSE 帧坏 / JSON 半截 / tool_use 块缺失
  // 客户端语义错误，非重试 ─────────────────────────────────────
  | "client_4xx" // 一般 4xx（除下面单列）
  | "request_timeout" // 408 — 单列；与 idle 区分（408 是上游主动超时，idle 是我方水位）
  | "payload_too_large" // 413 — context overflow 也归这里
  | "context_overflow" // 模型 context window 溢出（provider 报 invalid_request_error → 由 classify 识别 token / context 关键字升格为此类）
  | "unknown"
```

**重试性矩阵**（默认 policy；可被 callsite 覆盖）：

| Class                                                                                                | 重试 | 备注                                           |
| ---------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------- |
| `external_abort`                                                                                     | 否   | 走 aborted 终态                                |
| `total_timeout`                                                                                      | 否   | 走 failed 终态                                 |
| `client_4xx`                                                                                         | 否   | prompt / auth bug，再试无意义                  |
| `request_timeout`                                                                                    | 否   | 408 表明上游已放弃；让 orchestrator 决定下一步 |
| `payload_too_large` / `context_overflow`                                                             | 否   | 必须缩 prompt，调用方需要 backstop             |
| 其它（含 `rate_limit / tls / idle / first_byte / network / server_5xx / stream_protocol / unknown`） | 是   | maxRetries[cls] + totalMs 兜底                 |

## 策略对象

```ts
export interface LLMActivityPolicy {
  /** 起到终态的硬上限（含重试期间的所有 sleep）。
   *  此 deadline 同时绑定到 race signal，attempt 与 backoff 都会被它中断。 */
  totalMs: number // default 30 * 60_000

  /** 帧间静默上限。仅在第一帧到达后启动；每个 chunk / bump() reset。 */
  idleMs: number // default 180_000

  /** 请求发出 → 第一帧之间的水位。第一帧到达后，转交 idle 计时器。
   *  firstByteMs 和 idleMs 覆盖不同阶段，允许 firstByteMs 小于 idleMs。 */
  firstByteMs: number // default 60_000

  /** 各 ErrorClass 的最大重试次数（首次不计）。可重试类通过这里限流；
   *  非重试类配置忽略。 */
  maxRetries: Partial<Record<ErrorClass, number>> & { default: number }
  // 推荐：{ default: 5, rate_limit: 15 }
  // 解释：429 单列拉到 15，靠 totalMs (30 min) 兜底；不再无限退避。

  classify(err: unknown, ctx: { httpStatus?: number; bodyHead?: string; abortReason?: unknown }): ErrorClass
  shouldRetry(cls: ErrorClass, attempt: number, totalElapsedMs: number, remainingTotalMs: number): boolean
  /** backoff 必须保证 ≤ remainingTotalMs，否则提前进入 total_timeout。 */
  backoffMs(cls: ErrorClass, attempt: number, remainingTotalMs: number): number
}
```

默认 `classify` 按上述优先级实现：先看 abortReason 是否是外部 signal（external_abort），再看 deadline signal（total_timeout），再看 stream-activity gate trip（idle / first_byte），再看 HTTP/网络/协议错误。

默认 `shouldRetry`：

```ts
shouldRetry(cls, attempt, totalElapsedMs, remainingTotalMs) {
  if (cls === "external_abort" || cls === "total_timeout") return false
  if (cls === "client_4xx" || cls === "request_timeout") return false
  if (cls === "payload_too_large" || cls === "context_overflow") return false
  const cap = policy.maxRetries[cls] ?? policy.maxRetries.default
  if (attempt >= cap) return false
  if (remainingTotalMs <= 0) return false
  return true
}
```

默认 `backoffMs`：

```ts
backoffMs(cls, attempt, remainingTotalMs) {
  const baseByCls = {
    rate_limit:      5_000,    // 429 退得稍狠 + jitter
    tls:             1_000,
    network:         1_000,
    server_5xx:      2_000,
    stream_protocol: 1_500,
    idle:            1_000,
    first_byte:      1_000,
    unknown:         2_000,
  } as const
  const capByCls = { rate_limit: 60_000 } as const
  const ms = Math.min(capByCls[cls as keyof typeof capByCls] ?? 30_000, baseByCls[cls as keyof typeof baseByCls] * 2 ** attempt)
  const jittered = ms + Math.random() * Math.min(1000, ms * 0.2)
  // 截断到 remaining，避免 sleep 跨过 deadline
  return Math.min(jittered, Math.max(0, remainingTotalMs))
}
```

## 事件协议（单一真理）

```ts
export type LLMActivityEvent =
  | { type: "started"; id: string; ts: number; sessionID: string; goalRunID?: string; provider: string; model: string }
  | { type: "heartbeat"; id: string; ts: number; kind: HeartbeatKind }
  | { type: "paused"; id: string; ts: number; reason: string }
  | { type: "resumed"; id: string; ts: number; reason: string }
  | { type: "retry"; id: string; ts: number; attempt: number; cls: ErrorClass; backoffMs: number; reason: string }
  | {
      type: "terminal"
      id: string
      ts: number
      outcome: "done" | "failed" | "aborted"
      cls?: ErrorClass
      error?: { name: string; message: string }
    }

export type HeartbeatKind =
  | "first-byte"
  | "text-delta"
  | "reasoning-delta"
  | "tool-input-start"
  | "tool-input-delta"
  | "tool-input-end"
  | "tool-call"
  | "tool-result"
  | "tool-error"
  | "step-start"
  | "step-finish"
  | "executor-progress"
  | "executor-usage"
  | "executor-diff"
  | "manual"
```

事件**强保证**：

1. 一个 activity id 全程恰好有 1 条 `started` 和 1 条 `terminal`。
2. retry 事件的 `attempt` 单调递增。
3. heartbeat 在 terminal 之后不再产生。
4. `paused` / `resumed` 必须配对；`resumed` 之前不会有 idle 或 first_byte trip。
5. terminal 三态互斥：
   - `done`：attempt 自然完成（return value 就绪）
   - `failed`：超出重试上限或命中非重试类 / total_timeout
   - `aborted`：external_abort（用户取消、上游 dispose、parent session 关闭）

## Runner 接口

```ts
export interface LLMActivityRun {
  /** 复合 signal: external | total deadline | first_byte | idle。winner cause 通过
   *  reason 字段区分（DOMException name + message tag），不要重写为新类型。 */
  signal: AbortSignal
  /** 调用方在每个真实事件上 bump，刷新 idle 水位。
   *  HeartbeatKind 必须由 provider adapter 完整覆盖：text/reasoning delta、
   *  tool-input-{start,delta,end}、tool-call、tool-result/error、step-{start,finish}、
   *  executor-{progress,usage,diff}。漏一种就是 idle 误判的根。 */
  bump: (kind: HeartbeatKind) => void
  /** 工具执行 / 用户交互期间挂起 idle 检测，等同 stream-activity.pause()。
   *  reason 仅用于事件落盘可读性，不参与控制流。可嵌套；resume 必须配对。 */
  pause: (reason: string) => void
  resume: (reason: string) => void
  /** 当前是第几次 attempt（首次=0）。 */
  attempt: number
}

export async function withLLMActivity<T>(
  ctx: { sessionID: string; goalRunID?: string; provider: string; model: string },
  policy: LLMActivityPolicy,
  external: AbortSignal,
  attemptFn: (run: LLMActivityRun) => Promise<T>,
  sink: (event: LLMActivityEvent) => void,
): Promise<T>
```

- `attemptFn` 抛错 → runner classify → shouldRetry → 决定 sleep+重试还是 terminal failed/aborted。
- 终态 `failed` 抛 `LLMActivityError`；终态 `aborted` 抛 `LLMActivityAbortedError`（继承同一基类，但 instanceof 可区分）；终态 `done` return attemptFn 结果。
- sink 是同步回调；调用方负责派发到 bus / artifact 写入。

### 四道闸的竞态约束

1. **每次 attempt 启动前**计算 `remainingTotalMs = policy.totalMs - elapsed`。如果 ≤ 0，直接 terminal `failed cls=total_timeout`，不发起 attempt。
2. **attempt 内** signal = `AbortSignal.any([external, totalDeadline, firstByteGate, idleGate])`。每个 controller 都用 `DOMException("...", "AbortError")` 作 reason，并在 message 里编码 cause（`"first-byte:...":` / `"idle:...":` / `"total:..."` / `"external"`）。
3. **backoff 期间**也 race 同一组 signal——sleep 必须是 `Promise.race([sleep(ms), abortPromise(externalOrTotal)])`，遇 external/total 立即跳出循环走 terminal。
4. **idle gate 仅在第一帧到达后启动**。runner 持有 `firstByteSeen=false`，第一次 `bump("first-byte" | "text-delta" | ...)` 翻转为 true 并启动 idle gate。在此之前只有 first_byte gate 在跑。

实现注意：runner 内不直接 `AbortSignal.any()` 后丢失 cause——而是用一个**winner-tracking** 包装，监听四个 controller 的 abort，第一条触发的把它的 reason 缓存到 `firstAbortReason`，由 classify 在 catch 块里读出，避免靠字符串匹配 reason.message 猜来源。

## 单一来源迁移（rule 8）— 已收口范围

| 现有写状态者                                                                            | 改为                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `util/stream-activity.ts` 的 idle gate / pause / resume                                 | **保留**，作为 LLMActivity 的内部组件之一（不删）                                                                                                                                                                                                                                |
| 各 agent 内部 `try { … } catch { retry }`                                               | **删除**，统一通过 `withLLMActivity` 包裹                                                                                                                                                                                                                                        |
| `session.bridge` 自己合成 `streaming/aborted/completed`                                 | **缩窄职责**：只负责 session lifecycle / overlay protocol 翻译。把 LLMActivityEvent → session.status 只翻译为 streaming / paused / retry，不再合成 terminal aborted+completed 双发；terminal 直接由 activity 终态写一条。                                                        |
| `engine_artifact kind=goal_run_attempt` 由 build agent step + finalizeBuildAttempt 推导 | **不变**：attempt-completed 仍由 build 领域结果（merge / commit / evidence）触发。LLM activity 只在**带 goalRunID 的 build-scoped 调用 failed/aborted**时，作为 build 的失败信号补一条 `attempt-failed` / `attempt-aborted`——activity terminal=done **不**写 attempt-completed。 |
| Board "stalled" 启发式（看 message 时间戳）                                             | **改用** activity `lastActivityAt` + attempt 状态。                                                                                                                                                                                                                              |
| 散落的 retry：architect / build / requirements / orchestrator 自旋                      | **删除**，由 runner 在更高层处理                                                                                                                                                                                                                                                 |

## 可观测性（不影响控制流）

每个 activity 终态后落 `engine_artifact kind="llm_activity"`：

```jsonc
{
  "id": "act_...",
  "sessionID": "ses_...",
  "goalRunID": "glr_...",      // 仅 build-scoped 调用有
  "provider": "alibaba-coding-plan-cn",
  "model": "glm-5",
  "outcome": "done" | "failed" | "aborted",
  "cls": "rate_limit" | ...,    // 仅 failed/aborted 有
  "attempts": 3,
  "totalMs": 47213,
  "firstByteMs": 1234,           // 实测，便于诊断
  "events": [...],               // 序列化的 LLMActivityEvent 数组
  "lastError": { "name": "...", "message": "..." }
}
```

## 实施分步（每步独立 commit + push）

1. **新增 `packages/opencorvus/src/llm/activity.ts`** + 完整测试矩阵：
   - 11 个 ErrorClass × {重试成功 / 重试到上限 / 命中 totalMs / 命中外部 abort}
   - first_byte gate 与 idle gate 的接力切换
   - backoff sleep 被 external/total 中断
   - winner cause 不丢
   - pause/resume 嵌套
   - heartbeat kind 全集
     当前调用方不变。
2. **改 `llm/api.ts` / `provider/*` 的所有流式调用**走 `withLLMActivity`；让 provider adapter 在所有 stream 帧上 bump 正确的 HeartbeatKind。删除分散的 retry 逻辑。
3. **改 `session.bridge`** 缩窄职责：只翻译 LLMActivityEvent，不再自合成 terminal aborted+completed 双发。
4. **改 build path**：把 build-scoped activity 的 failed/aborted terminal 同步成 `attempt-failed` / `attempt-aborted`（`attempt-completed` 路径**不**改）。
5. **删除散落 retry**：architect / build / requirements / orchestrator 内部 setTimeout-retry。
6. **删除 board** 看板的 message-timestamp stalled 启发式。
7. **回归**：`bun test packages/opencorvus`、`bun run typecheck`、`bun run api:routes-check`、`bun run docs:check`。

## 验收

- G3 同样的 quota-exceeded 流：429 至 maxRetries[rate_limit]=15 或 totalMs 30min 触底，terminal failed cls=rate_limit。**不再无限 retry。**
- G4 同样的 TLS 流：5 次重试 ~16s 后 terminal failed cls=tls；带 goalRunID 同步写 `attempt-failed`，**不再死锁 running**。
- 用户主动 cancel：terminal aborted cls=external_abort，不写 attempt-failed，不算重试触发。
- 三个旁路消失：
  - `terminal=aborted` + `terminal=completed` 同 activity 不再共存
  - 0ms 寿命的 orchestrator 重试 session 不再产生
  - board 看板不再依赖 message 时间戳猜状态

## Review 收口（v1 → v2 codex 修订）

| Codex 评审点               | v1 设计                                        | v2 修订                                                                                         |
| -------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 错误分类不互斥 / 不完整    | 9 类，靠字符串猜 idle 来源                     | 11 类按优先级，winner cause 走 controller reason，不靠 string match                             |
| 四道闸竞态                 | totalMs 仅在 shouldRetry 里查                  | totalMs 同时绑 race signal；backoff 按 remainingTotalMs 截断；idle 在第一帧后启动               |
| terminal 二态              | done/failed                                    | done/failed/**aborted**；external_abort 走 aborted                                              |
| heartbeat bump 范围        | 只列 chunk/tool-arg                            | 加 pause/resume + 14 种 HeartbeatKind 完整覆盖                                                  |
| 单一来源破坏 build attempt | 用 activity terminal=done 推 attempt-completed | activity 仅推 failed/aborted 到 attempt；completed 仍由 build 领域（merge/commit/evidence）触发 |

并加注：原 v1 误把 `util/stream-activity.ts` 列入"删除"——v2 改为**保留并复用**，新增的只是其上一层的重试/分类/终态调度。
