# Workflow Route Countdown

> 2026-05-14 / 用户要求：告诉编排器自行判断需求是否需要 multiple goals（例如实施、验收、校验等）进入 workflow；新任务创建前弹出倒计时，让用户确认走 agent team 还是 direct build，倒计时结束走推荐路径；窗口要美观且统一设计语言。

## 现状证据

- 后端 `CreateTaskInput.kind` 已支持 `"workflow" | "build"`。
- `workflow` 任务默认走 pipeline，但 orchestrator prompt 允许在 scoped workflow 任务里有意识地选择 `build({ request, directBuildIntent: "modify_files" })`，因此 workflow 是保留编排器判断权的入口。
- `build` 任务会在 `orchestrator/agent.ts` 解析为 direct workflow，绕过 requirements / architect / per-goal decomposition。
- Overlay 的新任务唯一入口是 `panelMessage()` 在无选中 task 时调用 `createTask()`，后者负责 `POST /task`。
- App dialog 已有 store-backed `AppDialogHost` + `Dialog` primitive，应扩展这个单一弹窗入口，不新增 DOM shell 或 titlebar 控制。

## 决策

- 推荐路径固定为 `workflow` / Agent Team。理由：它让编排器在任务内自行判断是否需要 requirements、architect、multiple goals、verification goals，或 scoped direct build；这比前端用规则预测更符合用户要求。
- Direct Build 是显式用户选择，创建 `kind="build"` 任务，语义为绕过 agent team。
- 倒计时结束自动确认推荐路径，不取消任务。
- 不做关键词分类器；前端不根据文案猜复杂度，避免把任务路由变成硬编码规则。
- 弹窗属于任务创建确认，owner surface 是 composer / conversation，不放到 titlebar。
- 沿用 AppDialogHost，不创建第二套 modal 基础设施。
- 二元任务创建决策（执行路径、是否排队）必须用可直接比较的卡片按钮，禁止下拉框。
- Agent Team / Direct Build 与立即开始 / 排队等待两处弹窗都不再提供额外确认按钮；点击卡片立即生效。
- 立即开始 / 排队等待弹窗也显示倒计时；倒计时结束自动采用推荐启动方式。

## 改动范围

- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
  - 加强编排器说明：如果需求需要多个可独立验收目标，必须进入 requirements / architect 形成 goal graph，通常包含 implementation、acceptance、verification 等目标。
- `packages/overlay/src/services/task.ts`
  - `CreateTaskOptions.kind` 支持 `"workflow" | "build"`。
  - 新增 route decision：缺少 `kind` 时先弹 agent team / direct build 倒计时选择。
  - `POST /task` 带上选定 `kind`。
- `packages/overlay/src/services/app-dialog.ts`
  - 扩展 AppDialogOptions，支持 route decision 专用 countdown 和推荐值。
- `packages/overlay/src/store/dialog.ts`
  - 增加对应 state 字段。
- `packages/overlay/src/components/AppDialogHost.tsx`
  - 渲染美观的 task decision 卡片；route decision 带倒计时，queue decision 不使用下拉框。
- `packages/overlay/src/styles/surfaces/dialog.css`
  - 添加 route decision 样式，使用现有 token / palette。
- `packages/overlay/src/i18n/zh-CN.json` / `en-US.json`
  - 增加文案。
- `packages/overlay/src/services/task.ts`
  - `resolveTaskQueueDecision()` 使用同一套 task decision 卡片，默认推荐立即开始。
- 测试
  - 更新 task creation 测试，验证选择 `workflow` / `build` 会进入请求体。
  - 增加 prompt hygiene 守护，锁住 multiple goals / implementation / acceptance / verification 进入 workflow 的规则。

## 验收

- 无选中任务发送消息时，先出现 agent team / direct build 倒计时弹窗。
- 默认选中 Agent Team；倒计时结束自动用 Agent Team 创建任务。
- 用户点击 Direct Build 后创建 `kind="build"` 任务。
- 用户点击 Agent Team 或倒计时结束后创建 `kind="workflow"` 任务。
- 弹窗视觉使用既有 Dialog / Button / token，不出现 titlebar 控制或割裂样式。
- 是否排队提示框不出现 `<select>` 下拉框；立即开始 / 排队等待以卡片并列呈现。
- Agent Team / Direct Build 和立即开始 / 排队等待都点击卡片即选择并继续，不出现重复确认 footer。
- 立即开始 / 排队等待弹窗显示倒计时，倒计时结束后自动选择推荐项并继续创建任务。
- 编排器 prompt 明确：发现需要多个 goals 时走 requirements / architect goal graph，不能把多目标工作压成直接 build。
