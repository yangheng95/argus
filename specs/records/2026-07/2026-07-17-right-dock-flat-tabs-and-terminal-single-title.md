# Right Dock Flat Tabs And Terminal Single Title

## Recall

| Item | Detail |
| --- | --- |
| User requirement | “这个标题按钮也太丑了；参考codex实现；终端也不需要二级标题（参考codex）”。 |
| Acceptance criteria | Right Dock 的一级工具标签不再呈现大块选中按钮底色，而以 Codex 风格的透明标题、清晰文字层级和克制的活动指示表达选择；Terminal 打开后直接进入 xterm 画布，不再渲染 `Windows PowerShell` 会话标题栏、二级标签按钮、二级关闭按钮或二级新增按钮；一级标签仍保留切换、关闭、溢出、键盘焦点和无障碍名称；真实桌面页面截图经人工查看通过。 |
| Hard constraints | 保持 Right Dock 为唯一可见工具标题来源；保持官方 `@xterm/xterm`、现有 `/pty`、`HostTransport` 和项目目录为唯一终端渲染/进程/流来源；不新增 iframe、production mock、query/local signal 预览覆盖、第二套终端、fallback、兼容层、gate 或移动端范围；Playwright 只能由 Node 启动；不得重启或干预用户正在运行的 OpenCorvus/Overlay；保留工作区中与左栏、阴影和 scrollbar 相关的并发改动。 |
| Sources read | `AGENTS.md`; Browser control skill; user screenshot; official OpenAI Codex product/help search results; `specs/current/architecture/07-panel.md`; `2026-07-14-right-dock-panel-ownership-and-browser-draft.md`; `2026-07-15-right-dock-embedded-terminal.md`; `2026-07-16-terminal-reference-visual-parity.md`; `2026-07-16-review-changes-and-empty-dock-alignment.md`; `2026-07-17-overlay-primitive-system-convergence.md`; current `RightDock.tsx`, `TerminalPanel.tsx`, Tabs primitive, workspace/terminal CSS, focused tests, and Node browser fixture. |
| Whole-repository grep | `RightDock.tsx` 是 `.right-dock-tab`、可见一级 label、tab close、全局 add/close 与 overflow 的唯一 DOM owner；`workspace.css` 是这些一级标签布局的唯一 surface owner，当前注释声明 underline/quiet chrome 但未覆盖 Tabs primitive 的 selected background；`TerminalPanel.tsx` 是 `.terminal-panel__toolbar`、session tab/close/add 与 xterm mount 的唯一 DOM owner；`terminal.css` 是二级栏唯一视觉 owner；`terminal-panel.test.ts` 与 `browser/terminal-reference-visual-browser.test.ts` 明确把二级栏固定为旧验收；`main.tsx` 是 Terminal 唯一 mount；`services/terminal.ts` 与后端 PTY owner 无需改变。 |
| Independent agent feedback | None. 用户未要求子 Agent，当前协作约束禁止主动委托。 |
| Git baseline | 当前交付分支为 `work-v0.0.8beta-yr-0717`，任务开始时 `HEAD`/`legacy-remote` 均为 `eda14ccbe`。工作区已有其他 owner 的左栏宽度、workspace shadow、scrollbar、相关测试和 spec/index 改动；本任务只修改独立组件/测试文件以及 `workspace.css` 的 Right Dock tab 区块，并选择性提交本任务 hunk。 |

## Root Cause

可观察现象不是字体或单个圆角问题，而是层级 owner 重复：一级
Right Dock 标签直接继承共享 Tabs primitive 的 selected fill，变成一块
高对比按钮；Terminal 内部随后又渲染一套同样的 session tab strip，
所以用户看到 `Terminal` 与 `Windows PowerShell` 两层连续的标题按钮。

直接触发点是 `.right-dock-tab` 没有落实 `workspace.css` 注释中已经声明的
“quiet chrome, underline active state”，以及 Terminal parity 记录/测试主动
要求 session strip 几何。深层原因是上一次 parity 把参考截图中的终端会话
管理 chrome 当成交付目标，而没有继续遵守 Right Dock 的单标题 owner。
因此本次不能再调浅两个背景色；必须删除 Terminal 二级标题 DOM/CSS/test
契约，并让一级标签在 Right Dock surface 边界覆盖共享 primitive 的块状
selected fill。

## Call-Site Disposition

| Surface | Disposition |
| --- | --- |
| `RightDock.tsx` | 保留 canonical Tabs、可见 label、tab close、overflow、全局 add/close 与所有交互；不增加第二种 tab 组件。 |
| `workspace.css` Right Dock tab rules | 在现有 surface owner 内实现透明 resting/selected background、克制的 active underline、清晰 hover/focus 与 close 几何；不修改共享 Tabs primitive，以免波及 Settings/Terminal 之外消费者。 |
| `TerminalPanel.tsx` | 删除二级 `Tabs/TabList/Tab`、session toolbar、session title/close/add DOM 及其死代码；保留单一 xterm mount、默认 profile 自动创建、已有 session reconnect、stream/input/resize/theme/cleanup。 |
| `terminal.css` | 删除 toolbar/session/add/menu 规则，将 panel 改成单行满高 xterm canvas；loading/empty/error overlay 从画布顶边计算，不保留 52px 二级栏空洞。 |
| `terminal-panel.test.ts` | 把旧 session-tab/52px-toolbar 契约替换为“无二级标题 + 直接画布 + PTY/xterm 生命周期不变”契约。 |
| `right-dock-panel-ownership.test.ts` / workspace visual contract | 固定一级标签透明 selected fill 与 active indicator，防止再次退化为大块按钮。 |
| `terminal-reference-visual-browser.test.ts` | 继续从真实 built Overlay、真实可见 Dock 流程与 project-scoped PTY evidence 打开 Terminal；删除二级 toolbar/menu 断言，改为断言二级 DOM 缺席、画布与 Dock header 直接相邻、一级标签背景透明/活动指示可见、终端输出与键盘输入可用，并生成新截图。 |
| `main.tsx`, terminal service, `/pty`, generated SDK/docs | 保持不变，继续作为唯一 mount、stream 和 backend contract owner。 |

## Implementation And Verification Plan

1. 先提交并 push 本 Recall，形成改动前历史基线。
2. 删除 Terminal 二级标题 DOM/CSS/dead imports，落实一级 Dock flat-tab 样式。
3. 同步修改 focused tests 与真实 Node browser fixture，使旧双层标题不能回归。
4. 运行 focused Bun tests、Overlay typecheck/i18n、production Vite build、历史文档链接与相关 document-health 检查。
5. 通过 Node 启动隔离 browser fixture；查看当前 task-scoped Right Dock/Terminal 截图，按视觉反馈修改并重跑，绝不刷新正在运行的 Overlay。
6. 二次 review 全部 diff 与全仓 grep，更新本记录的结果，选择性 commit 本任务文件/hunk，并 push `legacy-remote`。

## Progress

- [x] 读取规则、参考证据、历史方案和真实实现。
- [x] 完成全仓调用点/旧契约枚举与根因分析。
- [x] Recall commit/push（`cf5bb04b2`）。
- [x] 实现单层标题与 flat Dock tab。
- [x] focused/build/browser/visual 验收。
- [x] 二次 review。
- [x] 最终 implementation commit/push（`a564fca92`）。

## Implementation Result

- Right Dock 继续使用唯一 `Tabs` primitive 和原有 panel catalog，但
  `.right-dock-tab` 在自己的 surface boundary 内固定透明背景、400 字重、
  14px control 字号，并以 2px 文字色细线表达 active；hover 不再把标题
  重新涂成灰色按钮块。
- Terminal 删除了二级 Kobalte Tabs、session title、session close、session
  add/profile menu 及对应 dead signal/import/CSS/i18n。打开 panel 时直接挂载
  唯一 xterm viewport；已有 PTY 会话仍 reconnect，空项目仍按默认 profile
  自动创建，stream/input/resize/theme/cleanup 路径未改变。
- `tabs-primitive.test.ts` 现在与 Review 的单标题规则一致：真正需要多页面
  navigation 的 feature 仍必须使用 Tabs primitive，而 Terminal 明确断言
  不得重新引入 session tab surface。

## Visual Review

第一次真实浏览器运行证明二级 toolbar/title/tab 已完全消失、画布与 Dock
body 几何相邻，但 active tab 仍计算为 `rgb(240, 240, 240)`。直接触发点是
鼠标 hover selector 的高 specificity 改写了自定义 `--oc-tab-bg`；因此在
Right Dock surface 直接声明 `background: transparent`，没有通过调浅颜色
掩盖问题。第二次运行计算为透明背景、400 字重、2px visible indicator，
且 xterm 获得键盘焦点并把 `Get-Location` 写入 canonical PTY input。

最终亲自查看 `.scratch/terminal-reference-visual-parity.png`：一级 `Terminal`
标题为无块状底色的轻量标签，活动线清晰但克制；下方立即进入 PowerShell
输出，页面没有 `C:\\Windows\\System32` 二级标题、二级加号或第二条 toolbar；
画布横纵留白、终端字体和整高白色 surface 均正常。

## Verification Result

| Evidence | Result |
| --- | --- |
| Focused source/architecture | `bun test` on Terminal, Right Dock ownership, Tabs primitive, Overlay architecture guards, and workspace continuity: 146 passed, 0 failed, 8,432 assertions. |
| Overlay contracts | `bun run --cwd packages/overlay typecheck` and `check:i18n`: passed; four retired session-toolbar locale keys were removed from both locales. |
| Production build | `bun run --cwd packages/overlay build:vite`: passed, 2,492 modules transformed; existing large-chunk warning remains informational. |
| Real desktop behavior | `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/terminal-reference-visual-browser.test.ts`: passed through the required Node runner; real built Overlay, visible Dock launch, PTY stream, geometry, transparent active title, absent secondary DOM, focus, input, and screenshot all verified. |
| Documentation | Historical links: 21/21 passed. Product docs single-source passed. The combined document-health run passed 80/81; its one failure listed two unrelated concurrently linked but still-untracked July records (`environment-resource-visibility-and-flat-hover` and `work-ledger-tooltip-identity-path-integration`), not this tracked record. |
| Diff hygiene | Task-owned focused diff passes `git diff --check`; unrelated dirty-worktree files remain preserved. |

## Second Review

- 全仓 grep 后 production 中不存在 session-tab/toolbar/add/close/profile-menu
  双路残留；相应 locale 与 CSS 一并删除。
- `main.tsx`、`services/terminal.ts`、`/pty` 与 xterm lifecycle 保持唯一来源，
  没有 production fixture、fallback 或隐藏第二个 terminal。
- 一级 Dock 仍由 shared Tabs 提供语义、键盘、overflow 和 close；surface 只
  覆盖本区域的视觉 recipe，没有改变 Settings 等其他 Tabs consumer。
- 浏览器断言同时检查 Dock header/body、panel/body、viewport/panel 的 top 与
  height 差不超过 1px，避免仅凭局部 viewport 自洽误判满高。

## Delivery Result

- Implementation commit `a564fca92` (`dsw-33987 flatten dock tabs and terminal
  title`) 已通过 legacy remote pre-push hook 并推到
  `legacy-remote/work-v0.0.8beta-yr-0717`。
- Pre-push hook 的 repository typecheck、API route inventory、generated docs、
  Overlay i18n 与 secret scan 全部通过。
- 另一项并发 Work Ledger CSS 仍保留在共享 index/worktree 中，没有进入
  `a564fca92`；本任务没有 reset、覆盖、提交或清理该改动。
