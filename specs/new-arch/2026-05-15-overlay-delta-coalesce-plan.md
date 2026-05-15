# Overlay Delta Coalesce — 流式卡顿根因二阶修复

> Date: 2026-05-15
> Status: implementation plan
> 复核: 三并行调查 agent + codex review（结论"部分成立"，见 §1）

## 0 · Recall

- `specs/new-arch/07-panel-reactivity.md`：流式路径每帧必须 <16ms，禁止每个 SSE
  delta 触发宽范围重算。
- `specs/new-arch/2026-05-14-overlay-refresh-single-source-plan.md`：live delta
  必须从 `cardTreeStore` 渲染，不走 board refresh。
- `specs/new-arch/2026-05-15-overlay-streaming-text-main-thread-plan.md`：已落地
  （commit `dd1d19697`），消除了每 delta 全量 markdown 化、rAF 可见性、观察者
  风暴、rail 读正文。本方案是其**二阶修复**——上一阶把开销搬了位置，未根治频率。

## 1 · 根因（codex 复核：部分成立）

成立项：

- **SSE 链路零合并**：`services/sse.ts:80-99` 每条 `JSON.parse` 后立即
  `routeSSEEvent`；`services/events.ts:507-527` 对 message 直接 `writeToTree`；
  `services/tree-writer.ts:193 applyEvent` 是**唯一**变更入口，`:200` 把
  `message.part.delta` 路由到 `applyVisibleCardTreeEvent(() => handlePartDelta)`
  （`:183-188` 仅单事件 `batch()` + `markCardTreeVisibleChanged()`）。
  token 级 delta 全程无帧级合并。
- **scroll 每帧强制 layout**：`Conversation.tsx:109-115` `on(visibleVersion,
  …,{defer:true})`（defer 非节流）→ `utils/dom-utils.ts:122-134`
  `scheduleFollowScroll` 仅 `rafPending` 合到每帧一次，帧内仍读 `scrollHeight`
  写 `scrollTop`；`.chat-scroll`（`styles/.../conversation.css:8-24`）只有
  flex/overflow，**无 CSS containment 隔离 reflow**。
- **TextPart 每 delta 全文重扫**：`components/TextPart.tsx:56-81` 每次
  `props.text` 变化跑 `splitBlocks(全文)`（`:17-47` `text.split("\n")` 全量
  扫描）；`frozenSources`（:53,:66-78）只缓存已冻结块 HTML，挡不住重 split 全文。

被 codex 纠正（不成立）：

- workflow rail **不是**正文 delta 热点。`ConversationAgentRail.tsx:179-184`
  → `agent-workflow.ts:257-304 buildAgentWorkflow` 只读
  `kind/stage/status/time/childIDs` 元数据；delta 写 `parts[idx].text/raw`
  （`tree-writer.ts:548-554`）。Solid store 细粒度下正文 delta 不触发 rail
  重算。**本方案不动 rail。**

codex 补充遗漏热路径（coalesce 后频率自然降，本方案不单独改，验证即可）：

- `Board.tsx:628-636 requirementsMessages` memo → `orderedReachableCardIDs`
  （全树遍历）+ `cardToMessageSegments` → `RequirementsPanel` 的 `CardParts`。
- `InlineToolPart.tsx:155-195,239-246` raw/output/code 计算（工具流热点）。

## 2 · 已存在的双源（rule 8，标记不在本次范围）

`store/messages.ts:632-689` 是一套 **legacy 独立 message store**，自带
`enqueueEvent`/`flushEvents`/`coalesceDeltas`（50ms batch + 同
messageID/partID/field 合并），写 `messages`/`messagesBySession`。活的对话 UI
单一来源是 `cardTreeStore`（`2026-05-14` plan 已确立），该 legacy store 的
coalesce **未接入活路径**。

裁决：

- 本方案**不删** legacy store（rule 5 不过度扩张 / rule 17 删死代码须先问
  用户）。**待用户确认**：`store/messages.ts` 是否已全死、可整体移除（单列后续）。
- 但其 `coalesceDeltas` 谓词（同 `messageID`+`partID`+`field` 的连续
  `message.part.delta` 合并 `delta` 字符串）是**已验证的合并范式**。新实现
  **复用同一谓词形状**（rule 9 禁重造），落在活路径单一入口，不再平行造轮子。

## 3 · 修复（单一来源，最小改面）

### 3.1 主修复：tree-writer 单入口帧级 coalesce（根治频率）

落点：`services/tree-writer.ts` 的 `applyEvent`（:193，单一变更入口）。

- 新增模块内 delta 缓冲：`Map<key, { event, delta }>`，`key =
  sessionID|partID|field`，保持首次出现顺序（用数组记顺序或 Map 插入序）。
- `applyEvent` 收到 `message.part.delta`：不立即 apply，把 `delta` 字符串
  累加进缓冲对应 key（谓词形状对齐 `store/messages.ts:650 coalesceDeltas`）。
  调度一个 rAF（已挂起则复用，单帧一次）。
- rAF flush：`batch(() => { 按顺序对每个 buffered key 调
  handlePartDelta(合并后的 event); markCardTreeVisibleChanged(); })`，清空缓冲、
  清 rAF 句柄。`markCardTreeVisibleChanged()` 每帧仅 bump 一次 → scroll effect
  随之降频（同一处单源解决 scroll）。
- **顺序正确性（关键）**：`applyEvent` 收到**任何非 `message.part.delta`**
  事件前，**同步 flush** 当前缓冲（否则 `message.part.updated` / `session.status`
  终止 / tool result 会读到旧文本）。`resetWriter()`（:163，task 切换/测试）
  也必须同步 flush + 清缓冲 + cancel rAF。
- rAF flush 内单条 `handlePartDelta` 失败不得吞掉其余（保持 rule 1
  let-it-crash 语义：仍抛，但先 flush 已处理项 / 或按现状直接抛——与现有
  `applyEvent` 抛错行为一致，不引入 fallback）。

不变量：`handlePartDelta`（:518-558）本身不改（raw/tool 分支、累加语义不动）；
合并只发生在调用它之前的入口缓冲层。`applyVisibleCardTreeEvent` 的
`batch+markCardTreeVisibleChanged` 语义保留，只是改为每帧一次而非每 delta 一次。

### 3.2 次修复：TextPart 增量分块（去 O(全文) 重扫）

`components/TextPart.tsx`：缓存 `lastText` + 已切分的 frozen 块及其在文本中的
结束偏移 + fence 开闭状态。`props.text` 变化时若新文本以 `lastText` 为前缀
（流式追加恒成立），只对**新增 tail** 继续 `splitBlocks` 扫描，复用已冻结块；
否则（非前缀，task 切换/重写）整体重算。fence 跨 chunk 开闭状态必须随增量
正确延续（已开 fence 的 tail 续扫）。`frozenHtml` 缓存语义不变。

### 3.3 次修复：scroll reflow 隔离

`styles/surfaces/conversation.css` `.chat-scroll`（:8-24）加
`contain: layout`（或 `content`，取其不破坏 sticky/锚定的最弱档；实施时按
现有 sticky/`--card-sticky-inline-size` 验证不回归）。目的：把
`scrollHeight` 读触发的 reflow 限制在滚动容器子树，不波及全文档。

## 4 · 调用点穷举（rule 35）

| 符号 / 路径 | 调用点 | 本方案处置 |
|---|---|---|
| `applyEvent` | `tree-writer.ts:193` 定义；`services/events.ts` `writeToTree`、`services/chat.ts:26` 导入 | 仅在此入口加 coalesce 缓冲 + flush；调用方不改 |
| `applyVisibleCardTreeEvent` | `tree-writer.ts:183` 定义，:198/:199/:200 三处调用（updated/part.updated/part.delta） | 语义保留；delta 路径改为经缓冲后每帧调一次 |
| `handlePartDelta` | `tree-writer.ts:518` 定义，仅 `:200` 调用 | **不改**，仅改其上游触发时机 |
| `markCardTreeVisibleChanged` | `store/card-tree.ts:256` 定义；`tree-writer.ts:180/186/1454`、`store/card-tree.ts:299/308` | delta 路径改每帧一次；其余（reset/rebuilder/order）不动 |
| `visibleVersion` 消费者 | 仅 `Conversation.tsx:110`（scroll） | 不改消费侧；bump 降频后自动受益 |
| `splitBlocks` | 仅 `components/TextPart.tsx:17`（同文件 :59 调用） | 改为增量 |
| `coalesceDeltas` / `enqueueEvent` / `flushEvents` | 仅 `store/messages.ts`（legacy store 内部，:680 自调） | **不改不删**；新实现复用其谓词形状，§2 标记后续 |
| `.chat-scroll` | `conversation.css` 定义；`Conversation.tsx` 使用 | 加 containment |
| `resetWriter` | `tree-writer.ts:163`，task 切换/测试调用 | 增加 flush+清缓冲+cancel rAF |

无遗漏调用点引入新双源。

## 5 · 测试矩阵（rule 28/36，行为级，非字符串断言）

新增 `packages/overlay/test/delta-coalesce.test.ts`（驱动 `applyEvent`，
fake rAF / flush 钩子）：

| 场景 | 断言 |
|---|---|
| 同 session/part/field 连发 N 条 delta，一帧内 | `handlePartDelta` 实际写树仅 1 次（spy `setCardTreeStore` 调用合并）；最终 text = N 段拼接；`visibleVersion` 仅 +1 |
| delta…delta 后来一条 `message.part.updated` | flush 同步先行：updated 处理时树已含累计 delta（顺序正确性） |
| delta 后 `session.status` 终止 | 终止前 flush，终止时文本完整 |
| `resetWriter()` 在缓冲非空时 | 缓冲清空、无 rAF 泄漏、reset 后不再 flush 旧 delta |
| 不同 part 交错 delta | 各自 key 独立累计，顺序保持 |
| raw/tool field delta | 合并后仍走 `state.raw` 累加分支，值正确 |

`packages/overlay/test/streaming-text-render.test.ts` 升级为**行为级**（替换
原纯字符串 `toContain`，rule 28 防回归脆弱）：挂载 `TextPart`，spy
`renderMarkdown`：

| 场景 | 断言 |
|---|---|
| streaming 中追加 M 个 delta | active 块为文本节点（无 `<p>`/`hljs`）；`renderMarkdown` 调用次数 = 已冻结块数，不随 delta 线性增长 |
| 增量 split：长文本流式追加 | 已冻结块对象/HTML 引用稳定（未因 tail 增长被整体重建） |
| 未闭合 fence 跨多 delta | 不误判块边界；streaming=false 后整体 markdown 一次 |
| 非前缀变化（task 切换文本） | 整体重算路径正确 |

`packages/overlay/test/conversation-agent-rail.test.ts` 现有回归（rail 不读
正文）保留，确认本方案未触碰 rail。

## 6 · Validation

- 新增 + 升级测试全绿。
- 现有 tree-writer / auto-scroll / streaming 测试不回归。
- overlay typecheck 通过。
- 视觉验收（rule 25，非 headless）：真实流式长回答，确认卡片无空白、指针/
  滚动/计时器不停摆；coalesce 后 `requirementsMessages` / `InlineToolPart`
  频率随之降，肉眼确认 requirements 阶段流式不卡。
- pre-push 质量门（typecheck / api:routes-check / docs:check）通过后
  commit + push，不绕 hook（rule 33）。

## 7 · 待用户确认的后续项（不在本次范围）

- `store/messages.ts` legacy message store 是否已全死、可整体删除（rule 8
  双源彻底收敛）。需单独穷举其消费者后再决策。
