# Work Ledger Hover Action Focus Release

## Recall

| Item                    | Evidence                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement        | 左侧任务栏的 Pin 与 Archive 按钮只能在鼠标 hover 时展示；点击后鼠标离开且不点击其他区域时，按钮也必须隐藏。                                                                                                                                                                                                                                                                         |
| Acceptance criteria     | 指针进入行时 Pin/Archive 显示；点击 Pin 后指针离开该行，即使焦点仍停在按钮上，操作区、标题让位和 spinner 替换都恢复静止态；显式键盘 ArrowRight 打开的操作区仍可见并可通过 Escape/ArrowLeft 关闭；真实桌面页面完成点击、移出和键盘路径截图人工复核。                                                                                                                                 |
| Hard constraints        | 桌面端单端修复；保留并行改动；不以 `blur()`、点击状态、fallback、第二状态源或 gate 掩盖问题；不新增、修改或运行 User Interface（UI，用户界面）自动化测试；提交主题使用 `dsw-33987` 前缀并推送当前交付分支到 `legacy-remote`。                                                                                                                                                             |
| Read material           | 用户截图；`AGENTS.md`；`2026-08-03-unified-list-interaction-design.md`；`2026-08-03-unified-list-interaction-implementation-plan.md`；`2026-08-04-work-ledger-single-trailing-slot.md`；当前 `WorkLedger.tsx`、`useTaskRowActionsKeyboard.ts` 与 `work-ledger.css`。                                                                                                                |
| Whole-repository search | `WorkLedgerRowView` 是 Mission、Chat、Task 与 Mission child Task 的唯一 action DOM owner；`useTaskRowActionsKeyboard` 是 `data-actions-keyboard-open` 的唯一 owner；`work-ledger.css` 的三组 `.work-row:is(:hover, :focus-within)` 分别控制 action rail/body padding、spinner opacity 与每个 action button opacity/pointer-events。没有第二个 Work Ledger action visibility owner。 |
| Independent feedback    | 只读子 Session 返回 terminal-success 会话证据但没有文本结论。按规则调用 Claude Code 2.1.147，只开放 Read/Grep/Glob；本机未登录，返回 `authentication_failed` / `Not logged in`，没有产生可用审查结论。当前 Agent 已独立核对浏览器焦点语义、全部选择器与键盘路径。                                                                                                                   |

## Proven cause

1. Pin/Archive 都是原生 button。鼠标点击后，浏览器将焦点保留在被点击按钮上，直到焦点被显式移动或元素卸载。
2. `.work-row:is(:hover, :focus-within)` 同时控制 action rail、标题让位、spinner 隐藏和每个 action button 的可见性。
3. 指针离开只会结束 `:hover`；被点击按钮仍是行内焦点，因此 `:focus-within` 持续命中，整组操作视觉保持 hover 态。
4. 这不是 Pin/Archive 异步业务状态、selected row 或 `data-pinned` 导致；`data-pinned` 只改变 Pin 颜色。
5. 键盘可达性不需要通用 `:focus-within` 承担。主按钮按 ArrowRight 后，`useTaskRowActionsKeyboard` 会设置唯一显式事实 `data-actions-keyboard-open="true"`、开放 action tabIndex 并聚焦首个按钮；Escape/ArrowLeft 和 focusout 会关闭该事实。

## Call-site disposition

| Owner                                       | Current role                                                          | Disposition                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `WorkLedgerRowView`                         | 渲染所有 Work Ledger row actions 并连接 Pin/Archive 业务回调          | 保持不变；不在点击处理器中手工 blur，不创建第二状态源。                               |
| `useTaskRowActionsKeyboard`                 | ArrowRight 打开、Escape/ArrowLeft 关闭、focusout 收口键盘 action 模式 | 保持不变；继续作为非 pointer action visibility 的唯一显式 owner。                     |
| `work-ledger.css` action rail/body selector | 以 hover、focus-within 或 keyboard-open 展示 rail 并给标题让位        | 删除通用 `:focus-within` 分支，只保留 `:hover` 与 `data-actions-keyboard-open`。      |
| `work-ledger.css` spinner selector          | action 可见时隐藏 active spinner                                      | 与 action rail 使用同一条件：只保留 `:hover` 与 keyboard-open。                       |
| `work-ledger.css` per-action selectors      | 让 Stop、Download、Start、Pin、Archive 获得 opacity 与 pointer events | 所有 action 一致删除通用 `:focus-within`，保留 hover 与 keyboard-open，避免局部双源。 |
| Mission child Task rows                     | 复用 `WorkLedgerRowView`                                              | 自动获得同一语义，不新增 child 特例。                                                 |

## Scoped obsolete UI tests

本次对 `work-ledger.css` 的触及路径搜索发现以下现存 UI 自动化测试；按仓库禁令删除且不运行：

- `packages/overlay/test/browser/armed-confirm-button-browser.test.ts`：内联页面、hover/click、计算样式和截图断言。
- `packages/overlay/test/browser/round11-persisted-selection-owners-browser.test.ts` 及其 `fixtures/round11-persisted-selection-owners/`：启动 Vite、驱动浏览器、断言菜单交互和截图；fixture 直接导入 `work-ledger.css`。

这些删除不改写为新的 UI 测试。Round11 的持久化行为不在本次产品代码变更范围内；本次只删除被当前路径发现的禁用测试资产。

## Implementation and verification

1. 将 action rail/body、spinner 和每个 action button 的条件从 `:is(:hover, :focus-within)` 收敛为 `:hover`，继续并列保留 `data-actions-keyboard-open="true"`。
2. 删除 scoped obsolete UI tests 与只为其服务的 fixture。
3. 运行 Overlay TypeScript、internationalization（i18n，国际化）、Vite build、文档健康和 `git diff --check` 等非 UI 检查；不运行 Overlay UI 测试。
4. 启动隔离真实页面，用真实 Work Ledger 数据点击 Pin，将指针移到行外但不点击其他位置，截图并人工确认 action rail 隐藏；再以 ArrowRight 打开 actions，确认键盘路径仍可见且 Escape/ArrowLeft 可关闭。
5. 二次审查 task-owned diff，fetch 远端，提交并推送当前交付分支到 `legacy-remote`。

## Progress

- [x] 读取用户截图、历史设计、当前 DOM/CSS、焦点逻辑与全部相关调用点。
- [x] 证明通用 `:focus-within` 是点击后残留的直接原因，显式键盘状态是正确的替代 owner。
- [x] 记录独立审查工具的认证/输出边界。
- [x] 提交并 push 实施前方案。
- [x] 修改 CSS 并删除 scoped obsolete UI tests。
- [x] 完成非 UI 检查、真实页面截图和人工视觉复核。
- [x] 完成二次 review、提交并 push。

## Validation record

- `packages/overlay`: `bun run typecheck`、`bun run check:i18n` 与 `bun run build:vite` 均通过；Vite 仅报告既有第三方 module-directive 与 large-chunk 警告。
- 文档检查通过：historical links 2/2、`bun run docs:check` 与 `git diff --check`；没有运行任何 UI 自动化测试。
- 全仓复搜确认 `packages/overlay` 内不再存在 `work-row:is(:hover, :focus-within)`、`round11-persisted-selection-owners` 或 `armed-confirm-button-browser` 引用。
- Browser Preview 两次因当前 Chat 缺少 task context 被宿主拒绝；随后按宿主要求创建的 queue 与 non-queue Task 均停留在 “ready for next scheduler decision” 且未启动 5173。两条 Task 均在确认无 listener 后显式取消并保留记录，没有用 iframe 或伪 preview target 冒充交付。
- 使用一次性 headed Node Playwright sidecar 启动精确 Vite 子进程并打开真实 `http://127.0.0.1:5173` Overlay 源页面；页面从现有 7878 后端加载真实 Work Ledger 数据。每轮 finally 均关闭 Browser、停止精确 Vite child，`netstat` 最终只有 `TIME_WAIT`，没有 5173 listener。
- 人工查看 `work-ledger-hover-action-visible.png`：当前 Chat 行 hover 时 Pin 与 Archive 同时可见，行高和相邻行位置不变。
- 人工查看 `work-ledger-pin-focused-pointer-away.png` 与 `work-ledger-archive-focused-pointer-away.png`：指针离开时两张图都恢复静止态 spinner，Pin/Archive 不可见；运行事实分别为 `focusedUi=chat-row-pin` / `chat-row-archive`、`rowFocusWithin=true`、`rowHover=false`、rail `opacity=0`、`pointer-events=none`。
- 人工查看 `work-ledger-keyboard-actions-open.png`：ArrowRight 设置 `data-actions-keyboard-open="true"` 后 rail `opacity=1`，完整操作按钮可见。聚焦 action 后按 Escape，`data-actions-keyboard-open` 清除、rail `opacity=0`，焦点回到 `ledger-row-main`；`work-ledger-keyboard-actions-closed.png` 显示恢复静止态。
