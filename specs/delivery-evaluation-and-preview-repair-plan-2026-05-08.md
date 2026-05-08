# Delivery Evaluation 与 Preview 修复完整方案

日期：2026-05-08

## 术语

- Delivery：交付验收阶段，负责判断最终合并后的交付物是否满足任务要求。
- Preview：右侧预览面板，用真实浏览器 iframe 渲染本地前端页面。
- URL：Uniform Resource Locator，统一资源定位符，本文特指 `http://127.0.0.1:*`、`http://localhost:*` 或 `http://[::1]:*` 的本地页面地址。
- API：Application Programming Interface，应用程序接口，本文特指 Overlay 与 OpenCorvus 后端之间的 HTTP 契约。
- E2E：End to End，端到端验证，本文特指从任务创建、构建、交付、评估到 Overlay 可视化展示的全链路验证。
- iframe：HTML inline frame，浏览器内嵌页面容器。

## 背景与已验证现象

这次问题不是单点 UI 问题，而是交付证据、运行时预览和 Overlay 展示之间没有统一事实源。

已观察到的失败样本：

- 任务 `tsk_e0723e8bf001n8jczF7YSvc3IQ` 最终显示 `ACCEPTED`。
- 同一交付 manifest 内 `runtime:web:.` 失败，原因是没有解析到 live frontend preview URL。
- 同一交付 manifest 内 `review:integrity` 失败，原因是复杂 goal graph 缺少架构完整性 review。
- Overlay 右侧 Preview 面板没有显示页面，且用户期望的地址栏等浏览控件不存在。

直接原因：

- Delivery gate 曾经只把 workspace export coverage 当作主阻断项，runtime flow 和 integrity review 被当成辅助信息展示。
- Preview 面板只消费 `delivery.evidenceManifest.runtimeFlows[].previewUrl` 或 `/preview/frontend` 的已存在端口探测结果。
- `/preview/frontend` 只探测已经运行且属于当前 project root 的本地前端进程，不会启动服务。
- Benchmark 生成的页面经常在 goal worktree 或 delivery capture 的临时 dev server 中运行，Overlay 右侧面板没有稳定、持久的 URL 来源。

结论：

- 评估失败却 accepted 是 gate 契约错误。
- Preview 空白不是单纯组件渲染 bug，而是没有产品级 managed preview session。
- “加一个端口兜底扫描”不能解决根因，会制造双源和不可定位问题。

## 已 recall 的落盘约束

本方案实施前必须继续遵守以下已落盘约束：

- `docs/html-preview-panel-plan.md`
  - Preview 必须使用真实浏览器 iframe。
  - 禁止 `srcdoc`、`DOMParser`、静态文件读取和资源内联。
  - 自动解析只能接受 loopback 页面，不能嵌入 OpenCorvus 自身 origin。
- `specs/delivery-runtime-capture-single-source-2026-05-03.md`
  - `captureRuntimePage()`、`renderPage()`、`computeRuntimeEvidence()` 只接受已经运行的 HTTP URL。
  - capture 层不得推断 package manager，不得启动静态文件服务。
  - 没有 URL 时，应由上游 agent 启动项目或暴露 preview URL。
- `docs/superpowers/specs/2026-05-05-inspector-panel-redesign.md`
  - 右侧面板目标结构是单一滚动 Inspector 列。
  - 旧 Workflow / Inspector / Preview 三 tab 应移除。
  - Preview section 只在存在 `boardStore.delivery?.previewUrl` 时渲染。
- `docs/superpowers/plans/2026-05-05-inspector-panel-redesign.md`
  - `FrontendPreviewPanel` 的内部逻辑复用，但外层 chrome 应并入 `InspectorPanel`。
  - 旧 tab mount 和 tab switching 逻辑应从 `main.tsx` 删除。
- `docs/delivery-completion-first-2026-05-02.md`
  - Delivery 应先判断交付完成度，再处理辅助检查。
- `benchmark-debug-template`
  - benchmark 必须可复现、可验收、可定位。
  - 超时必须是真实无活动超时。
  - benchmark 通过后仍必须人工二次 review。

## 目标

1. Delivery 评估结果和 Overlay 展示一致：阻断项失败时不能 accepted。
2. Preview 面板有单一、明确、可追踪的 URL 来源。
3. 运行时 evidence、Delivery manifest、Overlay Preview 使用同一个 managed preview session 事实。
4. 右侧面板不再保留旧三 tab 与新 Inspector 结构的双路设计。
5. benchmark 可以用一个简单前端 case 复现并验证修复。

## 非目标

- 不把 Preview 做成通用浏览器。
- 不支持任意外部 URL 输入。
- 不通过无归属端口扫描来“猜”页面。
- 不把 `captureRuntimePage()` 改成会启动项目的工具。
- 不用静态 HTML 预览替代真实前端运行时。

## 正确架构

### 1. Managed Preview Session 作为唯一运行时页面来源

新增后端 managed preview session 层，职责是：

- 接收明确的 project workspace。
- 使用任务交付上下文里已经确定的启动契约启动前端。
- 捕获 dev server 输出中的 loopback URL。
- 验证 URL 返回 document-like HTML。
- 持有进程生命周期，直到任务切换、交付结束或服务关闭。
- 将 URL 写入 delivery runtime flow 和 board delivery snapshot。

这个层只负责“启动并持有已经声明的前端运行命令”，不做 package manager 推断。

### 2. Delivery runtime flow 调用 managed preview

Delivery 检测到任务存在前端 runtime surface 时：

- 优先读取 manifest metadata 中明确的 `previewUrl`。
- 若无明确 `previewUrl`，调用 managed preview session 启动项目声明的 dev command。
- managed preview session 返回 URL 后，Delivery 再调用 `computeRuntimeEvidence({ previewUrl })`。
- `computeRuntimeEvidence()` 仍保持 URL-only。

这样保持 capture 单一来源，同时把“启动页面”的责任放在上游 runtime orchestration 层。

### 3. Board API 暴露 delivery preview URL

Workbench board snapshot 应直接包含：

- `delivery.previewUrl`
- `delivery.evidenceManifest.runtimeFlows[].previewUrl`
- managed preview session 状态：`starting`、`ready`、`failed`、`stopped`
- 失败原因：例如 `missing_dev_command`、`server_url_not_emitted`、`html_probe_failed`

Overlay 只能从 board snapshot 读取 Preview URL，不再自己猜。

### 4. `/preview/frontend` 降级为调试接口，不再作为产品主链路

`/preview/frontend` 可以保留为调试 API，但不能作为右侧 Preview 的主事实源。

原因：

- 它只能探测已经存在的进程。
- 它不知道 goal worktree 与 delivery workspace 的当前选择。
- 它无法保证 URL 生命周期与当前任务一致。

产品链路应改为：

`task delivery workspace -> managed preview session -> delivery.previewUrl -> Overlay Inspector Preview`

### 5. 右侧面板完成 InspectorPanel 迁移

当前旧三 tab 结构已经与新设计文档冲突。应一次性切到单一 Inspector 列：

- 删除 `rightPanelTab`、`rightPanelManualKey`、`selectRightPanelTab()`。
- 删除 `rightPanelWorkflow`、`rightPanelInspector`、`rightPanelPreview` 三个 mount。
- 新建或完成 `InspectorPanel`。
- Preview section 只在 `delivery.previewUrl` 存在时渲染。
- Preview section 内提供 URL 展示、刷新、外部打开按钮和 iframe。

说明：旧 tab 结构属于过时代码。执行删除前需要明确确认，因为项目规则要求发现废弃逻辑时先说明并确认删除。

## Delivery gate 修复策略

Delivery final gate 的主阻断项应为：

- failed coverage：验收指标不可验证。
- failed runtime flow：前端运行时页面无法启动、无法渲染、空白、交互不成立。
- `review:integrity`：架构完整性 review 缺失、需要修正、存在 correction 或 missing goal。

辅助项应为：

- build、typecheck、lint、unit test 等命令失败信号。
- 非 integrity specialist review。
- workspace export coverage 之外的诊断项。

注意：辅助项不等于忽略。它们应进入 deferred checks 和 rejection evidence，但不能替代“交付物是否完整”的主线判断。

## Preview 修复策略

### 后端

新增或改造模块：

- `packages/opencorvus/src/preview/session.ts`
  - 创建、查询、停止 managed preview session。
  - 以 task id 和 workspace dir 作为 session key。
  - 只接受显式 command，不做环境猜测。
  - Windows 下停止进程使用 tree kill，避免 dev server 子进程残留。

- `packages/opencorvus/src/delivery/checks/project-gate.ts`
  - 在 runtime flow 中请求 managed preview session。
  - runtime evidence 写入 `previewUrl`。
  - runtime failure 写入 blocking primary failure。

- `packages/opencorvus/src/workbench/board.ts`
  - 将 delivery preview URL 提升为 board snapshot 的一等字段。

- `packages/opencorvus/src/server/routes/preview.ts`
  - 保留调试用途。
  - 明确 API 描述：只查询 managed session 或当前任务 preview，不做无归属端口自动接受。

### 前端

改造模块：

- `packages/overlay/src/services/frontend-preview.ts`
  - 删除从 `/preview/frontend` 自动猜测产品 Preview 的路径。
  - `structuredPreviewUrlFromBoard()` 改为读取 `delivery.previewUrl`，runtime flow URL 仅作为同一 manifest 的结构化字段。

- `packages/overlay/src/components/FrontendPreviewPanel.tsx`
  - 复用 iframe、刷新、外部打开逻辑。
  - 不提供任意地址输入。
  - “地址栏”只展示当前 managed preview URL，不作为第二个 URL 输入源。

- `packages/overlay/src/components/InspectorPanel.tsx`
  - Preview section 并入统一右侧面板。
  - 没有 URL 时不渲染 Preview section，或者显示明确的 managed preview failure row。

- `packages/overlay/src/main.tsx`
  - 删除旧三 tab 切换。
  - 只挂载一个 InspectorPanel。

## Benchmark 方案

### 任务定义

输入：创建一个科学计算器前端应用。

输出：一个可启动、可渲染、可交互、满足计算器功能要求的前端页面。

### 环境

从 `packages/opencorvus` 启动 benchmark：

```powershell
bun run script/benchmark/overlay-web-benchmark.ts --request-file=script/benchmark/assets/scientific-calculator-request.txt --title=delivery-preview-eval-repair-YYYYMMDD-HHMM --report=script/benchmark/runs/_delivery-preview-eval-repair-YYYYMMDD-HHMM.json --executor=mirrorcode --max-runs=20 --max-fix-runs=3
```

### 超时

测试 runner 必须使用“无活动后的真实超时”：

- LLM stream 第一字节 gate。
- LLM stream idle gate。
- 工具输出 idle gate。
- benchmark event stream idle gate。

禁止使用从进程启动时刻开始的固定总时长作为唯一超时。

### 验收指标

benchmark 必须同时满足：

- `qualityVerdict=accepted`。
- `localVerify.exitCode=0`。
- 所有 required checks pass。
- Delivery manifest 没有 primary failure。
- `runtimeFlows[].status` 全部 passed。
- `review:integrity` passed，或 concerns 且 corrections/missing 均为 0。
- Overlay board snapshot 包含 `delivery.previewUrl`。
- 右侧 Inspector Preview 在视觉浏览器中显示非空页面。
- benchmark 通过后人工二次 review 交付物。

## 测试计划

### 后端单元测试

- `packages/opencorvus/test/preview-session.test.ts`
  - managed preview session 能启动显式 dev command。
  - session 返回 loopback URL。
  - session 停止时进程树被清理。
  - command 缺失时返回结构化失败，不进入 port guessing。

- `packages/opencorvus/test/delivery/project-gate.test.ts`
  - runtime flow 失败会进入 primary failure。
  - managed preview 成功后 runtime flow 写入 `previewUrl`。
  - `review:integrity` 缺失会阻断 accepted。
  - integrity concerns 且 corrections/missing 为 0 时只作为 advisory。

- `packages/opencorvus/test/workbench-board-preview.test.ts`
  - board snapshot 暴露 `delivery.previewUrl`。
  - task 切换后不会返回上一个 task 的 preview URL。

### Overlay 单元测试

- `packages/overlay/test/frontend-preview.test.ts`
  - 从 board delivery 读取 preview URL。
  - 拒绝非 loopback URL。
  - 拒绝 Overlay 自身 origin。
  - 不再把 `/preview/frontend` 作为自动产品来源。

- `packages/overlay/test/inspector-panel.test.ts`
  - 有 `delivery.previewUrl` 时渲染 Preview section。
  - 无 `delivery.previewUrl` 时不渲染 Preview iframe。
  - Preview section 展示 URL、refresh、external open 控件。

- `packages/overlay/test/delivery-panel-mount.test.ts`
  - 旧三 tab mount 被移除。
  - 只存在一个 InspectorPanel mount。

### 可视化验证

必须用 headed browser 或 Codex in-app browser 打开 Overlay：

- 右侧没有 Workflow / Inspector / Preview 三 tab。
- 右侧是单一 Inspector 列。
- Preview section 出现时 iframe 非空。
- URL 展示与 delivery manifest 中 `previewUrl` 一致。
- 刷新不会切到别的任务 URL。
- 任务切换后旧 iframe 不残留。

## 实施步骤

1. 先完成 managed preview session 设计和后端测试。
2. 将 Delivery runtime flow 改为消费 managed preview session。
3. 将 failed runtime flow 与 `review:integrity` 纳入 primary blocker。
4. 将 board snapshot 提升 `delivery.previewUrl`。
5. 改 Overlay preview service，只消费 board delivery URL。
6. 完成 InspectorPanel 单列迁移，删除旧三 tab。
7. 跑后端、Overlay、benchmark 三层验证。
8. 通过后进行人工二次 review。
9. 每次改动 commit，push 前必须通过 hook，不使用 `--no-verify`。

## 风险与处理

- 风险：goal worktree 与 root workspace 不一致。
  - 处理：managed preview session key 必须包含 workspace dir，不能只按 task id 存。

- 风险：dev server 输出不打印 URL。
  - 处理：显式 command 同时配置 expected port 或由启动契约返回 URL；不能扫描所有端口兜底。

- 风险：旧 Preview tab 删除影响用户习惯。
  - 处理：这是已落盘设计要求；若执行删除，需要先确认废弃逻辑删除。

- 风险：benchmark 通过但页面骨架被破坏。
  - 处理：benchmark 通过后必须人工二次 review，并检查截图、DOM、交互、功能需求是否同时满足。

## 完成定义

只有同时满足以下条件才算修复完成：

- 失败 runtime flow 不能再产生 accepted。
- 缺失或失败的 `review:integrity` 不能再产生 accepted。
- Overlay 右侧 Preview 的 URL 来自唯一 managed preview session。
- Preview iframe 在可视化验证中显示真实页面。
- 旧三 tab 与新 InspectorPanel 不再双路并存。
- 相关测试全部通过。
- overlay benchmark 简单 case 通过。
- 人工二次 review 通过。
- 改动已 commit 并 push。
