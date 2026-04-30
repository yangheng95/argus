# Deliver 缺陷系统分析与规则化改进方案

## 背景

任务 `tsk_ddf5509c2001uJB45nWR6TVVzf` 在 2026-04-30 18:20:23Z 被标记为 completed，交付目录为 `D:\myhexin-local\opencorvus_projects\chat`。本分析复核了任务数据库、Delivery 会话工具调用、交付项目源码、交付项目命令输出，以及当前主仓库中 deliver 相关实现。

缩写说明：

- LLM：Large Language Model，大语言模型，用于编排、实现和交付判定。
- SSE：Server-Sent Events，服务端向浏览器单向流式推送事件的协议。
- API：Application Programming Interface，应用程序接口。
- E2E：End-to-End，端到端测试，验证真实用户主流程。
- UI：User Interface，用户界面。
- DB：Database，数据库。
- CRUD：Create、Read、Update、Delete，增删查改。
- CI：Continuous Integration，持续集成质量门。

## 证据摘要

1. 任务最终证据宣称：`Build succeeds, all 176 tests pass across 26 files, TypeScript clean`，并且 `delivery_verdict=passed`。
2. 我复跑交付项目命令：
   - `npm run build`：通过。
   - `npm test`：通过，26 个 test file、176 个 test。
   - `npm run lint`：失败，49 个 error、38 个 warning。
3. Delivery 会话中实际运行过 `npm install`、`npm run build`、`npx vitest run`、`npx tsc --noEmit`、若干目标级命令、`npx next start -p 3099`、`curl`、`screenshot`，但没有运行 `npm run lint`。
4. Delivery 会话仍在 `submit_verdict` 中提交 `accepted`，并把 `Phase 1: Project-level sanity (build, test, lint)` 标记为 completed。
5. Architect integrity 阶段已经发现 5 个问题：API Key 传输契约不清、Goal 3 过大、多个 acceptance spec 可能空跑、Goal 1 用 `|| exit 0` 强制通过、路径 ownership overlap。但后续 deliver 没有把这些 concern 转成阻断条件。
6. `engine_requirement.status` 仍全部为 `pending`，但 task/run/goal 都被投影为 completed/passed。
7. 最终导出的 `delivery.patch` 为空，`delivery.export.changed_files=[]`，但实际仓库存在多次 goal commit 和 `delivery round 0` commit。

## 结论

当前 deliver 的根问题不是某个 chat 项目写得粗糙，而是 **accepted verdict 可以由 DeliveryAgent 自报成立，缺少可验证、可追溯、不可跳过的机械证据约束**。

换句话说，deliver 现在把“提示词要求模型跑 build/test/lint/验收 specs”当成质量门，但真正落库和发布时只校验 `submit_verdict` 的结构形状，而没有校验这些命令确实被运行、确实覆盖了应覆盖的规格、失败是否被阻断。

## 当前交付物缺陷

### P0：交付物不应被接受的缺陷

1. **Lint 失败却被交付为 accepted。**
   - 项目 `package.json` 定义了 `lint: eslint`。
   - Delivery 没有运行 `npm run lint`。
   - 复跑 `npm run lint` 失败，包含 `@typescript-eslint/no-explicit-any`、React Hooks lint、未使用变量、图片 alt 等问题。
   - 这直接推翻 `Phase 1 build/test/lint completed`。

2. **真实 chat 回复没有持久化。**
   - `ChatProvider.sendMessage` 先写入一个空 assistant message。
   - mock 和 real SSE 都只更新 `streamingContent` UI 临时状态。
   - 流结束后读取 IndexedDB 中的 messages，但空 assistant message 从未 `updateMessage`。
   - 用户看到的流式回复在 `streamingContent` 清空后会丢失，历史记录保留空 assistant 消息。

3. **会话删除不是完整删除。**
   - `deleteSession` 只删 localStorage 中的 session。
   - IndexedDB 中该 session 的 messages 没有级联删除。
   - 历史数据会残留，后续同 id 或诊断读取会出现幽灵消息。

4. **断点续传不成立。**
   - `resumeClaudeStream` 使用进程内 `conversationHistories` Map。
   - 刷新页面、server restart、serverless 实例切换都会丢失。
   - 前端 `useSSE` 没有接入 `resumeClaudeStream` 路由。
   - 用户要求“刷新页面后能继续获取 SSE 对话流”，当前只是单进程内存概念，不是用户可用能力。

5. **服务端 upload route 使用 `FileReader`。**
   - `src/app/api/upload/route.ts` 是 Next server route。
   - 服务端环境不应依赖浏览器 `FileReader`。
   - 测试通过是因为测试环境和 mock 掩盖了运行时差异。

6. **前后端会话存储双源。**
   - 前端 chat history 使用 localStorage + IndexedDB。
   - `/api/sessions` 使用服务端内存 `Map`。
   - 两套会话 CRUD 互不一致，违反单一来源原则。

7. **真实 Claude API 历史上下文不完整。**
   - `/api/chat` 只从当前 body 构造一条 user message。
   - 前端没有把历史 messages 发给后端。
   - `createClaudeStream` 的 history 只来自本次 request messages，不能代表真实会话历史。

### P1：交付质量弱点

1. mock Google 登录没有明显延时契约验证。
2. API Key 存在 localStorage 中，无明确风险提示和 server-side 传输契约。
3. E2E 测试主要是 React test environment，不是真浏览器用户流；没有 Playwright 或 puppeteer 验证登录、发消息、刷新恢复、删除、附件上传。
4. Delivery 截图只验证了未登录落地页，不验证登录后的 chat 主流程。
5. 端口占用时，Delivery 先启动失败，又切到 3099，但 `launch_command` 仍填 `npx next start -p 3000`，证据和交付说明不一致。

## 当前 deliver 系统缺陷

### P0：accepted 缺少机械证据硬约束

`submit_verdict` 只要求 `tool_call_evidence` 至少一个 passed，并要求 skill required tools 被覆盖；它不校验：

- build 是否运行。
- test 是否运行。
- lint 是否运行。
- typecheck 是否运行。
- package.json 中发现的脚本是否全部进入 evidence。
- acceptance specs 的每一条是否有对应 evidence。
- E2E 是否覆盖用户主流程。

这导致模型可以声明“lint completed”，即使没有任何 lint 工具调用。

### P0：已存在的 check discovery 没有成为发布门

`delivery/checks/discovery.ts` 可以发现 build/test/lint/typecheck 等命令，但 deliver 主路径没有把发现结果转成 accepted 必须满足的 manifest。Delivery prompt 要求模型“自己跑”，但发布路径没有按发现结果验账。

### P0：Architect integrity concerns 没有阻断或修正计划

Integrity review 已经输出 `verdict=concerns`，列出 5 个结构问题和 6 条 correction action。但系统继续创建 run，并最终 accepted。这个 concern 至少应该进入 plan 修正或 deliver 阻断，而不是只作为历史 artifact。

### P0：Requirement 状态与 task 完成状态脱钩

全部 `engine_requirement.status=pending`，但 task completed。当前状态投影没有要求 requirement 逐项被 evidence 覆盖，导致“需求未收敛但任务完成”。

### P0：Delivery 证据落库过薄

最终 `verification-evidence` 的 `checks` 为空或只包含 delivery verdict projection，缺少命令级证据：

- command。
- cwd。
- exit code。
- stdout/stderr 摘要。
- 所属 requirement / goal / acceptance spec。
- fresh 时间。
- 是否阻断。

没有这些字段，下游无法复核，也无法防止模型总结时夸大。

### P1：Phase 2.5 可被自报 skipped

任务有 5 个 goals，且有跨 goal contract，按 prompt 触发 Phase 2.5。但 verdict 里写“manual review performed instead”，系统接受了 skipped。对大任务来说，这绕过了并行深度复核规则。

### P1：任务最终导出 artifact 不可信

最终 `delivery.patch` 为空、`delivery.export.changed_files=[]`，但实际 git log 有多个实现 commit。这会让用户和 overlay 看不到真实变更，也让审计链断裂。

## 该有的机制

1. **DeliveryEvidenceManifest**：每次 deliver 必须生成一份结构化证据清单，单源记录所有必跑检查、实际运行结果、覆盖的 requirement / goal / acceptance spec。
2. **ProjectCheckGate**：从 `package.json` / `pyproject.toml` / task metadata 自动解析 build、test、lint、typecheck、verify_cmd，发现即必跑；失败即不能 accepted。
3. **AcceptanceCoverageGate**：每条 acceptance spec 都必须有 evidence。空跑、0 test matched、`|| exit 0`、纯 file-existence、self-grep 都是 failed evidence。
4. **RequirementCoverageGate**：每个 blocking requirement 必须至少被一个 accepted evidence 覆盖；否则 requirement remains pending，task 不能 completed。
5. **RuntimeFlowGate**：面向用户应用必须有真实运行流证据，不只 HTTP 200。该 chat 项目应至少覆盖 mock 登录、创建会话、发送消息、assistant 内容落库、刷新恢复、rename、delete、附件上传、API Key 设置。
6. **FreshnessGate**：证据必须来自当前 delivery run 或当前 rework iteration，不能引用旧 run 的自述。
7. **PublishGate**：Publisher 只接受 gate-passed 的 delivery manifest；LLM verdict 是解释层，不是唯一真相。

## 不该有的机制

1. 不该让 prompt-only 规则充当质量门。
2. 不该把 LLM 自报的 `deferred_checks` / `tool_call_evidence` 当成无条件可信。
3. 不该允许 accepted verdict 缺失 build/test/lint/typecheck 中任一已发现命令。
4. 不该允许 “manual review instead” 替代已触发的 Phase 2.5。
5. 不该有前端 localStorage + 服务端 Map 的双源会话设计。
6. 不该用 in-memory Map 声称刷新后 SSE 断点续传。
7. 不该在最终导出里出现 changed_files 为空但仓库实际有变更的情况。

## 改进方案

### P0-A：把 discovered checks 接入 accepted 硬门

修改点：

- `DeliveryService.verify` 在调用 DeliveryAgent 前解析 `discoverChecks()` 和 task metadata checks。
- 生成 `RequiredProjectCheck[]`，包含 name、family、command、cwd、required=true。
- 通过一个单一工具 `run_required_project_checks` 执行，不让 DeliveryAgent 自己临时拼命令。
- 结果写入 `DeliveryEvidenceManifest.project_checks`。
- `submit_verdict(accepted)` 必须引用一个 gate-passed manifest id。

验收：

- 对本 chat 项目，`npm run lint` 被自动发现并执行。
- lint 失败时，系统拒绝 accepted，即使 DeliveryAgent 提交 accepted。

### P0-B：Acceptance specs 覆盖验账

修改点：

- 将每个 goal 的 acceptance specs 规范化为 `AcceptanceCheckRequirement`。
- heuristic-shell scorer 必须运行；rubric / llm_judge scorer 必须有 read evidence 和 rationale evidence。
- 如果命令输出 `No tests found`、0 matched、或命令文本含强制 pass 模式，标记 failed。
- 禁止把 `test -f`、`ls`、`cat`、self-grep 作为 pass evidence；已有 forbiddenCheckReason 应升级为 manifest gate，而不是只在 prompt 中提示 LLM。

验收：

- Architect integrity 中提到的 `|| exit 0` 和 vacuous vitest 不可能进入 passed。
- 任一 blocking acceptance spec 没有 evidence 时，task 不能 completed。

### P0-C：Requirement 状态由 evidence 派生

修改点：

- 不再把 `engine_requirement.status=pending` 和 task completed 并存视作合法。
- 每条 requirement 关联 goal / acceptance evidence。
- blocking requirement 全部 covered 且 evidence passed，才允许 task completed。
- pending requirement 在 board 和 delivery verdict 中强制展示为阻断。

验收：

- 本任务若 chat history / SSE resume / upload / mock login 延迟任一未被真实 evidence 覆盖，task 不能 completed。

### P0-D：Publisher 只发布 gate-passed manifest

修改点：

- `Publisher.deliver` 输入必须包含 latest `DeliveryEvidenceManifest`。
- manifest 中存在 missing / failed required check 时，Publisher 返回 non-delivered。
- `delivery.patch` 和 `changed_files` 从 git baseline 到 current HEAD 计算，禁止空 artifact 覆盖真实变更。

验收：

- 本任务最终导出不能再出现 `delivery.patch=""` 且 `changed_files=[]`。

### P1-A：Phase 2.5 从 prompt 建议变成结构化要求

修改点：

- 根据 goals 数、rubric specs、cross-goal contracts 生成 `review_requirements`。
- 触发后，每个 required review 必须有 subagent evidence。
- 如果 DeliveryAgent 选择 skip，必须提交 not_applicable proof；否则 manifest failed。

验收：

- goals >= 3 的任务不能用 “manual review performed instead” 自行跳过。

### P1-B：真实用户流 smoke test

修改点：

- 对 web app 任务，生成 `RuntimeFlowSpec`。
- 对 chat 项目默认要求 puppeteer / Playwright 级别流程：
  1. 打开首页。
  2. mock Google 登录并验证延时和登录态。
  3. 创建新会话。
  4. 发送消息并等待 assistant 内容进入历史。
  5. 刷新页面后历史仍可见。
  6. rename title。
  7. 删除会话并验证消息清理。
  8. 上传图片 / 文档并验证 UI 和 API 响应。
  9. 设置 API Key 并验证请求携带 key。
- 结果写入 manifest，不再只靠 test suite 自己宣称。

验收：

- 当前交付物会在 assistant 内容落库、SSE resume、删除级联等处失败。

### P1-C：Delivery verdict schema 收紧

修改点：

- `tool_call_evidence` 改为引用 manifest check id，而不是自由文本。
- `deferred_checks` 中 failed 或 required skipped 必然阻断 accepted。
- `launch_command` 必须等于实际成功启动命令，不能填另一个端口或另一个命令。
- startup success 必须对应仍存活 server + HTTP probe + stderr 无 fatal error。

验收：

- `npx next start -p 3099` 成功时，不能把 `launch_command` 写成 `npx next start -p 3000`。

## 本 chat 交付物修复建议

如果要把当前 `D:\myhexin-local\opencorvus_projects\chat` 修到可交付，顺序应为：

1. 修复 lint，保持 `npm run lint`、`npm run build`、`npm test` 全绿。
2. 消除前后端 session 双源：选择一种单源。未发布 mock 项目建议先用 client-side storage 单源，删除未被前端使用的 `/api/sessions`，或彻底改成服务端单源；不能两者并存。
3. 修复 assistant 消息落库：流式结束时 `updateMessage(assistantMsgId, { content: fullContent })`，stop 时明确标记 partial 或删除空 assistant。
4. `deleteSession` 级联 `deleteMessages(sessionId)`，并补回归测试。
5. SSE resume 重新设计：用可持久化 run state 或 message cursor，不能用 process Map 声称刷新续传。
6. upload route 改用 `await file.arrayBuffer()`，删除服务端 `FileReader`。
7. real Claude request 携带完整历史和附件内容或明确声明附件只做 UI metadata；二者选一，禁止假装已支持多模态文档传输。
8. 写真浏览器 E2E 覆盖登录、聊天、历史、刷新、rename/delete、附件。

## 验收标准

系统级验收：

- 构造一个含 `lint` 脚本且 lint 失败的项目，DeliveryAgent 即使提交 accepted，Publisher 仍拒绝。
- 构造一个 `vitest run path-with-no-tests || exit 0` 的 acceptance spec，manifest 标记 failed。
- 构造 goals >= 3 的任务，Phase 2.5 无 subagent evidence 时 accepted 被拒。
- 查询任务 DB 时，`verification-evidence.checks` 能看到 build/test/lint/typecheck/acceptance/runtime flow 的结构化记录。

本任务回归验收：

- 复跑当前 chat 任务，不应得到 completed，至少应因为 lint failed、assistant history not persisted、SSE resume invalid 被 rejected。
- 修复交付物后，`npm run lint && npm run build && npm test` 全部通过，真实浏览器 E2E 通过，requirements 全部 covered，最终才可 publish。
