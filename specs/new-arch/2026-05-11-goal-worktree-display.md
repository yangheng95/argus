# Goal Worktree 显示 — 从全局聚合下沉到 per-goal 卡片

> 2026-05-11 / 用户反馈：overlay 上 worktree 只显示一个（全局聚合），并行 goal 场景下信息丢失。
> 用户指令："要么显示在 goal 执行卡片上，要么显示在右侧的 goal 面板上" —— 即必须改成 goal 维度展示，删掉全局聚合位。
> 当前实现 `TaskWorkspaceLine` + `currentExecutionDirectory()` 用「按 step 状态优先级 + updatedAt 选第一名」的状态机式聚合（rule 13 反例），并行 goal 下随 step 推进抖动。
> 本方案把 worktree 行下沉到右侧 `GoalWorkflowGroup` 卡片，删除 `TaskDirBar` 上的全局 worktree 行与配套 `currentExecutionDirectory` 服务函数，并下钻是否一并清掉 `step.payload.workspaceDir` 这条已无消费者的 wire 字段。

---

## §0 决策

- **展示位置选 B（右侧 GoalWorkflowGroup 卡片）**，不选 A（会话时间线 step 执行卡）：
  - 理由 1（数据模型对齐）：`engine_goal.workspace_dir/branch` 是 goal 级属性，一个 goal 的 plan/build/eval 三步共享同一 worktree。放 step 卡片 = 3 张卡 × N 个 goal 重复同一路径（rule 9 反例）。
  - 理由 2（并行天然解）：`GoalWorkflowList` 本来就是 `<For each={goals}>` 平铺（`GoalWorkflowGroup.tsx:209-218`），每张卡各显示各的 worktree，零状态机（rule 13）。
  - 理由 3（数据已 ready）：`TaskBoardGoalWorkflow` Zod schema (`engine/model.ts:790-792`) 已声明 `workspaceDir/workspaceBranch`；`board.ts:938-939` 已通过 `findGoalLatestWorkspace()` 投影。SDK 类型已暴露。前端只是没读。
- **删除全局聚合位（rule 8 单一来源）**：`TaskWorkspaceLine` 组件 + `currentExecutionDirectory()` 函数 + `goalStepPriority()` + 配套 DOM/CSS/i18n/dom.ts 注册/守护测试条目，**全部清除**，不留双路。
- **保留 `VcsBadge`**：它显示的是 **task 根目录**的 git 状态（branch + dirty + ahead/behind），与新加的 per-goal worktree branch 是不同语义，不冲突。从 `.task-workspace-row` 容器中移出，挂到 `.task-dir` 同级；`.task-workspace-row` 整条 CSS 删除。
- **`step.payload.workspaceDir` 同步删除（rule 17）**：删除 `currentExecutionDirectory` 后该 wire 字段无任何消费者（main.tsx 调试 dump 读的是 goal-level `gw.workspaceDir`，非 step payload）。后端 `model.ts:711` + `board.ts:1201/1212/1266/1272` 同步清掉，避免留 dead wire。
- **折叠态也透出 branch 缩写**：并行场景下用户最想一眼对比"每个 goal 在哪个分支"，折叠态隐藏 = 必须展开 N 张卡片才能对比，违背并行展示的初衷。folded 态显示 `⎇ <branch>`；展开态再加完整 path 行。

不做的事（明确 out of scope）：

- 不改 DB schema、不改 `engine_goal.workspace_dir/branch` 字段。
- 不改 `findGoalLatestWorkspace` 数据源，goal-level workspace 仍从 goal_run_attempt artifact 取（`board.ts:933-937` 既有注释说明）。
- 不为 worktree 行加任何 worktree 操作按钮（rebase / merge / discard），仅"点击打开目录"，保持与原 `TaskWorkspaceLine.onClick = openDirectory` 同等粒度。
- 不动 conversation timeline 的 step 卡 (`Card.tsx`)，那里早就移除了 goal-group 分组（subagent 报告：2026-04-19 后），step 平铺与 goal 身份解耦。

---

## §1 影响面（rule 35 全仓 grep 已完成）

### 1.1 后端 / wire 契约

| 文件                                                                        | 改动                                                                                                                                           |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/engine/model.ts:711`                               | `TaskBoardGoalStepPayload.workspaceDir` 字段删除                                                                                               |
| `packages/opencorvus/src/workbench/board.ts:1199-1272` (`buildStepPayload`) | 删除局部变量 `workspaceDir`、`goalRun.workspace_dir` 读取行、返回对象里的 `workspaceDir` 字段 + 早退条件中的 `workspaceDir === undefined` 判定 |
| `packages/sdk/openapi.json`                                                 | 由 `bun run docs:api` 重生（移除 step payload 中 workspaceDir）                                                                                |
| `packages/sdk/js/src/gen/types.gen.ts`                                      | 由 codegen 重生                                                                                                                                |

`TaskBoardGoalWorkflow.workspaceDir/workspaceBranch`（`model.ts:790-792`）**保留**，是新方案的数据源。

### 1.2 overlay 前端 — 新增（goal 卡片渲染）

| 文件                                                                   | 改动                                                                                                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/overlay/src/components/GoalWorkflowGroup.tsx:50-64`          | `GoalWorkflow` 接口增加 `workspaceDir?: string; workspaceBranch?: string;`                                                           |
| 同上 `:154-175` (`gwg-header-meta`)                                    | 折叠态在 revision/advisory 徽章后追加 `<Show when={workspaceBranch}><span class="gwg-branch-pill">⎇ {workspaceBranch}</span></Show>` |
| 同上 `:176-196` (`gwg-body`)                                           | 在 acceptance 行之后新增 worktree 按钮（path + branch，点击 `openDirectory`）                                                        |
| `packages/overlay/src/utils/path.ts` _(新建)_                          | 抽出 `relativePathFrom` + `shortPath`（原 `TaskDirBar.tsx:26-38`，rule 9 公共化），新行复用                                          |
| `packages/overlay/src/styles/surfaces/inspector.css` 或对应 GWG 样式表 | 新增 `.gwg-worktree`（button，复用 `.gwg-objective` padding/border 模式）+ `.gwg-branch-pill`（折叠态徽章）                          |
| `packages/overlay/src/i18n/zh-CN.json` + `en-US.json`                  | 新增 `goal.field.worktree` = "工作区" / "Worktree"                                                                                   |

### 1.3 overlay 前端 — 删除（全局聚合位，rule 8）

| 文件                                                          | 删除                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/overlay/src/components/TaskDirBar.tsx:138-168`      | `TaskWorkspaceLine` 整个组件                                                   |
| 同上 `:26-38`                                                 | `relativePathFrom` + `shortPath`（已抽到 `utils/path.ts`，rule 9）             |
| 同上 `:23`                                                    | 从 import 去掉 `currentExecutionDirectory`、`openDirectory`（VcsBadge 不需要） |
| `packages/overlay/src/services/workspace.ts:697-738`          | `currentExecutionDirectory()` + `goalStepPriority()` 整段                      |
| `packages/overlay/src/main.tsx:12,769,777-779`                | `TaskWorkspaceLine` import 与 mount 三处                                       |
| `packages/overlay/src/index.html:119`                         | `<span id="solidTaskWorkspaceLineMount">`                                      |
| `packages/overlay/src/dom.ts:35,184`                          | `taskWorkspaceDir` 条目                                                        |
| `packages/overlay/src/i18n/zh-CN.json:324` + `en-US.json:324` | `cwd.execution_workspace` key                                                  |
| `packages/overlay/src/styles/surfaces/conversation.css:486`   | `.task-workspace-row` 规则                                                     |
| `packages/overlay/src/services/meta.ts:30`                    | 注释中 `TaskWorkspaceLine` 提及                                                |

### 1.4 overlay 前端 — 调整（VcsBadge 重定位）

| 文件                                             | 改动                                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/TaskDirBar.tsx` | `VcsBadge` 从 `TaskWorkspaceLine` 内移出，新增独立 mount 或合并进 `TaskDirContent` 末尾；导出方式相应调整 |
| `packages/overlay/src/index.html`                | 如新增独立 mount，加 `<span id="solidVcsBadgeMount">`；如合并到 TaskDirContent，无 DOM 变动               |
| `packages/overlay/src/main.tsx`                  | mount 点同步调整                                                                                          |

### 1.5 测试 — 删除/修改

| 文件                                                             | 改动                                                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `packages/overlay/test/board-workflow-schema.test.ts:3,40-70`    | 删除 `currentExecutionDirectory reads only canonical goal step payloads` 测试（被测函数已删） |
| `packages/overlay/test/task-cwd-row-layout.test.ts:78-79,92-105` | 删除 `.task-workspace-row` 锚定测试 + `execution workspace path control` describe 块          |
| `packages/overlay/test/overlay-architecture-guards.test.ts:718`  | 守护类列表移除 `"task-workspace-row"`                                                         |

### 1.6 测试 — 新增（rule 36）

| 用例                               | 文件                                                                                                  | 断言                                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| GoalWorkflowGroup 渲染 worktree 行 | `packages/overlay/test/goal-workflow-group.test.ts` _(新建或复用)_                                    | fixture goal 带 `workspaceDir = ".opencorvus/worktrees/goal-x"`，展开后 DOM 含 `.gwg-worktree`，文本含相对路径，`title` 是绝对路径            |
| 折叠态显示 branch 徽章             | 同上                                                                                                  | fixture goal 带 `workspaceBranch`，未展开时 DOM 含 `.gwg-branch-pill` 文本 `⎇ <branch>`                                                       |
| 点击打开目录                       | 同上                                                                                                  | mock `openDirectory`；点击 `.gwg-worktree` 触发 `openDirectory(workspaceDir)` 一次                                                            |
| **并行 goal 各自展示**             | 同上                                                                                                  | fixture 两个 running goal、不同 `workspaceDir/Branch`；断言 DOM 中出现两条独立 worktree path + 两个 branch 徽章；断言两者文本互不重复         |
| 无 worktree 时不渲染               | 同上                                                                                                  | `workspaceDir = undefined`：worktree 行 + branch 徽章均不出现                                                                                 |
| 自动行为消失                       | `packages/overlay/test/overlay-architecture-guards.test.ts` 或 `task-cwd-row-layout.test.ts` 重命名后 | 断言：源码搜不到 `TaskWorkspaceLine` 标识符；`workspace.ts` 不再 export `currentExecutionDirectory`；i18n 不再含 `cwd.execution_workspace` 键 |
| step payload 无 workspaceDir       | `packages/opencorvus/test/workbench/board-step-payload.test.ts` _(新建或复用)_                        | 构造 task fixture，断言 `goalWorkflows[].steps[].payload` 不含 `workspaceDir` 键                                                              |

### 1.7 文档（无需改）

- `specs/new-arch/10-worktree-lifecycle.md`：worktree 生命周期未变。
- `specs/new-arch/02-data.md`、`05-config.md`、`16-unified-teardown.md`：数据模型未变。
- `docs/product/.../goal-run-task.md`：产品文档不涉及 UI 位置。
- `docs/superpowers/plans/2026-05-05-inspector-panel-redesign.md`：历史 redesign 计划，已实施落地，本次为该 panel 的增量改动，无需回填该文档。

---

## §2 设计细节

### 2.1 GoalWorkflowGroup 卡片新结构

```
┌─ gwg-header ──────────────────────────────────────────────────────┐
│ [status-icon] {goalTitle}              {revision} {advisory} {⎇branch}│
└───────────────────────────────────────────────────────────────────┘
┌─ gwg-body (when expanded) ───────────────────────────────────────┐
│ Objective                                                         │
│   {goalObjective}                                                 │
│ Acceptance                                                        │
│   {previewAcceptance}                                             │
│ Worktree                                                          │
│   [button] {relativePath}  ⎇ {branch}     ← 点击 openDirectory     │
└───────────────────────────────────────────────────────────────────┘
```

### 2.2 worktree 行 DOM（展开态）

```tsx
<Show when={props.goal.workspaceDir}>
  <button
    type="button"
    class="gwg-worktree"
    data-ui="goal-worktree-open"
    title={props.goal.workspaceDir}
    aria-label={`${t("cwd.open")}: ${props.goal.workspaceDir}`}
    onClick={() => void openDirectory(props.goal.workspaceDir!)}
  >
    <span class="gwg-worktree-label">{t("goal.field.worktree")}</span>
    <span class="gwg-worktree-path">
      {relativePathFrom(activeDirectory(), props.goal.workspaceDir!) || shortPath(props.goal.workspaceDir!)}
    </span>
    <Show when={props.goal.workspaceBranch}>
      <span class="gwg-worktree-branch">⎇ {props.goal.workspaceBranch}</span>
    </Show>
  </button>
</Show>
```

### 2.3 折叠态 branch 徽章

```tsx
<Show when={props.goal.workspaceBranch}>
  <span class="gwg-branch-pill" title={props.goal.workspaceDir} aria-label={`worktree: ${props.goal.workspaceDir}`}>
    ⎇ {props.goal.workspaceBranch}
  </span>
</Show>
```

挂在 `gwg-header-meta`（`GoalWorkflowGroup.tsx:160-167`）末尾，与 revision/advisory 同列。

### 2.4 并行 goal 行为

`GoalWorkflowList` 当前实现：

```tsx
<div class="gwg-list">
  <For each={props.goals}>
    {(goal) => <GoalWorkflowGroup goal={goal} ... />}
  </For>
</div>
```

**零改动**。每张卡读自己 props 上的 `workspaceDir/Branch`，N 个并行 goal → N 张卡片各显示各的 worktree，无任何聚合、无选中、无切换。

---

## §3 风险与缓解

| 风险                                                                                                                    | 缓解                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 删除 `currentExecutionDirectory` 是 export 变更，外部包导入会爆                                                         | grep 已确认仅 `board-workflow-schema.test.ts:3` 引用，删除测试即可。无 SDK / 跨包消费者。 |
| `task-workspace-row` 是 `overlay-architecture-guards.test.ts` 守护列表成员，遗漏会导致守护测试通过但实际类已废          | §1.5 显式列出该测试为修改项。                                                             |
| 删除 `step.payload.workspaceDir` 是 wire schema 收窄，旧 overlay 版本（如果 release ）连新后端会丢失字段                | 项目未发布（CLAUDE.md rule 16），无兼容包袱，直接删。                                     |
| 折叠态 branch 徽章占用 `gwg-header-meta` 宽度，长 branch 名（如 `goal-qc8zgjhy` 12 字符）+ revision + advisory 可能拥挤 | branch 徽章使用 `text-overflow: ellipsis` + `max-width`；hover 看 title 完整路径。        |
| `relativePathFrom(activeDirectory(), workspaceDir)` 在 task 根目录尚未 hydrated 时会返回空串，落回 `shortPath`          | 行为正常，shortPath 给 `…/{last2}` 仍可读；与原 `TaskWorkspaceLine` 同样的回退逻辑。      |
| 抽出 `utils/path.ts` 后若其他文件已有同名 helper，会双源                                                                | grep 已确认 `relativePathFrom` / `shortPath` 仅在 `TaskDirBar.tsx` 出现，新建文件无冲突。 |

---

## §4 实施顺序

1. **新建 `utils/path.ts`**，搬 `relativePathFrom` + `shortPath`，加单元测试覆盖两个 helper（输入：win/posix 混合分隔符、base 含/不含尾斜杠、不在 base 下的路径）。
2. **GoalWorkflowGroup**：接口加字段、header-meta 加 branch 徽章、body 加 worktree 按钮、CSS 新规则。先写组件测试（§1.6 前 5 条），跑通。
3. **删除 TaskWorkspaceLine 链路**：`TaskDirBar.tsx`、`workspace.ts`、`main.tsx`、`index.html`、`dom.ts`、CSS、i18n 一次性删干净；保留 `VcsBadge` 并重挂载。删除/修改 `task-cwd-row-layout.test.ts`、`board-workflow-schema.test.ts`、`overlay-architecture-guards.test.ts`。
4. **后端 step.payload.workspaceDir 清除**：`model.ts:711` + `board.ts:1199-1272`，跑 `bun run docs:api` 重生 openapi.json + sdk types，加 §1.6 最后一条 backend 测试。
5. **跑全套 typecheck + api:routes-check + docs:check + 相关包 test**（rule 33 pre-push hook 已覆盖），失败修根因，禁止 `--no-verify`。
6. **commit + push**（rule 33），commit message 引用本 spec 路径与 CLAUDE.md rule 8 / rule 13。

---

## §5 待 reviewer 确认（codex）

请重点审查以下点：

1. **位置选 B 是否最优**？是否存在更好的第三选项（如：goal panel 上方加一栏 worktree 概览，每个 goal 一行只显路径，goal 卡片本身不带 worktree）？相比之下选 B 优势 / 劣势？
2. **`step.payload.workspaceDir` 是否真的没有消费者**？我已 grep 确认前端仅 `currentExecutionDirectory` 读，请二次复核 backend / orchestrator / 任何 inspector / overlay 之外的工具（CLI / benchmark / inspect-task.ts 等）是否读这个 step payload 字段。
3. **折叠态 branch 徽章是否过载 header**？header-meta 已经有 revision + advisory 两个徽章，再加 branch 是否破坏视觉密度？或者只在展开态展示更克制？
4. **VcsBadge 重定位的归属**：移出 `.task-workspace-row` 后，挂到 `.task-dir` 同级 vs 合并到 `TaskDirContent` 内末尾 vs 新建独立 mount，哪种最契合现有 task header 布局？
5. **是否存在违反 rule 13（无状态机）的隐藏角落**？现 `currentExecutionDirectory` 是显式状态机（按 status 优先级），新方案完全 declarative；但请检查 `findGoalLatestWorkspace` 在 board.ts 中是否也走了类似 priority 排序，是否同样应当审视。

reviewer 反馈如需修订方案，按 rule 35：原方案显式标注 "codex 审查反馈"，附修订内容，禁止静默重写。

---

## §6 codex 审查反馈（2026-05-11，verdict = REQUEST_CHANGES）

codex 结论是方向认同（B 方案 + 删除全局聚合 + 删除 `step.payload.workspaceDir`），但点出 4 处具体遗漏与 4 处可改进点。下列修订**追加**到对应章节，不修改 §0–§5 原文。

### 6.1 影响面遗漏补齐（针对 §1）

codex 指出 §1 漏了 overlay-side 的 type/projection 镜像链。**新增**到 §1：

| 章节                                 | 原状                        | 修订追加                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1.2（新增）/§1.3（删除）—— 待重分类 | 未覆盖                      | 删除 `packages/overlay/src/store/card-tree.ts:82` 的 `StepPayload.workspaceDir` 字段。这是 wire schema `TaskBoardGoalStepPayload.workspaceDir`（`model.ts:711`）的 client-side 镜像（其文件头注释行 70-71 自承"mirrors workbench/board.ts GoalStepPayload"），后端 wire 收窄后镜像必须同步收窄，否则类型层留双源（rule 8）。 |
| §1.2                                 | 未覆盖                      | `packages/overlay/src/services/tree-writer.ts:1660` 的 `stepPayload: step.payload` 是整对象盲拷贝，自身**不需要改代码**（payload 上没有 `workspaceDir` 后这里自然不会拷贝它）；但**需要增加测试**，见 §6.4。                                                                                                                 |
| §1.4（SDK 区分）                     | 仅笼统说"重生"              | 明确：openapi.json + types.gen.ts **只删 step-level** (`paths.*.goalWorkflows[].steps[].payload.workspaceDir`)，**保留 goal-level** (`paths.*.goalWorkflows[].workspaceDir/Branch`)。重生后人工 diff 确认这两条命中差异，不能笼统说"移除 workspaceDir"。                                                                     |
| §1.5                                 | 仅删除                      | `packages/overlay/test/board-workflow-schema.test.ts` 删除 `currentExecutionDirectory` 测试后，文件若只剩无关测试可保留；若空则整文件删除。                                                                                                                                                                                  |
| §1.3 / §1.4（VcsBadge）              | 提及"新增独立 mount 或合并" | **codex 反对新增 mount，确定合并方案**：`VcsBadge` 合并进 `TaskDirContent`（与 task-dir breadcrumb 同 owner surface），不新增 `#solidVcsBadgeMount`。`TaskDirContent` 返回 `<span class="task-dir">…</span>` 旁追加 `<VcsBadge />`，或将 `VcsBadge` 内联到该 span 末尾。`index.html` 不新增 mount 节点。                     |

### 6.2 rule 13（无状态机）审计补强

`findGoalLatestWorkspace`（`packages/opencorvus/src/engine/store.ts:524-540`）**不是**按 step status 排序的 UI 状态机 —— 它读 `findLatestTipGoalRun(goalID)` 选 append-only artifact 流的 live tip（同文件 L510-522 已自承文档：「Reads the live tip; supersede-state artifacts on retired tips don't shadow the live attempt's pointer」）。

**修订**：

- §0 第 4 条删除前的旧描述"现 `currentExecutionDirectory` 是显式状态机（按 status 优先级），新方案完全 declarative"扩写为：「新方案数据源 `findGoalLatestWorkspace` 是 **append-only artifact tip + supersede 链投影**（非 status priority sort），符合 rule 13。这一性质由 `engine/store.ts:510-522` 文档锁定，且 `findLatestTipGoalRun` 内部的 supersede-aware tip selection 是事件流自然语义，不是 UI 决策。」
- §1.6 新增测试：multi-attempt + supersede 场景下，goal 重试 N 次、其中一次被 supersede，验证 `goalWorkflows[].workspaceDir` 取 live tip 的 workspace_dir 而不是 superseded 的旧值。文件：`packages/opencorvus/test/workbench/board-goal-workspace-projection.test.ts`（新建）。

### 6.3 rule 7（禁止 fallback）违规修复

codex 指出 §2.2 的 `relativePathFrom(activeDirectory(), workspaceDir) || shortPath(workspaceDir)` 是 fallback —— 用 `shortPath` 掩盖 active directory 未 hydrated 的状态，违反 rule 7（与原 `TaskWorkspaceLine.tsx:147` 同款问题，本应一起治掉）。

**修订**：

- §2.2 DOM 中删除 `|| shortPath(...)` 兜底；改为：相对路径计算失败时 `<Show when={false}>` 整行隐藏，或显示绝对路径但不截断。
- 单一显示契约：**只显示相对于 `activeDirectory()` 的相对路径**；如果 `activeDirectory()` 空（hydration 阶段），整个 worktree 行不渲染（与原 `TaskWorkspaceLine` 的 `show` 同等隐藏行为，但不再有 shortPath 这个第二路径来源）。
- §1.2 `utils/path.ts` 抽出范围相应缩小：只搬 `relativePathFrom`，**删除 `shortPath`**（已无消费者，rule 17）。

### 6.4 rule 36（每改必测）补齐：源码守护测试

codex 指出"自动行为消失"测试不能只删旧测试，要写**源码 negative-grep 守护**防止符号复活。

**修订** §1.6 测试清单新增独立用例（文件：`packages/overlay/test/worktree-display-source-guards.test.ts`，新建）：

| 守护断言                                                                     | 目的                 |
| ---------------------------------------------------------------------------- | -------------------- |
| overlay/src 全树搜不到 `TaskWorkspaceLine` 标识符                            | 阻止组件回归         |
| `workspace.ts` 不再 export `currentExecutionDirectory` 或 `goalStepPriority` | 阻止聚合函数复活     |
| i18n 文件不再含 `cwd.execution_workspace` 键                                 | 阻止旧文案残留       |
| `index.html` 不再含 `solidTaskWorkspaceLineMount`                            | 阻止挂载点回潜       |
| `dom.ts` 不再含 `taskWorkspaceDir` 字段                                      | 阻止 DOM 注册回归    |
| css `.task-workspace-row` 选择器不存在                                       | 阻止 CSS 类残留      |
| `card-tree.ts` 的 `StepPayload` interface 字段集合不含 `workspaceDir`        | 阻止 client 镜像回归 |

新增 backend 测试（文件：`packages/opencorvus/test/workbench/board-step-payload.test.ts`，新建或合并到现有 board 测试）：

| 用例                                               | 断言                                                                                                                                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| step payload 投影不含 workspaceDir                 | 构造 goal_run with `workspace_dir = "D:/x"`，运行 `buildBoard`，断言 `board.goalWorkflows[0].steps[*].payload` 全部 step 都没有 `workspaceDir` 键（`expect(Object.keys(payload)).not.toContain("workspaceDir")`） |
| openapi.json step payload schema 不含 workspaceDir | 读取 `packages/sdk/openapi.json`，在 step payload schema 上断言 `properties.workspaceDir` 不存在                                                                                                                  |

修改既有测试（§1.5 追加项）：

- `packages/overlay/test/tree-writer-hierarchy.test.ts:308-348`：现测试 fixture 在 step payload 里只有 `planNodes` + `buildSessionID`，没主动 fail。**追加断言**：从 board 读 step payload 后，复制到 `card.stepPayload` 的对象不含 `workspaceDir` 键。锁住"上游收窄 → 下游不漏字段"。

### 6.5 §0 决策修订汇总

下列 §0 决策项**显式更新**（codex 审查反馈驱动）：

- **决策 §0 第 3 条（删除 step.payload.workspaceDir）**：影响面扩大 —— 后端 (`model.ts`/`board.ts`) + 前端 type mirror (`card-tree.ts:82`) + 测试守护 (`tree-writer-hierarchy.test.ts`)，三处必须同步。
- **决策 §0 第 4 条（保留 VcsBadge）**：归属从"挂到 `.task-dir` 同级"明确为"**合并进 `TaskDirContent`**"。不新增 mount 点。
- **决策 §0 第 5 条（折叠态 branch 徽章）**：保留，但 §2.3 实现必须包含 `max-width: 8em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` 与 `title={workspaceDir}` —— 长 branch 名（如 `goal-qc8zgjhy`）下不挤压 revision/advisory。
- **新增决策**：相对路径计算失败时**整行隐藏**，禁用 `shortPath` fallback（rule 7）。`shortPath` 函数随 `TaskWorkspaceLine` 一起删除。
- **新增决策**：`findGoalLatestWorkspace` 在 `board.ts:938-939` 调用两次，**合并为局部变量**：`const ws = findGoalLatestWorkspace(goal.id); workspaceDir: ws.directory ?? undefined, workspaceBranch: ws.branch ?? undefined`。codex 指出是同一 projection 的重复查询（不是 bug，但 rule 9/rule 5：避免无意义重复）。

### 6.6 §4 实施顺序追加

在原 §4 step 4（"后端 step.payload.workspaceDir 清除"）之间插入：

- **step 4a**：同步删除 `packages/overlay/src/store/card-tree.ts:82` 的 `StepPayload.workspaceDir` 字段；更新 `tree-writer-hierarchy.test.ts:308` 断言。
- **step 4b**：openapi.json + types.gen.ts 重生后人工 diff 验证：goal-level workspaceDir/Branch 保留、step-level workspaceDir 移除（两条命中分别确认）。

实施前 / 中 / 后保持现有 commit 节奏（rule 33）。

### 6.7 未采纳的 codex 建议

- codex §可选改进 提议"新增 `formatGoalWorktreeLabel()` 这类纯 display helper" —— **暂不采纳**：当前 §2.2 DOM 已经足够 declarative，引入 helper 反而增加一层抽象（rule 5 / rule 6 反对过度工程）。如果落地后 `relativePathFrom + branch 拼接`在 2 处以上重复，再抽（rule 9）。
- codex §可选改进 提议"`gwg-worktree` 建议用 button 展示完整 title + aria-label，header 只显示 branch pill，body 承担打开目录动作" —— **已采纳**，§2.1-2.3 原文即此设计，codex 此条是认可性重申。

### 6.8 verdict 更新

- codex 原 verdict：REQUEST_CHANGES
- 修订后预期：所有具体遗漏与违规已在 §6.1-6.4 显式 patch，仅剩实施风险。**待 codex 二次审视**（用户决定是否再发一轮，或直接基于 §6 起步实施）。
