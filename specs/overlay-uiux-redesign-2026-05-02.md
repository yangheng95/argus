# Overlay UI/UX 重设计方案 - 2026-05-02

> 参考视觉风格：`specs/chat ui.png`（仅参考风格，不参考内容）。
> 范式：浅色优先、软分区、单焦列、悬浮式 composer、持久右栏、令牌驱动。
> 强制约束（CLAUDE.md / AGENTS.md）：
> - 规则 7/8：禁止 fallback、禁止双源。旧 token / 旧选择器必须直接替换，不留 deprecated alias。
> - 规则 13/16：禁状态机、禁过渡补丁。不增加 legacy 模式开关，不保留新旧主题分支并存。
> - 规则 17：发现真正死代码，实施前向用户说明并确认删除；已经被新方案直接替换的旧代码随阶段删除。
> - 规则 28/36：每个代码改动必须配单元测试或 e2e 测试。
> - 规则 35：实施前按本文件列出的调用点继续全仓 grep，发现新增调用点必须先更新方案。

## 0. 当前事实（2026-05-02 grep 核对）

| 项 | 当前事实 | 证据 |
|---|---|---|
| `!important` 总数 | 375 次，跨 2 文件 | `packages/overlay/src/styles.css`、`packages/overlay/src/styles/card.css` |
| 既有 token 体系 | 已有 `--ui-*` 尺寸/字号/间距、`--radius*`、`--good/--warn/--bad/--accent` | `styles.css:5-121` |
| `--card-stage-*` | 14 个 stage token，不是 12 个 | `styles/card.css:28-41` |
| 未知 stage 着色 | `card-color.ts` 对未知 stage 生成稳定 HSL | `utils/card-color.ts:32-38` |
| Workspace diff/file 面板 | `#solidWorkspaceMount.workspace-mount[hidden]` 叠在 chat 内、composer 上方 | `index.html:236-240`、`main.tsx:132-138`、`main.tsx:1378-1391` |
| 右栏 sections | 已是右列，tab 为 `workflow / inspector / preview` | `index.html:250-273`、`services/frontend-preview.ts:3` |
| Preview 自动切换 | 只从 `inspector` 自动切到 `preview`，有测试保护 | `frontend-preview.ts:26-29`、`frontend-preview.test.ts:41-60` |
| TaskStatusHeader 挂载 | `#solidTaskStatusMount` 在 `.chat-header` 内 | `index.html:200-204`、`main.tsx:939-942` |
| `TopBar.tsx` 状态 | 组件存在，但当前未在 `main.tsx` 挂载 | `components/TopBar.tsx`、`main.tsx` grep 无挂载 |
| Composer 结构 | `.chat-icon-col` 竖列 + `.chat-compose-meta` 分离行 | `ChatComposer.tsx:453-568`、`styles.css:5086`、`styles.css:5320` |
| MemoryPanel | 挂在设置页 `#memoryBody`，不是右栏 | `index.html:466-474`、`main.tsx:1109-1114` |
| LogViewer | 全局日志 viewer，由 titlebar 状态打开，组件自身渲染 `<dialog>` | `main.tsx:1062-1074`、`LogViewer.tsx:472-577` |
| ChangesPanel tab 切换 | 每个 chunk 常驻挂载，靠 `data-active` + CSS `display:none` 隐藏，目的是 O(1) 切 tab | `ChangesPanel.tsx:197-244`、`styles.css:11376-11389` |
| DiffView 未变更块 | 已经把大段 context 折叠成 `skip` 行，但不是按钮展开 | `DiffView.tsx:181-204`、`DiffView.tsx:258-268` |
| TracePanel 轮询 | 挂在 Card body 内，仅用 `document.hidden` 暂停轮询 | `Card.tsx:245-249`、`TracePanel.tsx:227-245` |

## 1. 单源设计决策

### 1.1 Token 单源

保留并收敛现有 `--ui-*` token 体系，不新增一套平行 `--space-* / --fs-* / --fw-* / --motion-*` 体系。

实施规则：

1. `--ui-scale` 继续是尺寸缩放单源。
2. 间距使用现有 `--ui-gap-xs/sm/md/lg`，缺口只允许补 `--ui-gap-xl`，不新增 `--space-*`。
3. 字号使用现有 `--ui-font-*`，不新增 `--fs-*`。
4. 圆角收敛到现有 `--radius` / `--radius-lg` / `--panel-radius`；如确需 pill，只新增 `--radius-pill`，并替换散落 `999px`。
5. 状态色对外只暴露 `--status-ok / --status-warn / --status-error / --status-info`。`--good / --warn / --bad / --accent` 作为底层色源保留；删除 `--ok / --warning / --danger / --info` 别名。
6. 边框只暴露 `--border-subtle / --border-normal / --border-strong`。所有 `color-mix(in srgb, var(--border)...` 散值迁移到三档 token。
7. 动效只暴露 `--motion-quick / --motion-normal / --motion-slow`。替换散落 ms 值时必须逐处说明映射。

### 1.2 信息架构单源

目标三列不是新增第四套面板，而是把现有结构收敛成：

| 列 | 单源职责 | 当前迁移对象 |
|---|---|---|
| 左列 | recent chats / task list / workspace directory | `sidebar`、`task-bar` 中 cwd 信息 |
| 中列 | conversation + composer | `chatSection` |
| 右列 | Plan / Evaluation / Changes / Preview / Diff/File workspace | 现有 `sections` + `solidWorkspaceMount` |

关键决策：

1. `sections` 是唯一右栏容器。不得再让 `workspace-mount` 作为 chat 内的第二个 workspace surface。
2. `solidWorkspaceMount` 迁入右栏，成为右栏内的 Diff/File workspace 子面板；不再在中列占高度。
3. Preview 不能丢失。`preview` tab 迁移为右栏正式 tab，或并入 `Evaluation` 下的 `Preview` 子面板；二选一只能保留一个真实入口。
4. `workflow / inspector / preview` 字面量迁移时必须同时更新：
   - `services/frontend-preview.ts` 的 `RightPanelTab`
   - `frontend-preview.test.ts`
   - `delivery-panel-mount.test.ts`
   - `index.html`
   - `main.tsx`
   - `i18n/en-US.json`
   - `i18n/zh-CN.json`

本方案采用目标 tab：`plan / evaluation / changes / preview`。

映射：

| 当前 tab | 目标 tab | 内容 |
|---|---|---|
| `workflow` | `plan` | `AgentWorkflowPanel` |
| `inspector` | 拆分为 `evaluation` + `changes` | Board/Interaction/Delivery 进入 Evaluation；Files/Changes 进入 Changes |
| `preview` | `preview` | `FrontendPreviewPanel` |
| chat 内 `workspace-mount` | `changes` | Diff/File workspace 子面板 |

### 1.3 未知 Agent / stage 处理

禁止继续按 14 个固定 stage 色扩张，但也不能破坏通用工具属性。替换为：

```ts
type CardRole = "user" | "system" | "execution" | "review";
```

`roleOf(stage)` 负责把已知 stage 归类；未知 stage 必须归入 `system`，并在 title/meta 文本中保留原 stage 名称。删除未知 stage 的随机/哈希色，避免新增无限色源。

已知映射：

| role | stage |
|---|---|
| `user` | `user`, `assistant` |
| `system` | `orchestrator`, `spec`, `requirements`, `design-analyst`, `architect`, `planner`, unknown |
| `execution` | `goal`, `executor`, `build`, `tool` |
| `review` | `evaluator`, `delivery`, `integrity` |

## 2. 实施阶段

### Phase A - Token 与角色色单源

状态：已实施。代码提交范围包括 roleOf 角色归类、状态 token 单源、`--card-stage-*` 删除、`!important` 降到 7 处，以及 `theme-tokens.test.ts` / `no-important.test.ts` 回归测试。

文件：

- `packages/overlay/src/styles.css`
- `packages/overlay/src/styles/card.css`
- `packages/overlay/src/utils/card-color.ts`
- `packages/overlay/src/components/Card.tsx`
- `packages/overlay/test/default-theme.test.ts`

动作：

1. 将 `:root` 改为浅色基线；`body[data-theme="dark"]` 和 `body[data-theme="vscode-dark"]` 只覆盖暗色值。
2. 保留 `--ui-*` 命名体系，补齐缺失 token，不引入 `--space-* / --fs-*` 平行体系。
3. 新增 `--status-*`，删除 `--ok / --warning / --danger / --info`。
4. 删除 14 个 `--card-stage-*` token。
5. `card-color.ts` 从 `stageAccent()` 改为 `roleOf()`；`Card.tsx` 不再注入 inline `--card-stage`，改写 `data-role`。
6. 删除未知 stage 哈希 HSL，未知 stage 统一 `system`。
7. 删除所有 `--card-stage` fallback / alias / 注释。
8. `!important` 分批清理到 <= 30，只保留 `[hidden]` 和 reset 强约束。

测试：

- 新增 `packages/overlay/test/theme-tokens.test.ts`
  - `:root` 默认浅色。
  - `dark` / `vscode-dark` 顶层 token 已定义且与浅色不同。
  - `--status-ok/warn/error/info` 已定义。
  - `--ok / --warning / --danger / --info` 不存在。
  - `--card-stage-*` 和 inline `--card-stage` grep 0 命中。
  - `--role-user/system/execution/review` 已定义。
- 新增 `packages/overlay/test/no-important.test.ts`
  - `styles.css` + `styles/card.css` 的 `!important` <= 30。

### Phase B - 右栏 IA 收敛为持久三列

状态：已实施。代码提交范围包括右栏 `plan / evaluation / changes / preview` 持久 tab、workspace 迁移到 `changes`、删除 chat workspace toggle/resizer 与 `workspacePanelHeight` 设置、`frontend-preview` 自动切换改为 `evaluation -> preview`，以及 `layout-shell.test.ts` / `frontend-preview.test.ts` / `delivery-panel-mount.test.ts` 回归测试。

文件：

- `packages/overlay/src/index.html`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/services/frontend-preview.ts`
- `packages/overlay/src/components/WorkspacePanel.tsx`
- `packages/overlay/src/components/FilesSection.tsx`
- `packages/overlay/src/components/TaskDirBar.tsx`
- `packages/overlay/src/i18n/en-US.json`
- `packages/overlay/src/i18n/zh-CN.json`
- `packages/overlay/test/frontend-preview.test.ts`
- `packages/overlay/test/delivery-panel-mount.test.ts`
- `packages/overlay/test/layout-shell.test.ts`

动作：

1. `panel-body` 明确为三列 grid：sidebar / chat / sections。
2. `solidWorkspaceMount` 移出 `chatSection`，挂入 `changes` tab 内，作为 Diff/File workspace 子面板。
3. 删除 chat header 的 workspace toggle 和 `workspaceOpen` open/close state；保留 `workspaceView` 作为 Diff/File 当前视图单源。
4. 删除 `workspaceResizer` 横向 resizer；右栏宽度继续由现有 `rightPaneResizer` / `sectionsWidth` 管理。
5. `RightPanelTab` 改为 `"plan" | "evaluation" | "changes" | "preview"`。
6. `nextTabForPreviewResolution()` 从 `evaluation` 自动切 `preview`，不再引用 `inspector`。
7. Board/Interaction/Delivery 挂入 `evaluation`。
8. FilesSection/ChangesPanel 和 WorkspacePanel 挂入 `changes`。
9. `workflow` / `inspector` 的右栏 tab 字面量归零；业务域名里的 workflow 文案和类型保持不误删。

测试：

- 更新 `frontend-preview.test.ts`，覆盖 `evaluation -> preview` 自动切换。
- 更新 `delivery-panel-mount.test.ts`，断言新 tab 类型与挂点。
- 新增 `layout-shell.test.ts`
  - `panel-body` 有 sidebar/chat/sections 三列。
  - `solidWorkspaceMount` 不在 `chatSection` 内。
  - 无 `workspace-mount[hidden]`。
  - 无 `btnWorkspaceToggle` / `workspaceResizer`。

### Phase C - TaskStatusHeader 与顶部信息归位

状态：已实施。代码提交范围包括把 `#solidTaskStatusMount` 从 `.chat-header` 迁入 `.titlebar-utility`、`TaskStatusHeader` 改用 titlebar chip 样式、删除 chat 专用状态样式，并在 `layout-shell.test.ts` 中锁定唯一挂载点。

文件：

- `packages/overlay/src/index.html`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/components/TaskStatusHeader.tsx`
- `packages/overlay/src/components/TitlebarStatusCluster.tsx`
- `packages/overlay/src/components/TaskDirBar.tsx`

动作：

1. 不使用当前未挂载的 `TopBar.tsx` 作为目标。
2. 删除 `.chat-header` 内 `#solidTaskStatusMount`。
3. 在 titlebar utility 区新增 `#solidTaskStatusMount`，靠近 `solidTitlebarStatus`。
4. `main.tsx` 继续只挂载一个 `TaskStatusHeader` root。
5. `TaskDirBar` 仍由左列 workspace/cwd 区承载；若迁移到 sidebar 底部，必须先新增明确挂点并删除旧挂点。

测试：

- `layout-shell.test.ts`
  - `.chat-header #solidTaskStatusMount` 不存在。
  - `.titlebar-utility #solidTaskStatusMount` 存在。
  - `main.tsx` 只出现一次 `render(() => <TaskStatusHeader />...)`。

### Phase D - Card / Conversation 视觉降噪

文件：

- `packages/overlay/src/styles/card.css`
- `packages/overlay/src/styles.css`
- `packages/overlay/src/components/Card.tsx`
- `packages/overlay/test/card-visual.test.ts`

动作：

1. 消息卡删除 `border-left`，靠 `data-role` 背景洗和标题/meta 区分。
2. 顶层 agent/step/goal 卡删除 stage 左边条；使用 `data-role` 的低饱和背景、标题色和 badge。
3. Reasoning 块移除 uppercase 与硬 border，使用 `--ui-font-meta`、`--status-info`、`--text-muted`。
4. badge 去掉 inset 噪声，使用 token shadow/background。
5. padding 使用 `--ui-card-padding-*` 和 `--ui-gap-*`，不引入 `--space-*`。

测试：

- 四种 role 卡片都无 `border-left`。
- `card.css` 无 `--card-stage`。
- reasoning 样式无 `text-transform: uppercase`。
- badge 无 `inset` shadow。

### Phase E - Composer 悬浮单卡

文件：

- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/components/ExecutorSelector.tsx`
- `packages/overlay/src/styles.css`
- `packages/overlay/test/composer.test.ts`
- `packages/overlay/test/titlebar-menubar.test.ts`

动作：

1. `.chat-icon-col` 重命名为 `.chat-actions-row`，所有测试同步更新。
2. actions 改横排，按钮尺寸使用 `--ui-chat-send-size` 或新增单源 `--ui-icon-btn-size`。
3. 删除 `.chat-compose-meta` 容器；`ExecutorSelector` 进入 `.chat-compose-row` leading slot。
4. `chat.tip` 若不再显示，必须删除 locale key；若仍需要，放入可访问 title/aria，不新增视觉说明文本。
5. `.chat-input` 使用 `--panel-radius` / `--shadow-float` / `--surface-*`；删除重复 border。
6. 删除 textarea 的 accent caret override。

测试：

- `.chat-compose-meta` grep 0 命中。
- `.chat-actions-row` 存在且横排。
- `ExecutorSelector` 是 `.chat-compose-row` 子节点。
- 单行 composer 高度 < 80px。
- `titlebar-menubar.test.ts` 中旧 `.chat-icon-col` 断言同步迁移。

### Phase F - Panel 去模态与轮询可见性

本阶段只处理右栏相关面板。设置页 MemoryPanel 和全局 LogViewer 不属于右栏，不能混入本阶段。

#### F1. ChangesPanel 性能不回退

文件：

- `packages/overlay/src/components/ChangesPanel.tsx`
- `packages/overlay/src/styles.css`
- `packages/overlay/test/changes-panel.test.ts`

动作：

1. 保留 chunk 常驻挂载策略，不改成 `<Show>` 销毁/重建列表。
2. 将滚动容器按 group 记录 `scrollTop` 到 `Map<groupId, number>`。
3. tab 切换前保存旧 group scrollTop，切换后恢复新 group scrollTop。
4. 行级 `change-status` badge 删除；状态汇总只保留在 tab 或 group header。

测试：

- 切换 group 后再切回，scrollTop 恢复。
- row 内无 `.change-status`。
- `.changes-list-chunk` 仍常驻，未使用 `<Show>` 包住每个 group chunk。

#### F2. DiffView skip 行可展开

文件：

- `packages/overlay/src/components/DiffView.tsx`
- `packages/overlay/src/styles.css`
- `packages/overlay/test/diff-view.test.ts`

动作：

1. 保留现有 `collapseDiffOps()` LCS 折叠逻辑。
2. 将 `skip` 行渲染为 button：`N unchanged lines`。
3. 点击后展开该 skip 对应的上下文块；展开状态只属于当前 DiffView 实例。

测试：

- 大于 8 行 context 默认折叠。
- skip button 可展开。
- 展开后原始行号连续。

#### F3. TracePanel 可见性

文件：

- `packages/overlay/src/components/TracePanel.tsx`
- `packages/overlay/src/components/Card.tsx`
- `packages/overlay/test/trace-panel.test.ts`

动作：

1. `TracePanel` 接受可选 `isVisible?: () => boolean`。
2. `Card.tsx` 挂载的 TracePanel 传 `isVisible={() => traceOpen() && expanded()}`。
3. 轮询同时满足 `isVisible()`、`hasTarget()`、`!document.hidden`。
4. 不移除 `document.hidden`，因为它仍是窗口级省电信号；新增的是组件级可见性。

测试：

- `isVisible=false` 时不 fetch。
- `document.hidden=true` 时不 fetch。
- 展开后恢复轮询。

#### F4. MemoryPanel / LogViewer 后续独立方案

MemoryPanel 和 LogViewer 当前不属于右栏。若要去模态，需要另开方案：

- MemoryPanel：先决定是否从设置页迁入右栏；否则只做设置页内联展开。
- LogViewer：先决定是否新增 Diagnostics tab；否则保留全局 dialog。

本方案不删除 `MemoryDetailDialog` 和 `LogViewer <dialog>`，避免把不属于右栏的改动混进 UI 三列重构。

## 3. 落地顺序

```
A token/role -> B IA/layout -> C task status -> D cards -> E composer -> F panels
```

每个 phase 独立 commit + push。任何 phase 未通过对应测试，不进入下一 phase。

实施每个 phase 前必须：

1. `git pull --rebase` 同步远端。
2. `rg` 对本 phase 的旧命名、挂点、组件做全仓调用点核对。
3. 更新本文件的完成标记和新发现调用点。

## 4. 不变量

- [x] 不存在 `--card-stage-*` / inline `--card-stage`。
- [x] `!important` <= 30。
- [x] 不存在 `workspace-mount[hidden]`。
- [x] `solidWorkspaceMount` 不在 `chatSection` 内。
- [x] `RightPanelTab` 只包含 `plan / evaluation / changes / preview`。
- [x] 代码中无 `inspector` / `workflow` UI tab 字面量。
- [x] TaskStatusHeader 只有一个挂载点，且不在 chat header。
- [ ] 无 `.chat-compose-meta` / `.chat-icon-col`。
- [ ] ChangesPanel tab 切换不销毁 group chunk。
- [ ] MemoryPanel / LogViewer 不在本方案中误删。
- [x] Phase A / Phase B 新增和修改行为有测试。

## 5. 风险与拦截

| 风险 | 拦截 |
|---|---|
| 新增 `--space-*` 导致 token 双源 | A 阶段测试 grep 禁止 `--space-` / `--fs-` 新 token |
| 删除未知 stage 哈希导致信息丢失 | role 只影响视觉；stage 文本继续显示在 title/meta |
| Preview 被 IA 重命名误删 | B 阶段更新 `frontend-preview.test.ts`，保留 `preview` tab 或唯一子面板 |
| ChangesPanel 从常驻 chunk 改成 `<Show>` 后性能退化 | F1 测试断言 chunk 常驻 |
| TaskStatus 挂到未使用 TopBar | C 阶段明确使用 titlebar utility，不依赖未挂载 TopBar |
| 去模态范围扩大误伤设置页/全局日志 | F4 明确拆出独立方案 |

## 6. 提交规范

- Phase A：`feat(overlay): phase A token and role consolidation`
- Phase B：`feat(overlay): phase B persistent right rail IA`
- Phase C：`feat(overlay): phase C titlebar task status`
- Phase D：`feat(overlay): phase D calm card visuals`
- Phase E：`feat(overlay): phase E floating composer`
- Phase F：`feat(overlay): phase F panel visibility refinements`

不使用 `--no-verify`。pre-push hook 失败时修根因后再 push。
