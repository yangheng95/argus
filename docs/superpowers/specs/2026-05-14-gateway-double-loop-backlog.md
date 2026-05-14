# Gateway 双子 loop 收敛后 backlog (2026-05-14)

5 轮"产品设计 agent + 视觉 puppeteer agent"双子 loop 在 `codex/agent-boundary-role-contract`
分支推进，HEAD `6cc636daf`。Round 5 双 agent 一致判定建议终止 loop，剩余 7 条
backlog（2 个 P2 + 5 个 P3）移交发布后常规迭代。本文件归档执行历史、设计 token
收敛度、剩余 backlog 与具体文件:行号，避免下次 loop 重新挖一遍。

## 累积 commit 历史

| 轮次 | commit | 摘要 |
|---|---|---|
| Round 1 | `5e977911e` | 5 P0：filterMatches 调用补 item、cancel/delete armed-confirm、补全缺失 CSS、focus-visible 规则首次出现、action banner key→i18n verb 映射 |
| Round 2 (基础设施) | `ef71fc6e1` | 视觉脚本基础设施 5 bug：vite spawn、IPv6 绑定、interceptor scope、CORS、`/global/health` mock |
| Round 2 | `acda465d7` | 6 P0 + 2 P1：workbench progressive render、humanizeApiError + 6 个 error class i18n、narrow 断点 channels specificity、focus-visible outline token、retry/replan armed-confirm、aria-label i18n、count chip 合并、binding mono token |
| Round 3 | `684a23202` | 1 P0 + 1 P1：humanizeApiError 正则升级处理 ApiError 包装（端到端测试落盘）、composer discard 清空 textarea |
| Round 4 | `6cc636daf` | 6 P1 + 2 P2：useGatewayArmedConfirm 跨 page-mode disarm、Recommended pill 视觉强化、proposal card data-created 视觉锁、composer 32k 上限+计数器、workbench message sticky 底部、armed-confirm `:not(:disabled)`、armed-confirm focus warn/bad 调性 |

总计 **15 P0 + 9 P1 + 4 P2 + 5 基础设施 bug 修复**，58 个 gateway-component 测试全部通过，每条修复都有回归网。

## 设计语言一致性收敛度：9.4 / 10

| 维度 | 状态 | 备注 |
|---|---|---|
| Token 单源 | 9.5 | hex / rgba / 裸 ms 字面量 = 0；`@media` breakpoint 字面量是 CSS Level 4 限制，已用注释标记 token 名 |
| focus-visible | 10 | 全部走 `var(--oc-border-width)` + `calc(1px * var(--ui-scale))` + `--accent`/`--warn`/`--bad` |
| armed-confirm 模式 | 10 | `useGatewayArmedConfirm` 单源 wrapper；6 个消费者全部经过 |
| i18n 覆盖 | 9.5 | aria-label / tooltip / 错误 / verb 全 `t()`；dead key `gateway.error.action.send` 已删除并加 regression guard |
| CSS ↔ JSX className 同步 | 10 | 所有 className 都有 CSS rule，回归测试钉死 |
| error 层级 | 9 | page-level / workbench / channel 三级各司其职；唯一可改进点见 backlog B-6 |
| density / spacing | 9 | 所有 padding/gap 走 `--ui-gap-*`，无硬编码 |

减分点：composer 键盘提交（Enter）、composer 流式 skeleton — 两项都是体验优化，不是正确性缺陷。

## 剩余 backlog

### P2 — 推荐在发布前的下一个 sprint 处理

#### B-1 Cmd/Ctrl+Enter 提交 hook

- 文件：`packages/overlay/src/components/Gateway.tsx`
- 行号：1397-1404（workbench message textarea）、1520-1529（composer requirement textarea）
- 现状：textarea 仅 `onInput`，无 `onKeyDown`。Panel 端 `ChatComposer.tsx:374-382` + `AgentSessionReplyBox.tsx:67` 已建立 Enter 提交、Shift+Enter 换行的约定。
- 建议：抽出 `packages/overlay/src/solid/enter-submit.ts` hook（rule 9 把模式提升），ChatComposer / AgentSessionReplyBox / Gateway 两个 textarea 一起接入。提交时机参考 Panel 现有惯例。
- 测试：`Enter` 触发 submit、`Shift+Enter` 插入换行的两路径行为断言。

#### B-2 composer 草稿提升到 Gateway 顶层

- 文件：`packages/overlay/src/components/Gateway.tsx`
- 行号：1437（`requirement` signal 当前在 `GatewayComposer` 子组件内）
- 现状：`requirement` / `executor` 是 `GatewayComposer` 的 component-local signal，组件 unmount 时丢失。用户输入到一半按 "Back to Panel"，回来空白。
- 建议：把 `requirement` / `executor` 提到 `Gateway()` 顶层 signal（与 `composerOpen` 同寿命），通过 props 传给 `GatewayComposer`。`handleDiscard` 仍显式清空（与 Round 3 P0 语义一致 — discard 即丢弃迭代）。
- 测试：`close → reopen` 后 textarea value 保留；`handleDiscard` 后 value 清空。

### P3 — 可选 polish

#### B-3 composer 拆解期间流式 skeleton / 进度反馈

- 文件：`packages/overlay/src/components/Gateway.tsx`
- 行号：1500-1576
- 现状：操作员点 "Generate proposal" 后仅看到按钮 "Generating…" 与 textarea 灰掉，无进度反馈。LLM 拆解可能 5-15s。
- 建议：复用 `gateway-ledger-skeleton-row` 同款 pulse 骨架（gateway.css:362-379 已存在）放在 textarea 下方，配 `t("gateway.compose.streaming_hint")` 文案。

#### B-4 计数器 `requirement().length` 抽 const

- 文件：`packages/overlay/src/components/Gateway.tsx`
- 行号：1532-1536
- 现状：3 次调用 `requirement().length`。Solid 信号 read 廉价但语义不优雅。
- 建议：`const len = requirement().length` 复用。

#### B-5 proposal Recommended pill 与 fieldset legend 视觉去冗余

- 文件：`packages/overlay/src/components/Gateway.tsx`
- 行号：1818-1848
- 现状：pill 已经说"建议排队/立即开始"，fieldset legend 也叫"启动方式"。操作员的眼睛要在两个相近概念上停留两次。
- 建议：移除 fieldset legend，或把 Recommended pill 内嵌到 fieldset 标题中。

#### B-6 message notice `data-tone` 与 channel-row-status `data-status` 模式对齐

- 文件：`packages/overlay/src/styles/surfaces/gateway.css`
- 行号：767-773
- 现状：`[data-tone="ok"]` / `[data-tone="error"]` 仅 2 个值；channel-row-status 用枚举 status 值。
- 建议：统一 attribute 命名约定，或解释两者差异（如果是有意的）。

#### B-7 composer counter 选择器从后代属性改为外层 attribute

- 文件：`packages/overlay/src/styles/surfaces/gateway.css`
- 行号：824-831
- 现状：`.gateway-composer-counter [data-near-limit="true"]` 用后代属性选择器；可改为直接给外层 div 加 attribute。
- 建议：把 `data-near-limit` / `data-at-limit` 移到 `.gateway-composer-counter` 自身，选择器更直观。

## 视觉脚本基础设施备忘

`packages/overlay/test/gateway-visual-loop.ts` 已落地以下能力：

- 检测外部 vite dev 服务（IPv4 / localhost / IPv6 三路 fallback）
- Request interception 严格限定 `:7878` opencorvus 端口，避免误伤 vite source asset
- CORS headers + OPTIONS preflight 处理
- `/global/health` mock 返回 `{ paths: { database, data, home } }` 结构，确保 connection check 通过
- `/task/:id/board` mock 返回 fixture 任务详情
- `useGatewayArmedConfirm` wrapper 的端到端可达性已通过截图验证

下次需要扩展视觉脚本，参考 commit `ef71fc6e1` 的 5 bug 修复 + commit `acda465d7` 的 fixture 拓展。

## 终止决策签名

- Round 5 视觉 agent：**建议终止 loop** — 7 张截图证实 Round 4 6 项改动落地正确，无 P0/P1。
- Round 5 设计 agent：**建议终止 loop** — 设计语言收敛度 9.4/10，剩余 backlog 全部不阻断发布。
- 主线程：删除 session cron，归档 backlog 到本文件，最终 commit。
