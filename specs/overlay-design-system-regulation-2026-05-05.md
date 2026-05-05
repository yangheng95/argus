# Overlay Design-System Regulation Plan

> 日期：2026-05-05
> 范围：`packages/overlay/src/**` 的设计系统、组件骨架、dialog 体系、交互 hook、surface ownership。
> 目标：把 overlay 从“局部 token 化、整体仍然业余”推进到“primitive 单源、结构统一、视觉语言可审计”。

---

## 1. 结论

当前 overlay 的问题已经不是单个 icon、单个 border、单个 panel 的视觉瑕疵，而是 **design token、component primitive、dialog API、interaction hook 四层没有同时收敛**。

仓库里已经完成了一轮 `flat-redesign`：

- radius / weight / icon / opacity / z-index / motion token 已经开始收敛。
- `Button` / `Tabs` / `Section` / `Panel` / `SurfaceHeader` primitive 已存在。
- 大量 CSS ownership guard test 已存在。

但页面仍显得业余，根因不是 token 失效，而是：

1. primitive 只做了一半，业务组件没有切过去。
2. dialog 仍然多套并存。
3. interaction state/hotkey/focus 行为仍然各组件散写。
4. surface 文件仍然自己发明 header/panel/row 语法。

也就是说，**视觉语言的下层词汇表已经部分建立，但语法层仍然是碎的**。

---

## 2. 物证

### 2.1 Primitive 已存在，但覆盖率极低

当前 primitive 资产：

- `packages/overlay/src/components/ui/Button.tsx`
- `packages/overlay/src/components/ui/Tabs.tsx`
- `packages/overlay/src/components/ui/SurfaceHeader.tsx`
- `packages/overlay/src/components/primitives/Panel.tsx`
- `packages/overlay/src/components/primitives/Section.tsx`
- `packages/overlay/src/styles/primitives/button.css`
- `packages/overlay/src/styles/primitives/tabs.css`
- `packages/overlay/src/styles/primitives/panel.css`
- `packages/overlay/src/styles/primitives/section.css`

但实际使用面非常窄：

- `Panel` 只在 3 处使用：`DiffPreviewPanel.tsx`、`FileViewPanel.tsx`、`TracePanel.tsx`
- `Section` 只在 3 处使用：`Board.tsx`、`FilesSection.tsx`、其 primitive 自身示例
- 大量真正的 panel 组件仍绕过 primitive，直接手写壳层，例如：
  - `AgentWorkflowPanel.tsx`
  - `ArchitectPanel.tsx`
  - `ChangesPanel.tsx`
  - `EvaluationCriteriaPanel.tsx`
  - `FrontendPreviewPanel.tsx`
  - `RequirementsPanel.tsx`
  - `WorkspacePanel.tsx`
  - `MemoryPanel.tsx`

结论：**primitive 不是默认路径，只是旁路存在**。

### 2.2 Dialog 仍然是多系统并存

当前至少有 3 类 dialog 路径：

1. 静态 HTML dialog：
   - `index.html` 里有 `goalDialog` / `sessionDialog` / `diffDialog` / `appDialog` / `configDialog`
2. 组件内直接渲染 `<dialog>`：
   - `MemoryPanel.tsx`
   - `LogViewer.tsx`
   - `settings/ChannelsPanel.tsx`
3. imperative service 打开：
   - `services/dialog.ts` 的 `openConfigDialog()`
   - `services/app-dialog.ts` 的 `nativeMessage()`

已确认数据：

- `showModal()` 调用：7 处
- `<dialog>` 元素：8 处

结论：**overlay 现在没有单一 dialog contract**。这会直接造成：

- 关闭逻辑、focus restore、Esc 行为、标题栏按钮样式、层级策略不一致
- 一部分 dialog 是 static shell，一部分是 component self-owned，一部分是 service imperative

### 2.3 Interaction 行为没有 hook 层

已确认 `createSignal(false|true)` 的局部开关状态有 39 处，分散在：

- `main.tsx`
- `ChatComposer.tsx`
- `Card.tsx`
- `CardHeader.tsx`
- `TaskList.tsx`
- `TracePanel.tsx`
- `CommandPalette.tsx`
- `MemoryPanel.tsx`
- `ProvidersPanel.tsx`
- `SkillMarketPanel.tsx`
- `GeneralPanel.tsx`
- `ChannelsPanel.tsx`
- `WindowControls.tsx`

这批状态大多属于重复语义：

- disclosure open/close
- busy / sending / loading / refreshing
- armed confirm
- selection / popup open

同时，键盘与点击交互也在各自散写：

- `onKeyDown` 分布在 card、composer、command palette、workflow group、changes list、memory list、titlebar menu 等大量组件
- `onClick` / `stopPropagation` / `Enter` / `Space` / `Esc` 行为反复实现

结论：**overlay 当前没有 interaction primitive / hook 层**。视觉看起来“业余”，很大一部分是因为交互语义没有统一抽象，最终逼得 DOM 结构和样式也一起分叉。

### 2.4 Surface ownership 已有 guard，但没有 component grammar

当前 `overlay-architecture-guards.test.ts` 已经在管：

- 哪个 surface CSS 拥有哪些 selector
- 哪些主题 token 不能散落
- 哪些旧 class 必须退休
- 哪些 icon/button/titlebar/sidebar 样式必须归属于指定 surface

这说明项目已经在做 CSS single-source。

但组件语法层没有等价 guard：

- 没有测试限制“新增 panel 必须走 `<Panel>`”
- 没有测试限制“新增 collapsible section 必须走 `<Section>`”
- 没有测试限制“新增 icon button 必须走 `Button` / `IconButton`”
- 没有测试限制“新增 dialog 必须走 `<Dialog>` / `dialogStore`”

结论：**CSS 层在收口，component 层没有同步收口**。这就是为什么肉眼看上去仍像“各各玩各的”。

---

## 3. 根因

### 3.1 设计系统停在 token 阶段，没有完成到 primitive 阶段

现在仓库的设计演进顺序是：

1. 清理颜色、圆角、边框、icon、字体
2. 建少量 primitive
3. 业务组件未强制迁移

这会导致一种典型假象：代码里“看起来有设计系统”，但最终 UI 仍然不统一。

### 3.2 缺少“默认构建路径”

当前开发者新写 overlay 组件时，没有一个强约束的默认骨架告诉他：

- panel 要怎么起头
- header/actions 怎么摆
- section 怎么折叠
- dialog 怎么开关
- icon button 怎么写
- busy / confirm / disclosure 怎么管理

没有默认路径，工程就会退化回“现场自创结构”。

### 3.3 样式单源与组件单源不同步

当前项目在 CSS 层已经很强调 single-source，但组件层还保留很多“临时结构”。

视觉语言之所以显得业余，不是因为颜色错了一点，而是因为：

- DOM grammar 不统一
- state grammar 不统一
- action grammar 不统一
- visual token 只接管了表面，不接管骨架

---

## 4. 目标状态

整治后的 overlay 必须满足以下 4 条：

### 4.1 任何 panel 都有同一套骨架

必须默认走：

- `<Panel>`
- `<SurfaceHeader>`
- `<Section>`
- `<EmptyState>`
- `<ListRow>`

而不是每个业务组件自己发明：

- `xxx-panel`
- `xxx-header`
- `xxx-head`
- `xxx-toolbar`
- `xxx-body`

### 4.2 任何 dialog 都有同一套入口

必须只有一个 dialog 体系：

- structural primitive：`<Dialog>`
- runtime entry：`dialogStore.show(...)`
- rendering host：`<DialogHost />`

禁止再新增：

- 组件内随手 `queueMicrotask(() => el.showModal())`
- service 里直接 `document.getElementById(...).showModal()`
- 静态 HTML dialog 与组件 dialog 双轨共存

### 4.3 任何交互状态都先经过 hook

必须建立并默认复用：

- `useDisclosure`
- `useHotkey`
- `useFocusTrap`
- `useArmedConfirm`
- `useAsyncAction`
- `useSelection`

目标不是“为了抽象而抽象”，而是消灭重复语义的不同写法。

### 4.4 任何 surface 只表达视觉差异，不再表达结构发明

surface CSS 应只负责：

- tone
- spacing override
- background / border / accent policy
- local state styling

primitive CSS 才负责：

- panel / section / dialog / row / field / icon button 的结构语法

---

## 5. 实施方案

### Phase A — 定义 component grammar

新增或完成以下 primitive：

- `components/primitives/Dialog.tsx`
- `components/primitives/IconButton.tsx`
- `components/primitives/EmptyState.tsx`
- `components/primitives/ListRow.tsx`
- `components/primitives/Toolbar.tsx`
- `styles/primitives/dialog.css`
- `styles/primitives/icon-button.css`
- `styles/primitives/empty-state.css`
- `styles/primitives/list-row.css`

同时补齐现有 primitive 的 contract 文档与测试。

### Phase B — 定义 interaction grammar

新增 `src/solid/` hook 层：

- `useDisclosure`
- `useHotkey`
- `useFocusTrap`
- `useArmedConfirm`
- `useAsyncAction`
- `useSelection`

要求：

- 新代码禁止直接复制 disclosure / armed-confirm / busy boilerplate
- 旧代码按批次迁移

### Phase C — 收敛 dialog 系统

建立：

- `store/dialog.ts`
- `components/DialogHost.tsx`

迁移目标：

- `goalDialog`
- `configDialog`
- `appDialog`
- `LogViewer` dialog
- `MemoryPanel` detail dialog
- `ChannelsPanel` edit dialog

完成后：

- `services/dialog.ts` 只负责调用 store，不再碰 DOM
- `services/app-dialog.ts` 改为统一走 dialog host
- `index.html` 中非必要静态 dialog 外壳删除

### Phase D — 收敛 panel / section 体系

把以下组件统一迁到 `<Panel>` / `<Section>` 体系：

- `AgentWorkflowPanel`
- `ArchitectPanel`
- `ChangesPanel`
- `EvaluationCriteriaPanel`
- `FrontendPreviewPanel`
- `RequirementsPanel`
- `WorkspacePanel`
- `MemoryPanel`
- `DeliveryPanel`
- `TaskActionsPanel`

说明：

- 目前 `Panel` 只在 `DiffPreviewPanel` / `FileViewPanel` / `TracePanel` 三处使用，覆盖率过低。
- 迁移完成后，业务组件不再自定义 panel skeleton，只填 header/body/footer 内容。

### Phase E — 建立组件层 guard

在现有 CSS ownership guard 之外，新加 component-level 守卫测试：

- 新增 dialog 必须走 `<Dialog>`
- 新增 collapsible section 必须走 `<Section>`
- 新增 panel root 必须走 `<Panel>`
- 新增 icon-only action 必须走 `Button` 或 `IconButton`
- 新增 armed confirm 不得本地手写双击确认状态
- 新增 `showModal()` 直接调用数必须保持为 0 或白名单

这些测试比“口头规范”更重要，因为它们决定设计系统能否长期维持。

---

## 6. 禁止事项

后续 overlay 重构中，禁止再做以下事情：

- 只调 token，不推进组件迁移
- 只清理 CSS，不清理 dialog / hook 双源
- 给单个页面补一套私有 header / panel / row 结构
- 在组件内继续写新的 `<dialog>` + `showModal()`
- 继续复制 `createSignal(false)` 处理通用 open/close/busy/armed-confirm
- 继续把业务 surface 当作 primitive 定义位置

---

## 7. 迁移顺序

推荐顺序：

1. 先补 primitive 和 hook
2. 再统一 dialog
3. 再统一 panel / section
4. 最后补 guard test，锁死回潮

不要反过来先大面积改业务组件。否则只能得到一堆半成品调用点。

---

## 8. 本次审计后的判断

现有 `specs/overlay-flat-redesign/plan.md` 没错，但它的侧重点是 **flat visual cleanup**，不是 **design-system completion**。

下一阶段不能再把“改得更扁平一点”当成主线，必须切换到：

- primitive completion
- dialog single-source
- interaction hook single-source
- component grammar enforcement

否则 UI 会继续维持一种表面规范、内部松散的状态，肉眼上仍然会显得不专业。

---

## 9. 下一步

后续实施以这份文档为主，不再以局部 surface 修补为主线。

建议直接按以下第一个可执行批次启动：

1. 补 `Dialog` / `DialogHost` / `dialogStore`
2. 补 `useDisclosure` / `useArmedConfirm` / `useAsyncAction`
3. 用它们先收掉 `MemoryPanel`、`LogViewer`、`ChannelsPanel`、`goalDialog/configDialog`

这是最小但最有结构价值的一批。做完这一批，overlay 的“语法层”才算真正开始正规化。
