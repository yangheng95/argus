# Right Dock Panel Ownership And Browser Draft Projection

## Recall

| Item | Detail |
| --- | --- |
| User requirement | 右侧 Dock 的 tab 子标题与 Panel 内部标题形成双源；Browser 选择节点后生成的内容没有显示在输入框；Dock 无 tab 时的 “No tools open” 空态不需要。 |
| Acceptance criteria | 每个 Dock Panel 只保留 Panel 内部标题作为可见标题；Dock tab 仍可切换、关闭并通过 tooltip/ARIA 表达身份，但不再重复可见标题；Browser 节点评论写入当前 task/session 的 canonical composer draft 后，同一 draft key 下已挂载的 textarea 立即显示完整节点上下文；关闭最后一个 tab 直接收起 Dock，空态 DOM、样式和 i18n 被删除；真实桌面交互与截图通过。 |
| Hard constraints | 不增加 header/title/draft 第二来源，不扫描 DOM，不新增本地 signal 或 query override，不保留空态 fallback，不触碰正在运行的 Overlay，不创建 worktree，不覆盖工作区中并发的 composer/runtime-control 修改；Windows Playwright 只由 Node 启动，超时按无活动重置。 |
| Sources read | `AGENTS.md`; Browser 与 benchmark-debug skills；`specs/current/architecture/07-panel.md`; `2026-07-02-right-toolbar-task-scope-panels.md`; `2026-07-13-right-dock-native-menu-render-stall.md`; `2026-07-14-right-dock-header-height-and-seam.md`; Browser selection sync/unmounted/selected-target records；当前 `RightDock`、`BrowserPreviewPanel`、`ChatComposer`、composer draft store、main wiring、workspace CSS、i18n 和测试。 |
| Whole-repository search evidence | `RightDock` 仅由 `main.tsx` 挂载；完整 tab label 由 `RightDock.tsx` 与 `.right-dock-tab__label` 唯一渲染，Panel 内部各自已有 canonical header；`right-dock-empty` 仅存在于 `RightDock.tsx`、workspace CSS 与两组 locale key；关闭 tab 唯一入口是 `main.tsx` 的 `onClose`。Browser guest comment 唯一路径是 `takeNativeSelection -> applyGuestNodeComment -> onCommentDraft -> setComposerDraft`；draft store 是 reactive createStore，但 `ChatComposer` 的 effect 在相同 key 时提前返回，因而没有订阅该 key 的外部 text 更新。 |
| Independent agent feedback | None；用户未要求子 Agent，当前运行约束禁止自行委托。 |

## Root Cause

Dock 的 tab strip 从“面板切换器”膨胀成了第二个标题栏：tab 同时显示图标、完整标题和关闭按钮，而 Panel 自身仍按既有架构拥有标题。最后一个 tab 关闭只修改 panel list，没有同步关闭 Dock，因此又暴露一套与 “+” 菜单重复的空态工具目录。

Browser picker 已经返回正确 selection/comment，也已经把格式化文本写入 canonical scoped draft store。断点发生在消费者：`ChatComposer` 的 draft effect 只把 key 当依赖，首次加载后在读取 `composerDraftText(key)` 之前提前返回，所以同 key 的 store 更新不会进入 textarea。

## Design And Call-Site Disposition

| Surface | Disposition |
| --- | --- |
| `RightDock.tsx` | tab 保留 icon、tooltip、ARIA、active、close 和 overflow 语义，删除可见 label；删除无 tab 空态 DOM。 |
| `workspace.css` | 把 tab 收敛成图标导航尺寸，删除 label 与空态规则。 |
| `main.tsx` | 新增唯一的 close handler；关闭最后一个非-conversation panel 时同步收起 Dock。Browser comment 继续只写 canonical scoped draft。 |
| `ChatComposer.tsx` | draft effect 在同一个 key 下订阅 store text；只有 store text 与本地 text 不同时才写 textarea。 |
| locales | 删除不再有调用点的 `right_dock.empty_title/sub`。 |
| focused tests | 锁定 title ownership、last-tab close、空态删除和 draft store reactive projection。 |
| real browser benchmark | 模拟真实 native selection comment result，点击 picker，断言 textarea 显示节点上下文；截图检查 icon-only Dock chrome 与 Panel 内部标题；关闭最后一个 tab 后 Dock 消失且没有空态。 |

## Benchmark

- Input: isolated desktop Overlay fixture with one task-scoped Browser Preview target and a mocked native guest selection/comment result.
- Output: node comment appears in the mounted composer textarea under the same draft key; Dock chrome contains icon tabs without duplicate visible titles; closing the last tab hides the Dock.
- Environment: Windows host source, repository Vite build, Node browser runner, task-scoped backend fixture; no running Overlay interaction.
- Timeout: the existing activity-reset browser runner timeout.
- Pass criteria: focused source/store tests, Overlay typecheck and i18n, real picker-to-textarea assertion, last-tab close assertion, task-scoped screenshot inspection, diff review, selective commit, legacy remote push.

## Progress

- [x] Recall landed decisions and enumerate all call sites.
- [x] Implement single-source ownership and reactive draft projection.
- [x] Run focused and real-browser benchmark.
- [x] Inspect screenshot and complete second review.
- [x] Selectively commit and push.

## Verification Result

- PASS: 12 focused Dock ownership, composer draft, Browser Preview contract,
  and workspace continuity tests (232 assertions).
- PASS: Overlay TypeScript and bilingual i18n checks.
- PASS: production Vite build (2511 modules).
- PASS: Node-driven real browser fixture opens Browser through the canonical
  Dock “+” native menu, consumes a real-shaped native selection comment, and
  verifies the mounted composer contains its comment, Node, Source, URL, and
  region fields under the unchanged task draft key.
- PASS: the same fixture verifies no visible `.right-dock-tab__label`, no
  `.right-dock-empty`, and closing the only Browser tab hides `#rightDock`.
- Visual review PASS:
  `.scratch/right-dock-browser-selection-composer-draft.png` shows a compact
  icon-only Dock tab and the complete selected-node context in the composer.
  `.scratch/right-dock-last-tab-closed.png` shows the conversation expanding
  into the released space with no empty Dock residue.
- The first attempted real-browser run correctly exposed an obsolete stress
  fixture that still used the retired side-activity button and refresh-evidence
  control. That file was left unchanged; current behavior is covered through
  the active Dock/header fixture instead of weakening production behavior.

## Second Review

- Panel components remain the only visible title owners. Dock icons retain
  tab semantics, accessible names, native tooltips, active state, close, and
  overflow handling without repeating title text.
- Browser selection still flows through the native guest result and the single
  scoped composer draft store. The repair only reconnects the mounted consumer
  to same-key store writes; it adds no signal, DOM scan, or alternate draft.
- Closing a tab still uses the existing panel-close path. The new Dock wrapper
  only observes the resulting canonical panel list and hides the Dock when no
  non-conversation panel remains.
- The user explicitly rejected the empty Dock surface, so its DOM, CSS, locale
  strings, and stale `rightDockEmpty` updater were deleted together rather
  than retained as dead or compatibility code.

## Delivery Result

- Implementation commit: `69e08f5b04` (`dsw-33987 unify right dock panel ownership`).
- The `legacy-remote/v0.0.3beta` remote was verified at the same commit after the
  pre-push SDK import, AI runtime, 11-package typecheck, route inventory,
  documentation, Overlay i18n, and secret-scan checks passed.
