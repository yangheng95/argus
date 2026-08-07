# Work Ledger Active Mission Child Path

## Recall

| Field                   | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request            | Mission child Task 为当前活跃任务时，其 hover/focus 抽屉会收起，导致左侧 Projects 无法持续辨认当前任务归属项目；先完成设计，随后明确要求修改该问题。                                                                                                                                                                                                                                                                                                                                                  |
| Acceptance criteria     | 当前选中的 Mission child Task 在指针和键盘焦点离开后仍可见；所属 Project 标题持续显示当前归属，即使用户主动折叠 Project；未选中的 Mission 仍默认收起并保留 hover/focus 展开；切换来源后旧路径立即恢复；不新增第二选择源、展开 signal、持久化字段、定时器或状态机。                                                                                                                                                                                                                                    |
| Hard constraints        | `boardStore.selectedSource` 保持唯一当前来源；`activeProjectDirectory()` 保持唯一 Project 归属派生；Mission 的 canonical `tasks` 数组保持唯一 child 集合；显式 Project 折叠继续由现有 presentation state 所有；不运行、新增或修改 UI 自动化测试；真实隔离页面交互、截图和人工复核是 UI 验收来源；保留无关 benchmark catalog 改动；不重启或关闭运行中的 OpenCorvus/Overlay。                                                                                                                           |
| Design records read     | `specs/current/architecture/07-panel.md`; `specs/current/architecture/07-panel-reactivity.md`; `specs/records/2026-07/2026-07-24-mission-child-task-staggered-insertion-motion.md`; `specs/records/2026-07/2026-07-24-work-ledger-child-status-and-mission-loading.md`.                                                                                                                                                                                                                               |
| Whole-repository search | 搜索了 `Mission/mission`、`selectedSource`、`activeTaskID`、`activeSessionID`、`activeProjectDirectory`、`ProjectLedgerGroup`、`createProjectLedgerGroupCollapseState`、`work-row-child-drawer`、`mission-task-disclosure`、Project/row `data-active` 的全部生产调用点和命中的现有测试。生产单一渲染链为 `main.tsx -> WorkLedger -> WorkLedgerProjectGroupView -> ProjectLedgerGroup/WorkLedgerRowView -> WorkLedgerTaskChildRow`；Project 目录来源为 `project-directory.ts`；选中来源为 `board.ts`。 |
| Independent review      | Session-local只读调查确认根因位于 selection 到 ancestor presentation 的投影缺失。Claude Code 2.1.147 只读审查按规范调用，但 CLI 返回 `Not logged in` / `authentication_failed`，`is_error=true`，因此不能计为有效审查证据且未修改工作树。                                                                                                                                                                                                                                                             |
| Worktree baseline       | 当前分支 `work-v0.0.27beta-yr-0801` 跟踪 `myhexin/work-v0.0.27beta-yr-0801`。任务开始前仅有无关的 `specs/artifacts/opencorvus-workbuddy-qoderwork-multica-codex-benchmark-catalog.md` 修改；本任务不得暂存、提交、覆盖或重写该文件。                                                                                                                                                                                                                                                                  |

## Causal chain

1. `main.tsx` 把 canonical `activeTaskID()` / `activeSessionID()` 传给 Work Ledger。
2. `WorkLedger.selected` 能正确识别 Mission 内的 child Task，child row 也正确获得 `data-active` 和 `aria-current`。
3. `.work-row-child-drawer` 在静止态固定为 `0fr` 与 `visibility:hidden`，只有 Mission shell `:hover` / `:focus-within` 才展开。
4. 指针或焦点离开后，当前 child row 的选中事实仍存在，但其祖先 drawer 把该行视觉隐藏。
5. Project 标题没有投影 canonical active directory；Project body 被显式折叠时，左侧不再保留任何当前来源归属提示。
6. 因此根因不是 Task selection 丢失，而是当前 selection 没有形成完整可见 ancestor path。

## Call-site disposition

| Owner / call site                                            | Current responsibility                                          | Change                                                                                                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `store/board.ts::boardStore.selectedSource`                  | 当前 Task/Session 的唯一身份与目录来源。                        | 保持不变，禁止增加 Work Ledger selection store。                                                                                       |
| `services/project-directory.ts::activeProjectDirectory`      | 从 selected Task/Session 派生当前 Project 目录。                | 保持不变，由 `main.tsx` 将结果作为 presentation input 传给 Work Ledger。                                                               |
| `main.tsx::<WorkLedger>`                                     | 向左侧列表传递 selected Task/Session。                          | 同步传递 canonical active Project directory。                                                                                          |
| `WorkLedger::selected`                                       | 识别 Task、Mission 与 Chat 的 exact selected row。              | 复用该函数计算 Mission 是否包含 selected child；不复制 ID 规则。                                                                       |
| `WorkLedgerProjectGroupView`                                 | 渲染 Project header、Mission/Task/Chat hierarchy。              | 比较规范化目录并向 Project header 投影 active；比较 Mission children 并向 Mission shell 投影 active descendant。                       |
| `ProjectLedgerGroup`                                         | 管理用户显式 Project 折叠和 Project header。                    | 接受派生 `active` presentation prop，在 header 上投影 `data-active` 与 `aria-current=location`；不修改 collapse state。                |
| `WorkLedgerRowView`                                          | 渲染 Mission parent、Task、Chat 和 Mission child Task。         | 接受 `activeDescendant`，只在 Mission shell 暴露标记；child row 仍是唯一 exact selected row。                                          |
| `work-ledger.css`                                            | hover/focus child drawer motion与 active navigation primitive。 | 将 `data-has-active-descendant=true` 并入现有展开选择器，复用同一 motion；Project header 复用 `.oc-navigation-row[data-active=true]`。 |
| Existing UI automation files discovered by the scoped search | 对 TSX/CSS/DOM、hover、几何、截图或渲染字符串作自动断言。       | 按当前仓库 UI 自动化测试禁令删除，不运行、不更新；不为本次 UI 修复新增替代测试。                                                       |

## Implementation

1. 给 `WorkLedger` 增加 canonical active Project directory 输入，并用现有目录 key 规范化比较。
2. 给 `ProjectLedgerGroup` 增加纯派生 `active` prop，将 active 状态放在完整 header 导航行，保留显式 collapse 行为。
3. 通过现有 `selected(task)` 判断 Mission 是否包含当前 child Task，并把结果传入 `WorkLedgerRowView`。
4. 仅在包含 selected child 的 Mission shell 上输出 `data-has-active-descendant=true`；CSS 使用 hover、focus 或 active descendant 的并集展开 drawer 和 child rows。
5. 删除本次检索已触及的 UI 自动化测试文件，不运行 UI 自动化测试。
6. 运行 Overlay typecheck、i18n check、Vite build、文档单源/健康检查和 `git diff --check`。
7. 启动隔离真实 Overlay 页面，直接交互并截图检查：选中 child 静止态、切换后旧 Mission 收回、active Project 展开态、active Project 显式折叠态。人工复核后执行第二次源码/diff 审查。

## Acceptance scenarios

### Selected Mission child

- Given 一个展开 Project 下的 Mission 含有当前 selected Task。
- When 指针和键盘焦点离开 Mission 行。
- Then drawer 保持可见，child row 保持唯一 exact active 样式，Project header 显示 active 归属。

### Selection changes

- Given 旧 Mission 因 selected child 保持展开。
- When 选择另一个 Project 的 Task、Mission、Chat 或 Work。
- Then 旧 Mission 恢复静止收起，新 Project 成为唯一 active Project。

### Explicit Project collapse

- Given 当前 Project 含 selected Mission child。
- When 用户主动折叠 Project。
- Then Project body 隐藏且用户折叠意图被保留，Project header 仍显示 active 归属；再次展开时 selected Mission path 立即可见。

### Inactive Mission

- Given Mission 不包含 selected child。
- When 既无 hover 也无 focus-within。
- Then child drawer 保持当前默认收起与动效语义。

## Verification contract

- Non-UI: Overlay typecheck, i18n check, Vite build, document-health, product-docs single source, historical links, `git diff --check`.
- UI: real isolated page interaction, screenshots bound to the Projects/Mission region, and two manual visual reviews.
- Forbidden: any UI automated test execution, source-string UI assertion, DOM assertion, screenshot baseline, fixture pass/fail script, or Playwright test run.

## Result

- `main.tsx` now passes the existing active directory projection beside the existing selected Task/Session IDs; it does not create another store.
- `WorkLedger` compares normalized Project directory keys and projects one `active` ancestor prop. The same existing `selected(row)` predicate checks every canonical Mission child, so only a Mission containing the exact selected Task receives `data-has-active-descendant="true"`.
- `ProjectLedgerGroup` projects active state onto the complete shared navigation row and exposes `aria-current="location"` on its existing toggle. Its local explicit-collapse owner is unchanged.
- `work-ledger.css` adds the active-descendant attribute to the existing hover/focus selector union. The original drawer geometry, child ordering, stagger, transition tokens, focus behavior, and reduced-motion behavior remain single-owned.
- The current architecture record now states the visible ancestor-path contract and distinguishes exact child selection from ancestor location projection.
- The scoped search exposed eight UI automation files that assert TSX/CSS/DOM, hover geometry, screenshots, or rendering. They were deleted without execution as required by the repository's UI automation prohibition: five source-string suites and three browser suites. Whole-repository references remaining after deletion are historical records of prior runs, not executable scripts or configuration.

## Verification results

- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `bun run --cwd packages/overlay build:vite`: passed; only existing module-directive and large-chunk warnings were reported.
- `bun test packages/opencorvus/test/script/document-health.test.ts`: 62 passed.
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`: 8 passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 1 passed and 1 failed. The failing canonical-catalog case reads the pre-existing, unrelated dirty `specs/artifacts/opencorvus-workbuddy-qoderwork-multica-codex-benchmark-catalog.md`; its participant table still parsed while both case arrays parsed empty. This task preserved that user/concurrent file exactly and does not relabel the failure as Work Ledger evidence.
- `git diff --check`: passed.
- Browser Preview publication was attempted once and rejected because this Chat has no Task context. No background Preview service or fabricated URL replaced it.
- A single foreground Node process served the real production build, launched headed Chromium, interacted with the canonical backend Work Ledger, captured screenshots, and closed browser and listener in `finally`. No test file, fixture, baseline, or pass/fail assertion was written.
- The first canonical page contained no Mission child. Expanding the existing progressive Projects list exposed one real Mission with two child Tasks. After selecting the first child and moving pointer/focus away, the observed production state was: Mission `data-has-active-descendant=true`; drawer `visibility=visible`; drawer height `56px`; child `data-active=true`; Project header `data-active=true`; Project toggle `aria-current=location`.
- `.scratch/work-ledger-active-mission-child-path.png` and `.scratch/work-ledger-active-mission-child-region.png` were reviewed at original resolution. The selected child remains visible beneath its Mission, only the child owns the exact selected row treatment, and the Project header simultaneously identifies the owning Project.
- Explicitly collapsing that Project produced `aria-expanded=false`, `aria-current=location`, Project-header `data-active=true`, and no `.project-group-body`. `.scratch/work-ledger-active-project-collapsed.png` was reviewed at original resolution; the folded Project retains a clear selected wash while the body is absent.
- Two intermediate locator attempts timed out after correctly capturing the selected-child state because clicking Project also invokes the existing Project selection path and invalidates a locator rooted in the prior active child. Both foreground sessions still closed Chromium and port 5187 in `finally`. Reacquiring the Project through the persistent active header completed the folded-state capture.
- A session-local read-only review was dispatched after implementation and reached terminal success, but its final report body was not returned through the parent tool result. It is retained only as a session receipt and is not claimed as an ACCEPT verdict; the primary agent completed the final call-site, diff, build, and screenshot review directly.
