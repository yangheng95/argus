# agent direct reply 500 — 修复方案

日期：2026-05-26
背景：用户反馈 overlay `AgentSessionReplyBox` 给任何子 agent 发消息均返回 HTTP 500。三方独立审查（claude general agents）交叉确认三层根因：

## 根因

1. **后端 runtime contract 硬卡 + 不可重建**（`069c22f80` 引入）
   - `appendDirectAgentSessionReply` 在 `task-api/index.ts:274` 调
     `validateSessionRuntimeContractForContinuation`，contract 是纯
     内存闭包（`session/loop.ts:122`），进程重启 / orchestrator wake
     finally 清掉后 / terminal collector satisfied 后均会缺失。
   - contract 内含 `toolKit.tools` / `getCollector` / `stream` 活闭包，
     无法从 DB 重建（spec §6 列了"重建"但落地需要重跑 runner.ts:700+
     的 toolKit 工厂，等价于 re-dispatch，不是注入式 reply 的语义）。
   - 影响 kind 交集 = `{architect, delivery, design-analyst, integrity,
     intent-analysis, requirements}`（DIRECT_REPLY ∩ requiresContract）。

2. **前端 reply box 显示条件未按 kind 过滤**
   - `overlay/src/components/Card.tsx:112-122` 和 `ChatBubble.tsx:176-`
     派生 `directAgentSessionID` 时只过滤 root session，不过滤 kind。
   - `tree-writer.ts:1547-1572` 给 build/coding phase 也写
     `phaseSessionID`，使这些卡片底部仍显示 reply box。
   - 用户在 build / 其他不可 reply kind 卡上点 reply → 后端
     `task-api/index.ts:179` 抛裸 Error → 500。

3. **错误分类塌缩**
   - 所有上述前置校验抛 plain `Error`，无 `NamedError` 子类。
   - `server/server.ts:97-100` 兜底全部映 500，前端无法区分
     "kind 不允许"（应 400/409）/ "contract 缺失"（应 409/410）/ 真 bug。

## 修复策略

不实施 spec §6 的 contract rebuild — 它对注入式 reply 语义不正确。
改为：**让前端真实反映后端能力**，结构性不可 reply 的 session 直接
不显示 reply box；后端用 NamedError 把所有可识别的拒收语义降级为
4xx，避免与真 5xx bug 混淆。

### 实施顺序（每步独立 commit + 配测试）

- **Step A — 错误分类（最小改动）**
  在 `orchestrator/direct-reply.ts` 加 `NamedError.create`：
  - `InvalidReplyTargetKindError`（kind 不在 DIRECT_REPLY_AGENT_KINDS）→ 400
  - `ReplyTargetEnvelopeMissingError`（session 还没有 user envelope）→ 409
  - `SessionRuntimeContractMissingError`（contract 不存在/已 satisfied）→ 410
  - `BuildSessionDirectReplyError`（build kind 硬拒）→ 400
  替换 `task-api/index.ts` 和 `session/loop.ts:174` 的裸 throw。
  在 `server.ts:onError` 按 name 加 status 分支。
  测试：每个错误类在 onError 后回对应 status；前端能读到结构化 name。

- **Step B — 前端真实能力反映**
  后端在 board/conversation event 输出里，对每个 session card 附加
  `canDirectReply: boolean` 字段（由 backend 用 `canReceiveDirectAgentReply(kind)
  && hasContract(sessionID) && hasUserEnvelope(sessionID)` 同源决定）。
  overlay `Card.tsx:112-122` / `ChatBubble.tsx:176-` 不再自己派生，
  改读后端字段。AgentSessionReplyBox 仅在 `canDirectReply === true` 时挂载。
  测试：build/coding phase 卡不再出现 reply box；contract 缺失的
  worker session 卡不再出现 reply box；evaluator/architect 在
  contract 存在时正常出现。

- **Step C — 错误码兜底兼容**
  即便 Step B 做了过滤，竞态（用户已打开输入框 → 同时 backend 重启）
  仍可能让 reply 撞上 410。AgentSessionReplyBox 收到 NamedError name
  时按规则展示对应文案：`SessionRuntimeContractMissingError` → 灰掉
  reply box + 提示"会话已无法继续，请重新派发任务"；
  `InvalidReplyTargetKindError` → 不应到达（前端应该早就不显示），
  log warn 并隐藏。

## 不做

- 不实施 spec §6 的 contract DB rebuild — 闭包不可恢复；
  rebuild 等价于 re-dispatch stage，不是 reply 语义，会产生
  双源（rule 8）。spec §6 这条本身需要重写或废弃。
- 不放宽 `validateSessionRuntimeContractForContinuation` —
  它在 loop.ts:1200 的 processTurn 内调用同样校验，pre-flight
  绕过只会把 500 推到下一个 tick。

## 验收

- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts` 通过
- `bun test packages/opencorvus/test/session/extra-tools.test.ts` 通过
- 新增：reply 错误分类测试、overlay reply box 显示条件测试
- 复现路径手测：
  - build phase 卡不显示 reply box
  - architect 卡运行中 reply 正常
  - 服务端重启后 architect 卡 reply box 消失或灰
