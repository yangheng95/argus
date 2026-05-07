# Overlay Image Ingestion + Build-Agent Visual Fidelity (2026-05-07)

## 现象

用户在 overlay 上传图片让 build agent 复刻一个 UI，**还原度 0**。表面看是 build agent 不参考图，根因是 overlay → opencorvus 的多条 ingress 中有两条把图片直接丢了，build agent 根本没拿到 attachment；另外 prompt 对"附件即视觉契约"的语言不够硬。

## 根因（按 ingress 路径分别核验）

### 路径 A — 新建任务首次发图（`panelMessage` → `createTask` → `POST /task`）

✓ 正常工作。`packages/overlay/src/services/task.ts:461` 把 dataURL 拆出 base64 →
`packages/opencorvus/src/task-api/index.ts:695-706` 走 `AttachmentStore.write` →
`persistQueuedTask`（`engine/pipeline.ts:101`）写入 `task.attachments`。

### 路径 B — 已有任务追加消息（`panelMessage` → `POST /task/{id}/message`）

✗ **bug**。`task-api/index.ts:1486-1534` `handleTaskMessage` 把 attachment 写进 `AttachmentStore`、塞进 session message、发 dispatch 时用 `attachmentSummary`（一行 url 文本），**但从来没调用 `appendTaskAttachment`**。`task.attachments` 还是任务创建那一刻的快照，build agent 从 `input.task.attachments` 读，永远看不到追加进来的图。

### 路径 C — 控制面 LLM `panel.create_task`（`POST /panel/message/stream` → `tool/panel.ts`）

✗ **bug**。`tool/panel.ts:65-115` 的 `create_task` 分支里：
- 行 81-89：仅 decode `isDecodableText(...)` 命中的附件，把内容 inline 进 request 文本
- 行 92-110：调 `EngineService.createTask`，**完全不传 `attachments` 字段**

图片附件在这一步直接消失。该路径目前在 overlay 内 grep 不到调用方（`submitMessage` 是 dead code），但 channel-runtime 里 14 个 IM channel 走 control-plane 都中招。

### 路径 D — Prompt 弱化

`build-core.txt:17-27` 与 `agent/prompt/build.txt:13` 已有"binding source of truth / 1:1 / do not simplify"语言，但都是**条件式**："If the prompt, visual contract, uploaded images, ... define a target". 模型可以判断"我没看出 reference"于是不当回事。

`build/agent.ts:2074` 与 :2104 的 user-prompt"Reference Fidelity"段落同样是 `If this goal depends on ...` 条件句。

`buildUserPartsFn`（agent.ts:422-441）在 `allMultimodal.length > 0` 时已经会拼 inline file parts + `renderStagedList` + `renderAttachmentInventory`——但**缺一个无条件的"本次 dispatch 这些图就是契约"的硬声明**。

## 修复

按 rule 8（禁止双源）+ rule 9（重复模式抽象）+ rule 36（每个改动配测试）。

### Fix B — `handleTaskMessage` 补 `appendTaskAttachment`

`packages/opencorvus/src/task-api/index.ts` `handleTaskMessage`（~行 1486）。在 `AttachmentStore.write` 之后、`continueTaskMessage` 之前，对每个 ref 调 `appendTaskAttachment(taskID, ref)`。`appendTaskAttachment` 已在同文件 829 行存在，sha 去重。

测试：`test/task-api/handle-task-message-attachment-persistence.test.ts` — `handleTaskMessage` 带 image 入参后，断言 `task.attachments` 增加该 ref。

### Fix C — `panel.create_task` 转发图片附件

`packages/opencorvus/src/tool/panel.ts:65-115`。在 `create_task` 分支把 `rawAttachments` 中**非文本**的附件，从 `{mime, url: dataUrl, filename}` 转成 `{mime, data: base64, filename}`，作为 `attachments` 参数传给 `EngineService.createTask`。文本附件的 inline-into-request 行为保留——它满足"text 类型的 PRD/spec 在 request 文本里 LLM 直接看到"的语义（不是双源，是不同语义出口）。

测试：`test/tool/panel-create-task-attachments.test.ts` — 当 `ctx.extra.attachments` 含 image，断言传入 `EngineService.createTask` 的 `attachments` 字段非空且形状为 `TaskAttachmentInput`。

### Fix D — Build user prompt 增加无条件视觉契约硬声明

`packages/opencorvus/src/build/agent.ts` `buildUserPartsFn`（行 422-441）。当 `allMultimodal.length > 0`，在 `enrichedText` 起首插入：

```
## Visual Reference Contract (binding for this dispatch)

The following file(s) are inlined above as multimodal parts AND staged on
disk. They are the authoritative visual target for this dispatch — restore
their pixels 1:1 within stack constraints. NOT inspiration; NOT optional.
Restoring something that "looks vaguely similar" is a verified failure.

- <filename1> (<mime>, <size>)
- <filename2> (...)

If you cannot read the pixels from the inlined part, fail the goal via
report_build_result with a concrete blocker — do not guess and proceed.
```

测试：`test/build-agent/visual-reference-prompt.test.ts` — 给 1 个 image attachment，断言生成的 user prompt 起首含 "Visual Reference Contract" 且列出 filename；attachment 为空时断言**不**含该段（避免误报）。

## 不做的

- 不改路径 A — 已经对的，按 rule 16 不留兼容代码（A/B 路径输入 schema 不同就不要硬合并）。
- 不改 `tool/panel.ts` 的"text 附件 inline 进 request"行为 — 那是不同语义出口（PRD 文字进任务正文 vs. 图像进 attachments），不是双源。
- 不抽 `AttachmentStore.write` 公共 helper — `task-api/index.ts:695-706` 与 `:1493-1502` 复用度只够 6 行，抽 helper 没收益（rule 5 一次原则不抽空抽象）。

## 验证序

按 memory `feedback_no_bun_test.md` + `feedback_batch_verify.md`：

1. 改完整批后跑 `bun run typecheck`
2. 跑指定测试文件 `bun test test/task-api/handle-task-message-attachment-persistence.test.ts test/tool/panel-create-task-attachments.test.ts test/build-agent/visual-reference-prompt.test.ts`
3. 不跑全套 `bun test`
