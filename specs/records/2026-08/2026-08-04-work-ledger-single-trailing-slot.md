# Work Ledger Single Trailing Slot

## Recall

| Item                    | Detail                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement        | 左侧 Work Ledger 的执行中 spinner 与普通 hover 操作图标都使用行的最右侧；禁止 spinner、Pin、Archive 三个图标并排占位而让任务描述过早截断。                                                                                                                                                                                                                                            |
| Acceptance criteria     | 静止 active 行只为一个最右侧 spinner 保留空间；静止 inactive 行不为透明 action rail 保留空间；hover、focus 或键盘 action-open 时，完整 action rail 终止于同一个最右侧轴并临时覆盖 spinner，标题只为当前可见 rail 让位；行高、相邻行位置、左侧类型图标和 Mission child drawer 不移动。真实桌面页面必须覆盖 active 静止、active hover、inactive 静止与 inactive hover，截图并人工复核。 |
| Hard constraints        | 保留并行改动；桌面端单端修复；不新增、修改、更新或运行 User Interface（UI，用户界面）自动化测试；不增加 fallback、第二状态源、持久化状态或 gate；使用现有 `workLedgerPresentationStatus`、spinner、action rail 和键盘契约；提交主题使用 `dsw-33987` 前缀并推送当前交付分支到 `myhexin`。                                                                                              |
| Read material           | 用户截图；`AGENTS.md`；`specs/current/architecture/07-panel.md`；2026-08-03 Work Ledger spinner、pointer jitter、density/mission expansion 记录；当前 `WorkLedger.tsx`、`work-ledger.css`、`sidebar.css` 与 `navigation-row.css`。                                                                                                                                                    |
| Whole-repository search | `WorkLedgerRowView` 是 Mission、Chat、Task 与 Mission child Task 的唯一 spinner/action DOM owner；`work-ledger.css` 是 `data-action-count`、spinner、action rail 和标题让位的唯一局部几何 owner；`sidebar.css` 的 `.task-row-right` 默认参与第三列；`useTaskRowActionsKeyboard.ts` 只负责 action focus，不拥有几何；其他 `.task-row-right` 消费者不受 Work Ledger 局部覆盖影响。      |
| Independent feedback    | 已启动一个只读子 Agent 调查相同范围，但工具只返回 terminal-success Session 证据而未返回可用文本结论。随后按规则调用 Claude Code 2.1.147，只开放 Read/Grep/Glob；CLI 因本机未登录返回 `authentication_failed` / `Not logged in`，未产生审查结论。当前 Agent 已逐项复核 DOM、grid/absolute containing block、选择器特异性及全部调用点；外部认证阻塞不伪装为通过。                       |

## Proven cause

1. `.work-row` 使用三列 grid，`.work-row-right` 继承 `.task-row-right` 的第三列身份。
2. active spinner 在 `.work-row-right` 内保持文档流宽度，因此它占据第三列；action rail 则相对整行绝对定位到更靠右的尾部。
3. hover 时 spinner 只淡出，第三列仍保留 spinner 宽度；标题另按 `action rail width - spinner width` 增加 padding，形成两个并列尾部几何来源。
4. 结果是 spinner 的绘制轴早于 action rail 的最右侧轴，active 行长期损失 spinner 列、列间距及右侧 rail 的组合宽度，截图中的标题因此明显缩短。

## Call-site disposition

| Owner                                    | Current role                                                           | Disposition                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `WorkLedgerRowView`                      | 为所有 Work Ledger item 生成 `.work-row-right`、spinner 与 action rail | 保留一个 DOM owner 和现有状态/动作语义；不拆分渲染路径。                  |
| `WorkLedgerTaskChildRow`                 | 复用 `WorkLedgerRowView`                                               | 自动获得相同尾部几何，不新增 child 特例。                                 |
| `work-ledger.css .work-row-right`        | 当前继承第三列并让 spinner 参与文档流                                  | 改为整行最右侧的绝对定位 overlay owner，退出 grid 布局。                  |
| `work-ledger.css .work-row-loading-icon` | 当前作为 in-flow flex item                                             | 绝对锚定到 overlay owner 的最右侧，保持固定尺寸和 spin。                  |
| `work-ledger.css .work-row-actions`      | 当前独立绝对定位                                                       | 收敛到同一 overlay owner 的最右侧，宽度仍由 canonical action count 决定。 |
| `work-ledger.css .work-row-body`         | hover 时只补偿 rail 与 spinner 的宽度差                                | active 静止只为单 spinner 让位；action-visible 时为完整 rail 让位。       |
| `sidebar.css .task-row-right`            | 其他 Task list 的通用第三列 owner                                      | 保持不变；只由 Work Ledger 高特异性选择器覆盖。                           |
| `useTaskRowActionsKeyboard.ts`           | ArrowRight/Escape 与按钮 focus                                         | 保持不变；新布局继续呈现相同 action buttons。                             |

## Scoped obsolete UI tests

- `packages/overlay/test/left-dock-typography.test.ts` 读取 Cascading Style Sheets（CSS，层叠样式表）源码并断言渲染字体规则，属于禁止保留的 UI 自动化测试。
- `packages/overlay/test/icon-affordance-visibility.test.ts` 读取 CSS / HyperText Markup Language（HTML，超文本标记语言）/ TypeScript XML（TSX）源码并断言图标显隐与 hover 表现，属于禁止保留的 UI 自动化测试。
- 两者在本次 touched-path 搜索中被发现，只删除，不运行、不更新，也不新增替代 UI 测试。

## Implementation and verification

1. 让 `.work-row-right` 成为唯一绝对尾部 owner，并把 spinner/action rail 都锚定到其 inline end。
2. 让 active 静止行只保留单图标宽度；action 可见状态按完整 rail 宽度压缩标题，不改变行外几何。
3. 更新当前 Panel 架构，明确 spinner 与 action rail 共用同一 far-edge slot。
4. 删除本次发现的两份旧 UI 自动化测试。
5. 运行 formatter、Overlay TypeScript、internationalization（i18n，国际化）、Vite build、文档健康和 `git diff --check` 等非 UI 检查；不运行 Overlay UI 测试。
6. 启动隔离真实页面，用真实 Work Ledger 数据检查 active/inactive 的静止和 hover/focus 组合，截图并人工复核。
7. 二次审查 task-owned diff，fetch 远端，提交并推送当前交付分支到 `myhexin`。

## Progress

- [x] 读取用户截图、当前架构、历史记录、DOM、CSS 和全部相关调用点。
- [x] 完成当前 Agent 方案挑战；记录 Claude Code 外部认证阻塞。
- [x] 提交、push 实施前方案。
- [x] 实现单一最右侧 slot，随后按用户指令精确撤回该实现；scoped obsolete UI tests 继续遵守仓库禁令，不予恢复。
- [x] 完成静态、构建、真实页面截图和人工视觉复核。
- [x] 完成二次 review。
- [x] 提交并 push 回退记录。

## Rollback

- 2026-08-04 用户确认该问题已由新版本修改，要求先回退本次代码。
- 精确撤回 `work-ledger.css` 中两列 grid、绝对定位 `.work-row-right`、spinner/action 共用尾部 owner、active/inactive body padding 规则及 spinner 定位变更；恢复实施前样式。
- 精确撤回 `specs/current/architecture/07-panel.md` 中随该实现增加的 single far-edge owner 描述。
- 保留并行 Mission pointer-within、Titlebar、Environment 与其他任务改动，不使用 `git reset`、`git checkout --` 或整文件覆盖。
- 不恢复本次触及范围发现并删除的旧 UI 自动化测试；恢复它们会直接违反当前仓库 UI 自动化测试禁令。
- 回退后 headed Playwright 复核真实页面：active 行仍为 `224×26`，`.work-row-right` 与 spinner 恢复为 `18px` 宽的 static 第三列，body 恢复为 `163px`；hover 后 body 保持该宽度并增加 `44px` padding，绝对 action rail 显示而 spinner 淡出。人工查看 `work-ledger-trailing-slot-rollback-rest.png` 与 `work-ledger-trailing-slot-rollback-hover.png`，确认页面已恢复实施前的短标题与三图标 hover 视觉。
- 回退后的 Overlay typecheck 与 Vite production build 通过；历史链接、产品文档单源和 document health 在显式 30 秒超时下通过 70/70，`docs:check` 与 `git diff --check` 通过。默认 5 秒文档健康组合运行曾有一个纯超时，原样提高 runner timeout 后 4.10 秒完成。
- `check:i18n` 仍被并行 Titlebar / `index.html` / `native-menu.html` 修改中的 locale revision 暂态阻塞；这些文件不属于本次回退，未越界修改或提交。

## Validation record

- `packages/overlay`: `bun run typecheck`、`bun run check:i18n` 与 `bun run build:vite` 均通过；Vite 仅报告既有第三方 module-directive 与 large-chunk 警告。
- 文档检查通过：historical links 2/2、product documentation single source 8/8、document health 60/60、`bun run docs:check` 与 `git diff --check`。这些是非 UI 契约；没有运行任何 UI 自动化测试。
- 本次 scoped search 发现的 `left-dock-typography.test.ts` 与 `icon-affordance-visibility.test.ts` 已删除，没有更新或运行。
- Task-owned Vite 页面运行于 `127.0.0.1:5173`，headed Node Playwright 在 1280×800 桌面 viewport 读取真实 localhost:7878 Work Ledger，共观察到 14 行、5 个 active 行和 9 个 inactive 行。
- active 静止行保持 `224×26`，body 宽 `189px` 且只保留 `18px` inline-end padding；spinner 为 `18×18`，其右边界与 `62×20` action rail 右边界同为 `261px`。hover 后行和 body 几何不变，spinner opacity 从 1 变 0，action rail opacity 从 0 变 1，body padding 精确变为 `62px`。
- inactive 静止行 body padding 为 `0px`；非 Mission inactive 行 hover 后 action rail opacity 为 1、body padding 为 `42px`，行高仍为 `26px`，action rail 右边界 `261px` 与行右边界 `262px` 保持统一一像素 inset。
- 人工查看 `work-ledger-trailing-slot-rest.png`、`work-ledger-trailing-slot-active-hover.png` 与 `work-ledger-trailing-slot-inactive-hover-sidebar.png`：静止 spinner 位于每行最右侧，标题明显使用 spinner 之前的完整宽度；hover 的 Pin/Archive 终止于同一右轴，spinner 不再与它们并排占位，相邻行没有位移。
- 预览 Task 取消后 listener 未立即释放；通过 `Get-NetTCPConnection` 证明唯一 5173 listener 是当前仓库 `vite.js --host 127.0.0.1` 的 PID 1436，随后只停止该精确 PID 并验证端口释放。用户运行中的 7878 backend / Overlay 未被重启、关闭或修改。
