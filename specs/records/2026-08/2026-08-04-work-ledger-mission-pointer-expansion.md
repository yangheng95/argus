# Work Ledger Mission Pointer Expansion

## Recall

| Item                    | Detail                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User requirement        | Mission 下存在 Task 时，鼠标 hover Mission 行必须自动展开 child Task；该功能此前已实现但当前运行态失效。                                                                                                                                                                                                                                   |
| Acceptance criteria     | 指针进入带 child Task 的 Mission 行后，disclosure 箭头旋转且 drawer 自动展开；指针移动到 child Task 后保持展开，离开完整 Mission shell 后收起；selected child 与键盘 focus 继续保持 drawer 可见。真实桌面页面必须执行 hover、截图并人工复核。                                                                                              |
| Hard constraints        | 桌面端单端修复；不新增、修改、更新或运行 User Interface（UI，用户界面）自动化测试；不增加持久化展开状态、fallback、第二 drawer owner 或 gate；保留并行工作区改动；不干预正在运行的 OpenCorvus / overlay；提交主题使用 `dsw-33987` 前缀并推送当前分支到 `myhexin`。                                                                         |
| Read material           | 根 `AGENTS.md`、`CLAUDE.md`；用户 478×130 截图；`specs/current/architecture/07-panel.md`；2026-08-03 Work Ledger pointer jitter、density/Mission expansion 与 Mission-only Task hierarchy 记录；当前 `WorkLedger.tsx`、`work-ledger.css`、`index.html`、Vite build output。                                                                |
| Whole-repository search | `WorkLedgerRowView` 是 Mission shell、disclosure 和 child drawer 的唯一 DOM owner；`WorkLedgerTaskChildRow` 只在该 drawer 内复用同一行组件；`work-ledger.css` 是 drawer、child insertion 和 disclosure 展开样式的唯一 owner；当前源码与 `dist-vite` 都含父 `.work-row-shell:hover` 选择器；没有其他 drawer 选择器或覆盖规则。              |
| Historical evidence     | `4c223c3893` 为修复 pointer geometry 删除 Mission `:hover` 展开；`076de76141` 于 2026-08-03 恢复该 CSS 伪类。当前 HEAD 与构建 CSS 均含恢复后的规则，但用户截图中行操作已经呈现交互态，disclosure 仍朝右且 child drawer 未展开。                                                                                                            |
| Independent feedback    | 已启动只读子 Agent 调查；工具返回 terminal-success Session 证据但未返回可用文本结论。本机 Claude Code 2.1.147 按只读 `Read,Grep,Glob` 契约启动，但因未登录返回 `authentication_failed` / `Not logged in`，未产生审查结论。当前 Agent 已复核 shell/row/drawer DOM 包含关系、全部展开选择器、构建 CSS 与历史提交；外部认证阻塞不伪装为通过。 |

## Cause chain

1. Mission 行内部 `.work-row` 与父 `.work-row-shell` 使用两套隐式 CSS hover 命中：操作 rail 读取前者，drawer/disclosure 读取后者。
2. 用户截图显示操作 rail 已进入交互态，证明指针命中真实 Mission 行；同一时刻 disclosure 未旋转且 drawer 未展开，证明父伪类没有形成可观察的 drawer 展开事实。
3. 当前源码和构建产物已经包含 2026-08-03 恢复的父 `:hover` 规则，重复添加或提高同一选择器特异性不会改变该运行时失效边界。
4. Mission shell 本身是完整 hover 区域且包住 child drawer。让它在真实 `pointerenter` / `pointerleave` 时投影一个瞬时 `data-pointer-within` 属性，可以让 disclosure 和 drawer 读取同一个明确 DOM 事实；指针进入 child 后仍位于 shell 内，不会提前收起。
5. 该属性只表达当前指针是否位于这一真实 shell，不持久化、不跨行、不复制 selected/focus 状态；CSS 仍以 pointer、focus-within、selected-child 三种正交可见性事实统一呈现同一个 drawer。

## Call-site disposition

| Owner                                           | Disposition                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkLedgerRowView`                             | 增加一个组件局部瞬时 pointer signal，仅在 Mission 确有 child Task 时投影 `data-pointer-within`；shell 的 pointer enter/leave 是唯一写入点。 |
| `WorkLedgerTaskChildRow`                        | 保持不变；child 仍位于父 Mission shell 内，因此从 Mission 行移动到 child 不触发父 shell pointer leave。                                     |
| `work-ledger.css` disclosure / drawer selectors | 用 `[data-pointer-within="true"]` 替换 `:hover`，继续与 `:focus-within`、`[data-has-selected-child="true"]` 共用同一呈现规则。              |
| action rail hover                               | 保持 `.work-row:is(:hover, :focus-within)`；它已在用户证据中正常工作，且不拥有 Mission drawer。                                             |
| server / transport hierarchy                    | 保持不变；Mission `tasks` 已正确存在，截图中的计数 `1` 证明数据投影不是本故障。                                                             |

## Verification plan

1. 格式化 task-owned TypeScript / Cascading Style Sheets（CSS，层叠样式表）并运行 Overlay TypeScript typecheck、internationalization（i18n，国际化）check、Vite production build 与 `git diff --check`；不运行任何 UI 自动化测试。
2. 启动隔离的当前源码页面，使用 Node 驱动的 headed Chromium 对真实 Mission 行执行 pointer hover；分别捕获静止 Mission、hover Mission、hover child Task 与离开后的状态并人工查看。
3. 复核 disclosure 旋转、drawer 高度/可见性、child 行持续可见，以及 Mission/相邻行没有异常覆盖或抖动。
4. 二次审查 task-owned diff，更新 spec 索引和验证记录，提交并推送当前交付分支到 `myhexin`。

## Progress

- [x] 读取截图、历史方案、当前 DOM/CSS、构建产物和全部相关调用点。
- [x] 完成实施前只读方案挑战；记录独立工具没有返回可用结论及 Claude Code 认证阻塞。
- [x] 提交/push 本方案。
- [x] 实现单一 Mission shell pointer 展开事实。
- [x] 完成非 UI 检查和真实页面截图人工复核。
- [x] 完成二次 review、提交并 push。

## Validation record

- Overlay TypeScript typecheck、panel internationalization（i18n，国际化）check、Vite production build 与 `git diff --check` 通过；构建仅输出既有第三方 module-directive 与 chunk-size warning。
- Historical document links 通过 2/2，product document single-source 通过 8/8，document health 通过 60/60；没有运行、新增或修改任何 UI 自动化测试。本次触及路径中已存在的两份 CSS/source assertion UI 测试由并行的 single trailing-slot 修复按规则删除，本修复保留该删除结果。
- 真实页面使用新建隔离数据库 `D:/yerui/code/opencorvus/opencorvus/.scratch/mission-pointer-runtime/home/data/opencorvus.db`，其中包含一条真实 Mission Session 与一个真实 Mission-owned Task；当前源码服务只在隔离端口 `17886` 存活于一次性 headed Chromium 命令期间。
- 静止 Mission shell 为 `224×26px`，drawer 高度 `0`、`visibility:hidden`、child opacity `0`，且 disclosure icon 无 transform。指针进入真实 Mission row 后，`data-pointer-within="true"`，shell 变为 `224×55px`，drawer 为 `224×29px`、`visibility:visible`、child opacity `1`，disclosure icon 的 computed transform 为 90° 旋转矩阵。
- 指针从 Mission row 移到真实 child Task 后，`data-pointer-within`、shell/drawer 几何、child opacity 和 disclosure 旋转均保持不变。指针离开完整 shell 后，该属性清除，shell 回到 `224×26px`，drawer 回到高度 `0` 并隐藏。
- 已人工查看 `.scratch/mission-pointer-runtime/screenshots/mission-rest.png`、`mission-hover.png`、`child-hover.png` 与 `mission-left.png`：child 行层级、hover action rail、Mission 标题和相邻布局均正常，没有覆盖、裁剪或 pointer jitter。准确 server process 已停止，端口 `17886` 无 listener。
- Task-scoped Browser Preview 因当前 Chat 缺少可持久化 preview target 的 Task context 而拒绝发布；随后按平台要求创建验证 Task，但未依赖其结果。真实验收由同一 Node 命令直接启动/停止隔离服务并用 headed Chromium 操作完成，没有生成 UI 测试文件或把 URL 冒充为 Browser Preview。
