# 补充假设 — SSE replay × time fallback 禁止 = reconnect loop

## 证据再审
- CPU 5s 增量 7-8s → 单核 150% 满载（之前把累计 CPU 秒数 当成 % 读错）
- 内存 +300MB 稳定在 920MB（非泄漏型，一次性分配）
- 所有 HTTP timeout = event loop 被占死
- benchmark 用 `mkdtemp` 空历史，overlay 用 `ainvest2` 有完整历史（已跑 3 轮 benchmark 残留 events/sessions/messages）

## 假设机制（SSE replay loop）
1. UI 连 `/event` → server 从 `ProtocolStore` replay 全量历史事件 push 出去
2. 历史事件里有一条 `time=0 / undefined / malformed`（过去容忍 `Date.now()` fallback，今天 committed 的 invariant commits 改成 throw）
3. Overlay reducer / card factory `throw` → 某个外层 catch 关闭 SSE
4. `connection.ts` 的 monitor (10s interval) 或 reducer 自己的 reconnect 逻辑 → 重新订阅
5. server 再次 replay 同样 ~300MB → 同样 throw → 再 reconnect → ∞

## 今天的强化 time invariant commits
- `7c5ad6d7e` overlay(inv-ii-2): concrete time at every card construction
- `21848582a` overlay(reducer): stop registering AssistantCards at time=0
- `7afd889e4` overlay: pin TaskRequest first structurally; drop time-offset hack
- `0eaa9e84e` overlay(cards): lock time invariant — no more top-of-list build cards

## 验证路径（给 codex / review 用）
1. **UI network tab**：打开 DevTools Network，filter `/event`，看是否反复建立/断开（status 302→200 循环 or EventSource readyState 在 0/2 闪）
2. **profiler flame graph**：CPU top frame 如果是 `streamSSE / writeSSE / protocol replay / event.subscribe handler`，即验证
3. **reducer 异常**：UI console 应该刷屏 `throw Error: card time is 0` 或类似的不变量违反
4. **直接测试**：在 server side `/event` handler 里加临时 log 打印"connection opened / closed / replayed N events"，看是否频繁触发

## 根治方向（若假设成立）
**不是**把 time invariant 改回 fallback（违反规则 1/2），而是：
- 找出历史 events 里 time 不合法的**具体来源**（哪个 publish 路径没带 time / 带了 0）
- 在**源头 emit 时**补齐 time（`Date.now()` 在 emit 那一刻是合法的 ground truth，不是消费端 fallback）
- 如果是从 DB 读出来的 row，检查 DDL 里 time 列是否有 default，以及插入路径是否都设了
- 同步跑 reset DB + 重新生成一次 events，确认新数据都合法

## 风险
以上仍是**假设**，没有 flame graph / network 证据。codex task `bh2587eoh` 正在做证据性复现，等它结果出来用此假设交叉验证。规则 15：不抢在证据前下结论。
