# Settings Titlebar Menu Interaction Layer Repair

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | 修复设置页面顶部“文件 / 编辑 / 视图 / 帮助”菜单无法点击的问题，并特别核对顶部菜单图层。 |
| Acceptance criteria | Settings 保持全屏应用页面；打开 Settings 后四个顶部菜单都能通过真实鼠标点击打开，弹层位于 Settings 之上并拥有命中点；Settings 初次打开仍聚焦搜索框；返回应用、菜单键盘路径和现有菜单动作不回退；Node 启动的 Playwright 回归、Overlay 类型检查/构建、截图视觉复核和文档检查通过。 |
| Hard constraints | 桌面端单端修复；保留 Kobalte Dialog/Menubar、现有 z-index token 和唯一 Settings/Titlebar 实现；不增加更高硬编码图层、第二套菜单、点击 fallback、iframe、query 覆盖、状态机或 host gate；Playwright 必须由 Node 启动；不重启、刷新或干预用户正在运行的 OpenCorvus/Overlay；当前 Windows host 是唯一编辑准源；不创建 worktree。 |
| User evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-7b283b9b-ee65-439d-a8f1-320277d946c6.png` 显示 Settings 全屏页面可见，顶栏菜单文字正常绘制，但整条顶栏被标注为无法点击区域。原图已按原始分辨率检查。 |
| Sources read | 根目录 `AGENTS.md`；浏览器控制 Skill；`specs/current/architecture/07-panel.md`、`07-panel-reactivity.md`；2026-07-23 Settings 菜单图层修复记录；2026-07-26 Settings 搜索/反馈提交 `1ec6b7568f`；当前 `App.tsx`、`ConfigDialogHost.tsx`、`Dialog.tsx`、`TitlebarMenubar.tsx`、`titlebar.css`、`settings.css`、设计语言 z-index token 与相关 source/browser tests。 |
| Whole-repository grep | `TitlebarMenubar.tsx` 是 File/Edit/View/Help 的唯一生产 producer；`titlebar.css` 是触发器和 portalled panel 的唯一 surface owner；`ConfigDialogHost.tsx` 是 Settings Dialog 的唯一生产 owner；`Dialog.tsx` 是 modal/non-modal pointer/focus 语义的唯一 primitive owner。`rg` 找到 Settings 的 `modal={true}` 生产调用点仅一处，静态契约断言在 `config-panel-sizing.test.ts`，真实 focus-trap 断言在 `config-dialog-resizer.test.ts`，Settings 中菜单命中回归在 `titlebar-menubar.test.ts`。现有 `--ui-z-overlay=100`、`--ui-z-dialog=10000` 已保证视觉层级，无需新增 token。 |
| Independent agent feedback | 无。用户没有要求子 Agent，当前协作规则禁止主动委托；主 Agent 负责实现与二次复核。 |
| Repository state | `work-v0.0.21beta-yr-0728` 在调查开始时工作区干净；`git fetch myhexin` 后与 `myhexin/work-v0.0.21beta-yr-0728` 为 `0/0` 同步，基线 HEAD 为 `eb34614b97`。 |

## Evidence-backed cause chain

1. **Observable symptom:** Settings 内容和顶栏菜单文字都正常绘制，但顶栏菜单不能通过鼠标激活。
2. **Direct trigger:** `ConfigDialogHost` 在提交 `1ec6b7568f` 中从 `modal={false}` 改成 `modal={true}`。Kobalte modal Dialog 把 portalled Settings 之外的应用标题栏视为对话框外部交互面；更高的视觉 z-index 不能改变 modal pointer/focus ownership。
3. **Deep cause:** Settings 是保留全局应用顶栏的全屏应用页面，却被重新建模成必须圈定焦点和外部交互的 modal Dialog。这个语义与 7 月 23 日已建立的“Settings 中顶栏菜单必须继续可见且可交互”合同冲突。
4. **Why the prior layer repair did not prevent the regression:** 7 月 23 日只修复了 portalled menu panel 的绘制/命中层级；7 月 26 日新增的 modal 交互边界发生在更高层 primitive 语义上。现有 browser case 仍保留菜单层检查，但没有和新 focus-trap 断言形成一致合同。

## Call-site disposition

| Owner / call site | Disposition |
| --- | --- |
| `ConfigDialogHost.tsx` Settings `<Dialog>` | 将唯一 Settings shell 恢复为 `modal={false}`；保留 `fullscreen`, `backdropClose={false}` 和 `onOpenAutoFocus` 搜索框聚焦。 |
| `Dialog.tsx` shared primitive | 保留。其 modal/non-modal pointer 语义是成熟单一来源；本修复选择正确语义，不在 primitive 内增加 Settings 特判。 |
| `titlebar.css` `.titlebar` / `.titlebar-menubar-panel` | 保留 `--ui-z-dialog`。现有视觉和 popup hit-test 层级正确；禁止用更高层级掩盖 modal 根因。 |
| `TitlebarMenubar.tsx` | 保留 Kobalte Menubar、Portal 和菜单动作；四个 trigger 已有一个生产实现，无需本地点击绕行。 |
| `config-panel-sizing.test.ts` | 把 Settings shell 合同从 modal 改为 non-modal，并继续断言全屏几何及 overlay 层。 |
| `config-dialog-resizer.test.ts` | 删除错误的焦点陷阱预期；保留打开后搜索框初始焦点，新增 Settings 打开时标题栏可获得真实焦点/点击的合同。 |
| `titlebar-menubar.test.ts` | 在 Settings 打开状态下逐个真实点击 File/Edit/View/Help，断言对应 panel 可见、panel 高于 Settings 且命中点归 popup；保存当前任务截图。 |
| `specs/README.md` 与 `specs/records/2026-07/README.md` | 索引本记录，保持方案/历史单一来源。 |

## Verification plan

1. 先以当前未修复代码运行 Node 启动的 canonical titlebar/config browser tests，保存失败证据。
2. 实施唯一语义修复并更新 source/browser regressions。
3. 运行聚焦单元测试、Node browser tests、Overlay typecheck、i18n check 与 Vite production build。
4. 用隔离 Vite 页面和浏览器控制技能打开真实 Settings，逐项点击四个顶部菜单，保存并亲自检查任务截图；不触碰用户正在运行的 Overlay。
5. 运行 `historical-docs-links`, `document-health`, `product-docs-single-source`, `git diff --check`；二次 review diff 和全仓 residue。
6. 以 `dsw-33987` 前缀提交并 push 当前主工作分支到 `myhexin`。

## Final implementation record

### Codex review feedback and revision

- The baseline Node/Playwright reproduction failed because
  `.config-dialog-overlay[data-dialog-modal="true"]` intercepted the
  titlebar pointer event. This directly confirmed that increasing the
  titlebar `z-index` would not repair the modal interaction owner.
- Restoring `ConfigDialogHost` to `modal={false}` removed that pointer
  blocker while preserving the full-screen Settings surface and initial
  search focus.
- A second browser trace showed that a fast click could still be preceded
  by the product's immediate hover-open path. Kobalte would then receive an
  already-open controlled menu and the same click could close it. The
  titlebar now separates deliberate hover intent (500 ms) from pointer
  clicks, clears hover intent on pointer down, and settles the controlled
  click after Kobalte's dismissable-layer event completes. The existing
  Kobalte Menubar, Portal, actions, keyboard access, and design-system
  elevation tokens remain the only implementation sources.
- The canonical titlebar browser fixture was also updated to match the
  current server-owned anonymous-project lifecycle and current semantic
  titlebar colour token. These were stale fixture expectations exposed by
  the required full-suite rerun, not product fallbacks.

### Acceptance evidence

- File, Edit, View, and Help are each clicked with Playwright while Settings
  is open.
- The regression asserts `data-dialog-modal="false"`,
  `pointer-events: none` on the transparent Settings overlay, trigger
  hit-testing, popup hit-testing, and popup elevation above Settings.
- The Settings resizer browser test confirms initial search focus, real
  focus transfer to File, File menu opening, Escape dismissal, and the
  existing Settings visual matrix.
- Visual evidence:
  `.scratch/settings-titlebar-menu-layer.png` shows the Help popup painted
  and interactive above the full-screen Settings surface. The screenshot was
  inspected at original resolution. The in-app Browser rejected direct
  navigation to the local screenshot under its URL security policy; the
  canonical Node Playwright page and local image inspection remain the
  accepted visual evidence.

### Final verification status

- [x] Baseline failure recorded.
- [x] Settings non-modal interaction ownership repaired.
- [x] Pointer click and deliberate hover intent separated without adding a
  second menu implementation.
- [x] Focused unit contracts passed.
- [x] Canonical titlebar browser suite passed in focused subtest runs.
- [x] Config dialog browser/resizer suite passed.
- [x] Production Vite build passed.
- [x] Screenshot inspected and visual layer relationship accepted.
- [x] Typecheck, documentation health, and final diff review passed.
- [x] Implementation commit and git-cc push completed.

## Progress

- [x] 检查用户截图、仓库状态、历史方案与完整调用面。
- [x] 建立可观察现象、直接触发点和深层语义冲突的因果链。
- [ ] 记录未修复 browser failure。
- [ ] 实施 Settings non-modal 单一语义修复和回归。
- [ ] 完成真实浏览器截图、视觉复核和二次代码 review。
- [ ] 完成所有验证、commit 和 git-cc push。
