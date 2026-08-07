# Work Ledger Pointer Jitter Repair

## Recall

| Item                           | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement               | 修复 Task List 内移动鼠标时图标和列表内容抖动的问题。                                                                                                                                                                                                                                                                                                                                                                                             |
| Acceptance criteria            | 指针经过 Project、Mission、Task、Chat 和 Work 行时，行高、相邻行纵向位置、标题可用宽度、运行图标占位和行尾操作区几何保持稳定；选中的 Mission child Task 继续在指针和焦点离开后保持可见；点击或键盘聚焦 Mission 行仍可临时查看其子 Task；真实桌面页面完成鼠标移动、截图和人工视觉复核。                                                                                                                                                            |
| Hard constraints               | 保留所有并行工作区改动；不新增、修改、更新或运行任何 User Interface（UI，用户界面）自动化测试；直接修复布局根因，不增加 gate、fallback、第二选择源或持久化展开状态；桌面端单端修复；提交主题使用 `dsw-33987` 前缀并推送当前主交付分支到 `legacy-remote`。                                                                                                                                                                                               |
| Sources read                   | 用户截图；仓库 `AGENTS.md`；Browser control skill；`specs/current/architecture/07-panel.md`；`specs/current/architecture/07-panel-reactivity.md`；2026-08-01 selected Mission child、2026-08-02 active Mission child path、2026-08-03 Task running spinner records；`WorkLedger.tsx`、`ProjectLedgerGroup.tsx`、`work-ledger.css`、`sidebar.css`、`navigation-row.css`、Button/Icon primitives。                                                  |
| Whole-repository grep evidence | `WorkLedgerRowView` 是 Mission drawer、运行图标和行尾 action rail 的唯一渲染 owner；`work-ledger.css` 是 drawer 高度、action rail 宽度和 spinner hover 收缩的唯一 owner；Project action icons 已在 DOM 中保留布局空间，仅切换 opacity/visibility；当前 Task row action rail 从 `width:0` 切换到按 action count 计算的宽度，spinner 同时从固定宽度收缩到零；Mission drawer 把 `:hover` 与 `:focus-within`、selected-child 混在同一个开闭选择器中。 |
| Independent agent feedback     | None. The user did not request sub-agents, and current collaboration policy forbids unrequested delegation.                                                                                                                                                                                                                                                                                                                                       |

## Cause chain

1. Mission child drawer 静止时使用 `grid-template-rows: 0fr`，但 Mission shell 一进入 `:hover` 就切换为 `1fr`。
2. Drawer 展开改变整个 Work Ledger 的纵向布局；指针下方目标随布局移动后可能离开原 hover shell，立即触发反向收起，因此形成布局反馈抖动。
3. 每一行的 action rail 静止时宽度为零，hover 时直接变为 42–122 像素；同一时刻运行 spinner 又从 18 像素收缩为零。
4. 两个相反方向的宽度变化都发生在 grid 的第三列，使标题可用宽度和图标位置在 pointer enter/leave 时重新布局。
5. Project ellipsis/New Chat actions 只切换 opacity/visibility，空间始终存在；它们不是几何变化根因。

## Implementation plan

1. Mission drawer 只由 `:focus-within` 或 canonical selected-child fact 打开，取消纯 hover 对高度的控制；同步让 disclosure chevron 只在同一打开条件下旋转。
2. Action rail 始终占用按 action count 派生的固定宽度；hover/focus 只改变按钮 opacity 和 pointer-events。
3. Spinner 在 hover/focus 时只淡出，不再改变 width、min-width、max-width 或 flex-basis。
4. 更新当前 Work Ledger 架构描述，明确 pointer hover 不得改变列表几何。
5. 删除本次 scoped search 直接发现的现存 UI 自动化文件，不运行或改写它。
6. 运行格式、TypeScript、i18n、Vite build、文档健康和 diff 检查；用真实 Overlay 页面移动鼠标、读取布局并截图人工复核，不生成可重复执行的 UI 测试文件、fixture 或 baseline。
7. 二次复核 task-owned diff，fetch 远端，提交并推送 `v0.0.29beta` 到 `legacy-remote`。

## Progress

- [x] Read current source, architecture, prior Work Ledger records, and user evidence.
- [x] Commit and push the pre-implementation plan.
- [x] Implement stable pointer geometry.
- [x] Complete static, build, real-page, and screenshot verification.
- [x] Complete final review, commit, and legacy remote push.

## Validation record

- `bun run typecheck`, `bun run check:i18n`, and `bun run build:vite` in `packages/overlay` passed. Vite emitted only the existing third-party module-directive and large-chunk warnings.
- Historical links passed 2/2, document health passed 60/60, and product-document single-source passed 8/8. These are non-UI document contracts.
- No UI automated test was added, modified, updated, or run. The scoped search directly exposed `packages/overlay/test/browser/css-token-closure-browser.test.ts`; it was deleted under the repository UI automation prohibition.
- Real desktop acceptance used the current production Overlay build and canonical backend routes against an isolated SQLite backup under `/tmp`; the isolated server's started-Task recovery reported `attempted=0`. Validation data contained one Mission, four child Tasks, and one active Task so the real running indicator and complete action rail were rendered.
- Before and after browser developer hover on the real Mission row, the row remained `224×26` at `(38,359)`, the shell remained `224×26`, the drawer remained `224×0` and hidden, the action rail remained `62×20` at `(199,362)`, the spinner remained `18×18` at `(181,363)`, and the title remained `62.59375×18.8984375` at `(110.40625,362.546875)`. Only action opacity changed from 0 to 1 and spinner opacity changed from 1 to 0.
- Clicking the Mission main row produced `focus-within=true`, a visible 110-pixel drawer, and four child rows. Selecting the active child and moving focus to the center Composer produced `focus-within=false`, `data-has-selected-child=true`, a visible 110-pixel drawer, and exactly `task:task_pointer_active` as the selected row.
- `.scratch/work-ledger-pointer-jitter-hover-desktop.png` and `.scratch/work-ledger-pointer-jitter-selected-child-desktop.png` were reviewed at a 1280×720 desktop viewport. The action icons replace the spinner without shifting the Mission or neighbouring Project rows; the selected child remains indented and visible under its neutral Mission parent.
