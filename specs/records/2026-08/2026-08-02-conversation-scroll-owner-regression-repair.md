# Conversation Scroll Owner Regression Repair

## Recall

| Item | Evidence |
| --- | --- |
| User request | “这个消息面板的会话又丢失scroll功能了”，并提供 Task `tsk_fbe4c921000157gIN6aMuOMDlt`、Session `ses_041b36dd7ffelpTQ6wbz2DJMhL` 与运行中 Overlay/数据库定位。 |
| Acceptance criteria | Chat 与 Mission 继续共用唯一 `#chatScroll`。长会话在消息区任意普通落点均可通过滚轮和键盘滚动，原生滚动条静止时可见、可拖动，并在 Composer 顶边结束；Composer 固定在消息面板底部且不覆盖滚动 viewport。真实 Overlay/隔离真实页面截图必须人工复核；不得新增、修改或运行 UI 自动化测试。 |
| Hard constraints | 桌面端 only；保留原生 scrollbar、现有 auto-follow、scroll-to-bottom、Composer 宽度 token 与 `--ui-chat-scrollbar-gutter-x`；不新增第二滚动容器、自定义 scrollbar、遮罩、gate、fallback、状态机、固定高度猜测、iframe/query override 或 worktree；不刷新、重启、终止正在运行的 OpenCorvus；保留所有并行改动。 |
| Runtime evidence | 通过 Computer Use 只读打开用户给出的 Prism Mission。面板的原生 scrollbar 仍绘制在完整 shell 高度，Composer 与 `#chatScroll` 共占一个 grid cell；滚轮从当前落点可使 transcript 上移并出现 scroll-to-bottom，说明消息数据与虚拟列表并非根因，但滚动 viewport 仍被 Composer 层覆盖，命中能力取决于层叠落点。 |
| Historical evidence | `c698301674` 使 scrollbar 常驻；`ce7cfffefc` 随后把 Composer 恢复为占据真实布局高度的 sibling，使 `#chatScroll` 获得有界高度；`b198c85dd5` 又把两者叠回一个 grid cell，并恢复 `--conversation-composer-block-size` bottom-padding 投影。当前源码仍是 `b198c85dd5` 的 full-height overlay 模型。 |
| Sources read | `AGENTS.md`；Browser 与 Computer Use skills；persistent-scrollbar memory/rollout；`specs/current/architecture/07-panel.md`；2026-07-21、07-24、07-28 conversation records；`App.tsx`、`Conversation.tsx`、`main.tsx`、`conversation.css`、`composer.css`、`workspace.css`、`base.css`；相关 Git log/blame/diffs。 |
| Whole-repository grep | `rg` 枚举 `chatScroll`、`.chat-scroll`、`.conversation-scroll-shell`、`solidChatComposer`、`conversation-composer-block-size`、`scrollbar-gutter`、`--ui-chat-scrollbar-gutter-x` 与 scroll-bottom consumers。生产 ownership 仍应是：`App.tsx` 唯一 DOM 顺序；`workspace.css` 有界高度链；`conversation.css` shell/scroll/Composer 几何；`base.css` 原生 scrollbar paint；`main.tsx` 平台 gutter 测量；`Conversation.tsx` auto-follow 与 Composer resize 通知。 |
| Independent feedback | 用户未要求独立 agent，当前协作策略禁止主动委托；由主 Agent 完成实现与二次复核。 |

## Causal chain

1. **可观察现象**：消息面板的 scrollbar 虽然仍可绘制，但滚动能力会在某些落点或会话状态下失效。
2. **直接触发点**：`#chatScroll` 与 `#solidChatComposer` 被放在 `.conversation-scroll-shell` 的同一个 grid cell；Composer 的伪元素覆盖底部区域并参与 pointer hit testing。
3. **深层原因**：`b198c85dd5` 用 Composer 高度扩大 transcript bottom padding，却没有缩短 scroll viewport。内容避让与交互 viewport 被错误建模成两个相互覆盖的 paint layer。
4. **为何旧修复没有保持**：`ce7cfffefc` 已恢复正常 sibling 布局，但下一提交为追求 full-height scrollbar 又反向恢复 overlay 模型；后续 `89d63c4fd9` 只把 `overflow-y` 改回 `scroll`，没有修复高度与命中 ownership。

## Call-site disposition

| Owner / consumer | Disposition |
| --- | --- |
| `packages/overlay/src/components/App.tsx` | 保留一个 `#chatScroll` 后接一个 `#solidChatComposer` 的现有 sibling DOM，不新增 wrapper。 |
| `packages/overlay/src/styles/surfaces/conversation.css` | 恢复 `.conversation-scroll-shell` 的 column 布局；`#chatScroll` 占剩余有界高度；Composer 占真实底部高度；删除 overlay grid、伪元素遮罩与 `--conversation-composer-block-size` padding 投影。 |
| `packages/overlay/src/components/Conversation.tsx` | Composer ResizeObserver 只通知现有 auto-scroll controller viewport 改变；删除向 scroll owner 写入 Composer 高度的第二几何来源。 |
| `packages/overlay/src/main.tsx` / `styles/cascade/base.css` | 保留原生 scrollbar gutter 测量和静止态 paint，不改平台来源。 |
| Existing UI automation tests encountered in this path | 按 2026-07-29 UI 自动化测试禁令删除直接固化 conversation scroll/Composer 几何的旧 source/browser tests；不运行这些测试，也不新增替代 UI test。 |
| Architecture/indexes | 把当前架构恢复为有界 scroll owner，并更新两级 spec index。 |

## Implementation and verification plan

1. 提交并 push 本 Recall/方案基线。
2. 恢复 `ce7cfffefc` 已验证过的单 scroll-owner sibling 几何，同时保留此后落地的 Environment 左右 inset 修正。
3. 删除本任务已触及的 conversation scroll/Composer UI 自动化测试；只运行 TypeScript、build、i18n 与 docs 等非 UI 验证。
4. 启动隔离真实 Overlay 页面并通过 Node/Browser 操作长会话，人工检查滚轮、键盘、scroll-to-bottom、Composer resize 与截图；不得把验收保存成自动化测试。
5. 检查最终 diff、重复真实页面复核，精确提交任务 owned paths 并 push `legacy-remote/v0.0.28beta`。

## Status

- [x] Recall、因果链、全仓调用面和运行中 Overlay 只读证据已记录。
- [x] 方案基线提交与 push。
- [x] 产品实现与旧 UI 自动化测试清理。
- [x] 非 UI 验证、真实页面截图与二次复核。
- [x] 最终提交与 push。

## Verification evidence

| Surface | Result |
| --- | --- |
| Scroll ownership | 隔离真实 Overlay 在用户给出的 Prism Mission 上测得 `.conversation-scroll-shell` 为 `display:flex` / `flex-direction:column`；`#chatScroll.bottom` 与 `#solidChatComposer.top` 的差值为 `0px`。Composer 高 `154px`、`position:relative`、`pointer-events:auto`，不再覆盖 scroll viewport。 |
| Real overflow | 初次真实会话测得 `#chatScroll.clientHeight=490`、`scrollHeight=1199`、有效 range `709px`、`overflow-y=scroll`；运行中消息继续增长后 range 达 `2097px` 以上，viewport 仍保持有界。 |
| Wheel and bottom control | Browser 在消息区坐标执行一次向上滚轮后，`scrollTop` 从 `709` 变为 `147`；现有 Scroll to bottom 控件随后把它精确恢复到 range 末端 `709`。 |
| Keyboard | 发现浏览器对 focusable overflow div 的默认 PageUp 没有产生滚动后，`Conversation.tsx` 以现有 `keydown` owner 显式承接 Arrow/Page/Home/End。隔离页面重载最新代码后，焦点为 `chatScroll` 的 PageUp 把 `scrollTop` 从底部 `2408` 移至 `1967`。 |
| Visual review | 原始分辨率截图人工检查了底部和中段两种 scroll position：原生 scrollbar 静止时可见并终止于 Composer 顶边；Composer 始终处于稳定底部 band，消息可以在其上方完整滚动；没有第二 scrollbar、遮罩或重复标题栏。 |
| Non-UI verification | Overlay TypeScript、生产 Vite build（7061 modules）、i18n 均通过；historical-doc links 与 document-health 共 `62` tests / `0` failures。没有新增、修改或运行 UI 自动化测试；本任务检索到的旧 conversation scroll UI tests 在当前分支已不存在。 |
| Runtime isolation | 生产 app 仅用于修复前只读观察与滚轮复现；没有 refresh/restart/stop。修复后验收使用端口 `4174` 的隔离 Vite 页面连接现有只读数据源。 |
