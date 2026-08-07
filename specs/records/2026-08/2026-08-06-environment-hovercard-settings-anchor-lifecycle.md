# Environment HoverCard Settings Anchor Lifecycle

## Recall

### 用户原始要求

- 右侧 Environment 悬浮框在切换到设置等页面时必须隐藏。
- 新增设置页面后不能因为遗漏单独接线而让悬浮框继续显示并漂到左上角。
- 用户提供的截图显示失去聊天头部锚点后的完整 Environment 悬浮框出现在页面左上区域。

### 验收指标

- 已打开或固定的 Environment HoverCard 在进入全屏 Settings 时立即关闭并清除固定状态。
- Settings 下现有和以后新增的 `CONFIG_SECTIONS` 页面共享同一行为，不维护逐页名单。
- 返回 Conversation 后 HoverCard 不自动复现；只有既有的一次性会话呈现、悬停或显式点击可以再次打开。
- Overlay 类型检查、Vite 构建和文档健康检查通过。
- 在独立真实页面中打开 Environment、进入 Settings、检查 Settings 页面无遗留 HoverCard，并截图人工复核。

### 硬约束

- 保留 `ProjectRuntimeStatusPanel` 已有的受控 Kobalte HoverCard、固定状态和锚点生命周期实现。
- 不新增页面名单、fallback、第二份 HoverCard 可见状态或 Host gate。
- 不新增、修改或运行 UI 自动化测试；UI 验收仅使用当次真实页面交互、截图和人工复核。
- 不修改或提交当前工作区中的数据库迁移、Composer 和其他并行改动。

### 已读取资料

- `AGENTS.md`
- `CLAUDE.md`
- `specs/current/architecture/07-panel.md`
- `packages/overlay/src/components/App.tsx`
- `packages/overlay/src/components/TaskDirBar.tsx`
- `packages/overlay/src/components/ConfigDialogHost.tsx`
- `packages/overlay/src/components/ui/Dialog.tsx`
- `packages/overlay/src/store/dialog.ts`
- `packages/overlay/src/services/config-dialog-control.ts`
- `packages/overlay/src/styles/surfaces/dialog.css`
- `packages/overlay/src/styles/surfaces/settings.css`
- `packages/overlay/src/styles/surfaces/conversation.css`
- 历史提交 `e33160612c` 和 `b39d573a30`

### 全仓调用点

| 调用点                                                                                                  | 处理                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `App.tsx` 中唯一 `ProjectRuntimeToolbarActions` 挂载                                                    | 将 `anchorVisible` 从仅排除空白首页改为同时排除全屏 Settings。                        |
| `TaskDirBar.tsx` 中 `runtimePanelOpen` 与隐藏锚点 effect                                                | 保留；收到 `anchorVisible=false` 后负责关闭并清除固定状态。                           |
| `ConfigDialogHost.tsx` 中 `dialogStore.config.open`                                                     | 保留为完整 Settings 覆盖面的唯一可见事实。                                            |
| `store/dialog.ts` 中 `CONFIG_SECTIONS`                                                                  | 保留为所有 Settings 子页的单一目录；新增子页自动位于同一个 Settings open 生命周期内。 |
| `openConfigDialog` 的 Composer、Work Ledger、Titlebar、Sidebar、Command Palette、Connection Banner 入口 | 保留；所有入口最终写同一个 `dialogStore.config.open`。                                |
| `closeConfigDialog` 与 Settings 返回按钮                                                                | 保留；关闭 Settings 不恢复旧 HoverCard 状态。                                         |

### 独立审查反馈

- session-local 只读子会话已按限定范围完成；主会话仍以代码与历史提交证据独立复核。
- Claude Code CLI 已按仓库规则尝试只读审查，但本机返回 `Not logged in`，没有产生审查内容或文件修改。

## 根因

`ProjectRuntimeStatusPanel` 已经具备正确的隐藏锚点关闭逻辑，但其唯一调用者只传入 `!homeActive`。Settings 是后挂载的全屏非模态 Dialog；打开 Settings 不会改变 `homeActive`，因此 HoverCard 保持受控 open。其 Portal 的层级晚于 Settings 且锚点被完整页面覆盖，Floating UI 最终可把内容定位到视口左上区域。

新增 Settings 子页不应知道 Environment HoverCard。完整 Settings 覆盖面的可见事实已经由 `dialogStore.config.open` 统一拥有，所以应在 App 挂载边界把这个事实并入 `anchorVisible`，复用已有关闭 effect。

## 实施

1. `App.tsx` 读取 `dialogStore.config.open`，仅在非空白 Conversation 且 Settings 未打开时向 Environment 声明锚点可见。
2. 更新当前 Panel 架构记录，明确完整 Settings 覆盖面关闭 HoverCard，所有 Settings 子页继承该行为。
3. 不增加 UI 测试；执行类型检查、构建、文档检查，并通过独立真实页面交互截图复核。

## 验证证据

- `bun run --cwd packages/overlay typecheck`：通过。
- `bun run --cwd packages/overlay build:vite`：通过；仅保留既有第三方 directive 与大 chunk 警告。
- 仓库规则引用的 `packages/opencorvus/test/script/historical-docs-links.test.ts` 在当前工作树不存在，Bun 未执行任何测试；改由索引更新、`git diff --check`、根级 `docs:check` 与最终 push hook 验证文档边界。
- [Environment 打开状态](../../artifacts/2026-08-06-environment-open-before-settings.png)：真实选中当前 Work 会话后，右侧 Environment HoverCard 可见且仍锚定聊天头部。
- [Work Settings 关闭状态](../../artifacts/2026-08-06-environment-closed-on-work-settings.png)：经 File → Settings 打开完整 Settings 并切换到 `work` 后，页面无遗留 HoverCard 或左上角漂浮内容。
- 当次 Playwright 交互观测：进入前 `aria-expanded=true` 且 `#projectRuntimeStatusPanel` 可见；进入 Work Settings 后 `#configDialog` 可见、活动 panel 为 `work`、`#projectRuntimeStatusPanel` 数量为 `0`、trigger 的 `aria-expanded=false`。
