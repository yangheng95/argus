# Work Ledger Density and Mission Expansion Repair

## Recall

| Item | Detail |
| --- | --- |
| User requirement | 修复 `0.0.29` 左侧 Dock 的大规模 User Interface（UI，用户界面）回归：Mission 不再自动展开、行右侧出现大块空白、标题过早截断。 |
| Acceptance criteria | 静止 Project/Mission/Task/Chat 行不为透明 action rail 永久保留宽度；标题使用 spinner 之外的完整可用宽度。指针或键盘进入一行时，action rail 可见且不改变行高、相邻行位置、图标或 spinner 的尾部锚点。指针进入带 child Task 的 Mission 时 drawer 自动展开，移入 child Task 后保持展开；选中 child Task 与键盘 focus 继续保持 drawer 可见。真实桌面页面必须交互、截图并人工复核。 |
| Hard constraints | 不新增、修改、更新或运行 UI 自动化测试；不通过恢复旧的宽度动画重新引入 pointer jitter；不增加持久化展开状态、fallback、第二选择源或 gate；保留并行提交和未跟踪业务需求文档；桌面端单端修复。 |
| Read material | 根 `AGENTS.md`；Browser control Skill；`specs/current/architecture/07-panel.md`；`2026-08-03-work-ledger-pointer-jitter-repair.md`；当前 `WorkLedger.tsx`、`work-ledger.css`、`sidebar.css`、`navigation-row.css`；用户提供的 559 × 732 截图。 |
| Whole-repository grep | `WorkLedgerRowView` 是 Mission drawer、spinner 与 action rail 的唯一渲染 owner。`work-ledger.css` 是 action-count 宽度、action rail 显隐、spinner 与 drawer 展开的唯一样式 owner。`sidebar.css` 提供三列 row grid 和 `position: relative`；`navigation-row.css` 是 hover/selected surface 的唯一视觉 primitive。`4c223c3893` 同时把 action rail 改为永久宽度并从 Mission drawer 删除 `:hover`。 |
| Independent agent feedback | None. User did not request sub-agents, and current collaboration policy prohibits unrequested delegation. |

## Proven cause

1. `4c223c3893` 把 `.task-row-actions` 从静止 `width: 0` 改为始终占用按 action count 派生的 `42–122px`。
2. action rail 透明且不可点击时仍参与第三列布局，running spinner 还额外保留 `18px`，所以静止行右侧形成空白并提前截断标题。
3. 同一提交为避免 hover 改变 Mission shell 高度，从 drawer、child rows 和 disclosure chevron 的展开选择器中删除了 `:hover`，直接移除了指针自动展开语义。
4. 恢复旧的 width/flex 动画会重新制造水平 reflow；恢复旧的 drawer 选择器可以恢复交互，但必须与新的非 reflow action rail 一起真实复核。

## Design

1. action rail 使用现有 row 的 `position: relative` 作为绝对定位锚点，不再参与第三列的静止宽度计算。
2. 静止行只让真实可见的 spinner/status 占据尾部宽度；指针 hover、focus-within 或键盘 action-open 时，body 仅为当前可见 action rail 让出 inline-end 空间。该切换只影响标题可用宽度，不改变行、图标、spinner 或相邻行几何。
3. action rail 在 hover/focus/keyboard-open 时显示；running spinner 在同一交互态只改变 opacity，不改变尺寸。
4. Mission drawer、child rows 和 chevron 恢复 `:hover`，并保留 `:focus-within` 与 canonical selected-child 事实。
5. 更新当前 Panel 架构，明确“静止信息密度优先、交互控件临时占据标题尾部、列表几何保持稳定”的唯一规则。

## Verification plan

1. 运行 Overlay formatter、TypeScript typecheck、i18n check、Vite production build 与 Git diff check。
2. 运行历史文档链接、产品文档单源和 document-health 非 UI 契约检查。
3. 不运行任何 UI 自动化测试。
4. 在真实页面中分别检查静止 running Mission、hover Mission、hover child Task、键盘 focus 和 selected child：截图并人工确认标题宽度、右侧空白、action rail、spinner、drawer 和相邻行位置。
5. 二次 review task-owned diff，fetch `legacy-remote/v0.0.29beta`，提交并推送主交付分支。

## Progress

- [x] Reconstruct the regression from screenshot, Git history, current CSS owners, runtime data, and existing architecture.
- [x] Commit and push this Recall before implementation.
- [x] Implement the single-owner CSS repair and architecture update.
- [x] Complete static/build/document verification.
- [x] Complete real-page interaction, screenshots, and manual visual review.
- [x] Complete second review, commit, and legacy remote push.

## Validation record

- Overlay TypeScript typecheck, panel i18n check, and Vite production build passed. The build emitted only existing third-party module-directive and chunk-size warnings.
- Historical documentation links passed 2/2, product-document single-source passed 8/8, document health passed 60/60, and `git diff --check` passed. These are non-UI contracts; no UI automated test was run.
- Real desktop acceptance used the current production Overlay build and server routes against the isolated database copy under `.scratch/work-ledger-density-runtime-20260803`; the health response identified that exact isolated database.
- At rest, a real Mission row measured `251×26`, its title used `169.595px`, the absolutely anchored `62×20` action rail had opacity `0`, and its child drawer was hidden at height `0`. No transparent action width remained in the grid column.
- Focusing the exact Mission row kept the row height at `26`, exposed the `62×20` action rail at opacity `1`, reserved `44px` only inside the title body, and opened the real child drawer to `29px` with a visible `26px` child row. The reviewed screenshot showed the child directly below its Mission without overlap or adjacent-row corruption.
- Selecting the child Task and moving focus to the Composer exercised the canonical selected-child path on the same real page. A final selector review also aligned every action Button's `focus-within` visibility with its rail container, so hover, focus, and keyboard-open share one presentation contract.
