# UI 设计规范围剿（2026-05-07）

> 总指挥：Claude Opus 4.7（Claude Code 主会话）
> 执行者：Codex（`codex exec` 非交互模式）
> 验收人：Claude（grep + bun test + 二次复核）
>
> 本 spec 的每一批都是 self-contained：codex 只需要读对应章节即可执行。每批一个独立 commit + push。失败回滚到上一批 commit 重做。

---

## 0. 背景与原则

### 用户主诉
- 视觉上 light 主题是对的，dark / vscode-dark 主题"混入异色"。
- 用户用 "vscode 的主题颜色混入了 dark 主题的颜色" 描述：在 VSCode webview 里，overlay 的 dark.css（紫色 `#111528`）与 VSCode workbench 的 dark+ 灰色（`#1e1e1e`）并存视觉冲突。

### 围剿范围（按 CLAUDE.md 的硬性约束）
- **rule 7（禁 fallback）**：base.css `:root` 钉死的色值在 dark/light/vscode-dark 都没声明时被当 fallback；dark.css 的 `body:not([data-theme])` 是 boot 死路径。
- **rule 8（禁双源）**：`btn.css` vs `primitives/button.css` 双套 button 实现；surfaces/ 局部 `body[data-theme]` override（5 处）；token 散布在 surfaces/。
- **rule 10（禁硬编码）**：surfaces/ 共 51 处 `color-mix(... white|black ...)` 字面量；5 处 animation 时长字面量；TodoListPart/EvaluationCriteriaPanel 用 unicode 字面量做状态图标。
- **rule 11（拦截破坏抽象）**：`goalStatusClass`、`statusBadgeClass` 用 modifier class 决策视觉，违反 data-attr 驱动哲学。
- **rule 13（禁状态机）**：UI 层 switch-case 把状态映射到 className/icon。
- **rule 16（禁技术债）**：composer.css:516 注释自承"pending palette-tokenization"。
- **rule 17（禁死代码）**：dark.css `body:not([data-theme])` 因 index.html 已写死 data-theme="light" 永不触发。

### 总体策略
- 守卫先行（先写测试守卫但 `it.skip`，每批清完一类启用一条）。
- 删旧不留：每批只做替换，不留兼容路径（rule 8）。
- 每批一个 commit，pre-commit hook 必跑（typecheck / api:routes-check / docs:check / theme-symmetry）。
- 验收命令必须返回 0 行 / 0 失败才算通过。

---

## 1. 围剿对象总清单（精确文件:行号）

### 1.1 Theme cascade 错配
| 位置 | 违规 | 修复批次 |
|---|---|---|
| `packages/overlay/src/styles/cascade/base.css:24` | `:root { color-scheme: dark }` 硬编码 | Batch 4 |
| `packages/overlay/src/styles/cascade/base.css:28` | `:root { --text-on-accent: #ffffff }` 三主题不覆盖 | Batch 4 |
| `packages/overlay/src/styles/cascade/base.css:30` | `:root { --dialog-backdrop }` 与三主题各重声明 = 4 源 | Batch 4 |
| `packages/overlay/src/styles/cascade/dark.css:24-25` | `body:not([data-theme])` 死路径 | Batch 4 |
| `packages/overlay/test/flat-redesign-theme-symmetry.test.ts:75-78` | 锁住死路径的断言 | Batch 4 |
| `packages/overlay/src/styles/surfaces/dialog.css:20` | `color-scheme: inherit` patch | Batch 4（间接清理） |

### 1.2 主题分支 override 在 surfaces（应回 cascade）
| 位置 | 选择器 | 修复批次 |
|---|---|---|
| `packages/overlay/src/styles/surfaces/composer.css:652-664` | `body[data-theme="light"] .executor-menu*` 3 处 | Batch 3 |
| `packages/overlay/src/styles/surfaces/conversation.css:801-805` | `body[data-theme="light"] .task-bar` | Batch 3 |
| `packages/overlay/src/styles/surfaces/conversation.css:807-810` | `body:is([data-theme="dark"], [data-theme="vscode-dark"]) .task-bar` | Batch 3 |
| `packages/overlay/src/styles/surfaces/conversation.css:812-814` | `body[data-theme="vscode-dark"] .task-bar` | Batch 3 |

### 1.3 双源 button 实现
| 位置 | 内容 | 决策 |
|---|---|---|
| `packages/overlay/src/styles/surfaces/btn.css` | 全文 `.btn / .btn-ghost / .btn-primary / .btn.mini / .btn.danger` | 删除 |
| `packages/overlay/src/styles/primitives/button.css` | `.oc-button[data-variant][data-tone]` | 保留（单源） |

调用点（需迁移）：
- `packages/overlay/src/index.html:37` — `<link rel="stylesheet" href="styles/surfaces/btn.css">` → 删除
- `packages/overlay/src/index.html:245,255` — `class="btn btn-ghost mini"` → `<button class="oc-button" data-variant="ghost" data-size="mini">`
- `packages/overlay/src/styles/surfaces/card.css:1258,1267` — `.interaction-card__actions .btn` → 改用 `.oc-button` 选择器
- `packages/overlay/src/styles/surfaces/conversation.css:860` — `.task-cwd-actions .btn` → 同上
- 其他 grep 出的 `.btn` 引用点（codex 必须 `grep -rn "\.btn\b" packages/overlay/src` 全数迁移）

### 1.4 white/black 字面量（51 处）
分布：
- `agent-card.css`: 2 处
- `composer.css`: 6 处
- `dialog.css`: 8 处
- `conversation.css`: 8 处
- `inspector.css`: 9 处
- `settings.css`: 10 处
- `messages.css`: 1 处
- `workspace.css`: 1 处
- `notifications.css`: 2 处
- `sidebar.css`: 2 处
- `changes.css`: 1 处
- `conn-banner.css`: 1 处
- `vscode-dark.css`、`dark.css`、`base.css`: cascade 内合法（不算）

抽出 4 个语义 token（在 cascade 三主题各赋值）：
- `--ui-scrim`：用于 `::backdrop` / 遮罩层
- `--ui-shadow-tone`：阴影色基底
- `--ui-highlight-tone`：高亮/glass 反光
- `--ui-glass-tint`：半透明卡片底色

### 1.5 动效时长字面量（5 处）
- `card.css:626` `0.8s` → `var(--ui-duration-loop-spin)`（新加）
- `card.css:1688` `1.6s` → `var(--ui-duration-loop-pulse)`（新加）
- `field.css:102` `9999s` → 这是 Chrome autofill hack，例外保留 + 注释说明
- `conversation.css:87` `1.1s` → `var(--ui-duration-loop-progress)`
- `cmdk.css:20` `0.12s` → `var(--ui-duration-fast)`（已存在）

### 1.6 UI 状态机/双源
| 位置 | 违规类型 | 修复 |
|---|---|---|
| `Board.tsx:43-60 statusIconName` | 合规（保留） | — |
| `GoalWorkflowGroup.tsx:90-97 goalStatusIconName` | 双源（rule 8）：goal status enum (passed/failed/running) → task icon name | 抽 `utils/status-mapping.ts` 单源映射 |
| `GoalWorkflowGroup.tsx:99-106 goalStatusClass` | 状态机（rule 13）：state → modifier class | 改 `<div data-goal-status={status}>` + CSS `[data-goal-status="passed"]` |
| `GoalWorkflowGroup.tsx:125 class={\`gwg ${goalStatusClass(...)}\`}` | 删除调用 | 改 attr |
| `RequirementsPanel.tsx:41-46 statusBadgeClass` | 状态机（rule 13） | 改 `<span data-req-status={status}>` + CSS attr 选择器 |
| `RequirementsPanel.tsx:85` | 删除 modifier class 拼接 | 改 attr |
| `EvaluationCriteriaPanel.tsx:32-37 statusIcon` | rule 10（unicode 字面量）+ rule 13 | 改 `<Icon name={statusIconName(status)}>` 复用 Board 映射 |
| `EvaluationCriteriaPanel.tsx:65,68,72,85` | 调用点 | 替换 |
| `TodoListPart.tsx:6-18 statusIcon` | rule 10（unicode 字面量）+ rule 13 | 改 `<Icon>` 组件 |
| `TodoListPart.tsx:48` | 调用点 | 替换 |
| `TaskList.tsx:95-96` 状态优先级三元链 | 状态机（rule 13），但仅排序非视觉，**轻度违规** | 抽 `STATUS_PRIORITY: Record<string, number>` 单源 const |

### 1.7 boot 时序双源
| 位置 | 修复 |
|---|---|
| `index.html:2 <html data-theme="light">` | 保留（HTML 静态初值） |
| `index.html:43 <body data-theme="light">` | 保留（同上） |
| `index.html:44-56` inline script 双写 | **删除整段**（HTML 静态属性已经够，applyTheme 后续会写） |
| `main.tsx createEffect` 立即触发 applyTheme | 移动到 `loadSettings()` await 完之后第一次执行 |
| `default-theme.test.ts:23-24` 锁住 inline script | 同步删除断言 |

### 1.8 测试盲区（守卫缺失）
新增：
- `packages/overlay/test/flat-redesign-color-literal-coverage.test.ts`：禁止 `surfaces/**/*.css` 中 `\bwhite\b`、`\bblack\b`、`#[0-9a-fA-F]{3,8}`、`rgba?\(`（除 cascade/、tokens/）
- `packages/overlay/test/flat-redesign-theme-cascade-discipline.test.ts`：
  - 禁止 `surfaces/**/*.css` 中 `body\[data-theme=`（= 0，不再容忍 ≤ 3）
  - 禁止 `cascade/base.css` `:root` 块出现色值 token（含 `color-scheme`）
  - 强制三主题 token **值** 都存在（不只是 token 名）
- `packages/overlay/test/flat-redesign-status-discipline.test.ts`：
  - 禁止 `components/**/*.tsx` 出现 `function .*[Ss]tatus.*Class\(.*\)` 返回 modifier class
  - 禁止 `components/**/*.tsx` 出现 unicode 几何字符 `✔ ◐ ✕ ○ ✓ ✗ −` 字面量
- 强化 `flat-redesign-motion-coverage.test.ts`：覆盖 `animation:` 时长（当前只覆盖 `transition:`）
- 强化 `flat-redesign-theme-symmetry.test.ts`：加 light↔vscode-dark 对称检查

---

## 2. 分批执行计划

### 依赖顺序

```
Batch 0 (守卫 placeholder, .skip)
  ↓
Batch 1 (btn.css 双源)
  ↓
Batch 2 (white/black token 抽取) ─┐
  ↓                                 │
Batch 3 (主题分支 override 回 cascade) ─┤
  ↓                                 │
Batch 4 (base.css :root 重构) ──────┤── 这三批共同消灭 cascade/外的 theme 漂移
  ↓
Batch 5 (boot 时序简化)
  ↓
Batch 6 (VSCode webview host theme handshake)
  ↓
Batch 7 (状态机/双源 → data-attr)
  ↓
Batch 8 (动效字面量 → token)
  ↓
Batch 9 (启用所有守卫 + 测试加固)
```

每批结束后必须：
1. `bun test packages/overlay/test/flat-redesign-*` 全过
2. `bun test packages/overlay/test/overlay-architecture-guards.test.ts` 全过
3. `bun typecheck` 全过
4. 该批的"验收 grep"返回 0 匹配
5. `git commit` + `git push`（不绕 hook）

---

## 3. 各批详情

### Batch 0：守卫先行（占位）

**目标**：把 1.8 节列的 3 个新 test 文件创建出来，所有断言 `.skip`（或 `it.todo`），保留断言文本作为后续 enable 模板。

**Codex prompt**：
```
读 specs/ui-design-discipline-overhaul-2026-05-07.md 第 1.8 节和第 3 节 Batch 0。

任务：
1. 创建 packages/overlay/test/flat-redesign-color-literal-coverage.test.ts，含三个 describe 块（white/black, hex, rgba），每个 describe 内的 it 全部用 it.skip 标记，但断言主体写完整（grep 文件 + 期望 = 0）。
2. 创建 packages/overlay/test/flat-redesign-theme-cascade-discipline.test.ts，含三个 it.skip：surfaces 禁 body[data-theme=]、base.css :root 禁色值、三主题 token 值齐全。
3. 创建 packages/overlay/test/flat-redesign-status-discipline.test.ts，含两个 it.skip：禁 statusXxxClass 函数、禁 unicode 几何字符。

约束：
- 这一批不许改任何源文件（src/），只新增 test 文件。
- 所有 test 必须 it.skip，跑测试不能失败。
- 每个 test 的失败信息要清晰，列出违规文件:行号。

完成后：
- bun test packages/overlay/test/flat-redesign-color-literal-coverage.test.ts 应跳过 N 个，0 失败
- 提交：feat(overlay/test): add Batch-0 placeholder guards (skipped) for theme overhaul
- git push
```

**验收（Claude）**：
```bash
bun test packages/overlay/test/flat-redesign-color-literal-coverage.test.ts 2>&1 | tail -5
bun test packages/overlay/test/flat-redesign-theme-cascade-discipline.test.ts 2>&1 | tail -5
bun test packages/overlay/test/flat-redesign-status-discipline.test.ts 2>&1 | tail -5
git log -1 --oneline
```

---

### Batch 1：删 surfaces/btn.css 双源

**目标**：删除 `surfaces/btn.css`，所有 `.btn / .btn-ghost / .btn-primary / .btn.mini / .btn.danger` 调用点迁移到 `<button class="oc-button" data-variant="..." data-tone="..." data-size="...">`。

**调用点**（codex 必须先 `Grep '\.btn\b|btn-ghost|btn-primary' packages/overlay/src` 列全表，对照本节决策）：
- `index.html:37` `<link>` → 删除
- `index.html:245,255` 类名迁移
- `card.css:1258,1267` selector 改写
- `conversation.css:860` selector 改写
- `ConfigDialogHost.tsx:198` 仅 `config-close-btn` 命名，不是 .btn 系列，**保留**（命名属于 component-local）
- `FrontendPreviewPanel.tsx:42,51` 仅 `section-icon-btn`，同上保留
- `PermissionsPanel.tsx`、其他文件如有 grep 命中需要核对是 `.btn` 类还是命名包含 btn 的 component-local 类

**Codex prompt**：
```
读 specs/ui-design-discipline-overhaul-2026-05-07.md 的 Batch 1。

强制要求（按 CLAUDE.md rule 35）：
- 先 grep 全 packages/overlay/src 找所有 .btn / .btn-ghost / .btn-primary / .btn-danger / .btn.mini / .btn.danger 类名，列清单。
- 对每条命中：判断是 .btn 系列（迁移）还是仅命名包含 btn 的 component-local 类（保留），决策写到 commit body。

任务：
1. 删除 packages/overlay/src/styles/surfaces/btn.css 全文。
2. 删除 index.html:37 的 <link> 引用。
3. 把 index.html / *.tsx / *.css 中所有 .btn 系列调用点迁移到 .oc-button 数据属性方案。
4. 检查 packages/overlay/src/styles/primitives/button.css 是否覆盖所有原 .btn 变体（ghost / primary / mini / danger）；缺失的变体在 button.css 内补齐 [data-variant] / [data-tone] / [data-size] 规则。

验收：
- grep -rn '\.btn\b' packages/overlay/src/styles 应返回 0 结果（除 cascade/tokens 中 --ui-btn-* 这种 token 名）
- grep -rn 'btn-ghost\|btn-primary\|btn-danger' packages/overlay/src 应返回 0 结果
- bun test packages/overlay/test/ 全过
- bun typecheck 全过

提交：refactor(overlay): retire surfaces/btn.css, migrate to primitives/button.css single source [rule 8]
git push
```

**验收（Claude）**：
```bash
ls packages/overlay/src/styles/surfaces/btn.css 2>&1  # 应该 not found
# 用 Grep tool 查 .btn\b 和 btn-ghost / btn-primary 在 src 下
bun --cwd packages/overlay test 2>&1 | tail -10
```

---

### Batch 2：white/black 字面量抽 token

**目标**：surfaces/ 51 处 `color-mix(... white|black ...)` 全部改用 4 个语义 token，token 在 cascade 三主题各赋值。

**新增 token**（写入 cascade/dark.css、light.css、vscode-dark.css 各一份）：
| Token | 用途 | dark | light | vscode-dark |
|---|---|---|---|---|
| `--ui-scrim` | `::backdrop` 遮罩 | `color-mix(in srgb, black 60%, transparent)` | `color-mix(in srgb, black 40%, transparent)` | `color-mix(in srgb, black 60%, transparent)` |
| `--ui-shadow-tone` | 阴影色基底 | `color-mix(in srgb, black 32%, transparent)` | `color-mix(in srgb, black 12%, transparent)` | `color-mix(in srgb, black 32%, transparent)` |
| `--ui-highlight-tone` | glass 反光 | `color-mix(in srgb, white 6%, transparent)` | `color-mix(in srgb, white 56%, transparent)` | `color-mix(in srgb, white 4%, transparent)` |
| `--ui-glass-tint` | 半透明卡片底 | `color-mix(in srgb, white 4%, transparent)` | `color-mix(in srgb, white 62%, transparent)` | `color-mix(in srgb, white 3%, transparent)` |

具体值由 codex 在迁移过程中按现有视觉效果反推，spec 给的是初值参考。

**Codex prompt**：
```
读 specs/ui-design-discipline-overhaul-2026-05-07.md 的 Batch 2。

强制要求：
- 先 grep 全 packages/overlay/src/styles/surfaces 找所有 color-mix(... white|black ...) 字面量，列 51 处全清单。
- 每处对照其上下文判断属于哪个语义类：scrim（遮罩）/ shadow（阴影）/ highlight（高亮）/ glass-tint（半透明底）。

任务：
1. 在 cascade/dark.css、light.css、vscode-dark.css 各加 --ui-scrim、--ui-shadow-tone、--ui-highlight-tone、--ui-glass-tint 四个 token。三主题的值参考 spec 表格但允许按视觉反推调整。
2. surfaces/ 中 51 处 color-mix(... white|black ...) 全部改用对应 token。
3. 不允许出现新的 white|black 字面量。

验收：
- grep -rn 'color-mix\([^)]*\b(white|black)\b' packages/overlay/src/styles/surfaces 应返回 0
- 视觉对照（codex 需描述每个 token 在三主题的语义对齐：scrim 在 light 下应该是淡黑遮罩，shadow 在 light 下应弱）
- bun test 全过

提交：refactor(overlay/styles): extract --ui-scrim/--ui-shadow-tone/--ui-highlight-tone/--ui-glass-tint tokens, eliminate 51 white|black literals [rule 10]
git push
```

**验收（Claude）**：
```bash
# Grep tool: color-mix\([^)]*\b(white|black)\b 在 surfaces/，应该 = 0
# 跑 overlay 启动 + 三主题切换截屏对比（如有 visual regression test）
bun --cwd packages/overlay test 2>&1 | tail -10
```

---

### Batch 3：surfaces 主题分支 override 回 cascade

**目标**：消灭 surfaces/composer.css 和 conversation.css 中 5 处 `body[data-theme=...]` 局部 override，改成 cascade 三主题的 token 差值。

**调用点**：
- `composer.css:652-664` `.executor-menu`、`.executor-menu-row:hover`、`.executor-menu-model:hover` 在 light 下硬编码 `background: white` + 阴影
- `conversation.css:801-805` `.task-bar` light 主题色 + backdrop-filter
- `conversation.css:807-810` `.task-bar` dark+vscode-dark 共同样式
- `conversation.css:812-814` `.task-bar` vscode-dark 单独覆盖

**操作**：
1. 在 cascade 三主题各加 token：`--executor-menu-bg`、`--executor-menu-shadow`、`--executor-menu-row-hover-bg`、`--task-bar-bg`、`--task-bar-backdrop-filter`、`--task-bar-border-color`。
2. surfaces 改用 token，无 body[data-theme] selector。
3. backdrop-filter 是函数调用而非颜色值，token 接 `--task-bar-backdrop-filter: blur(...)` / `none`，三主题各值。

**Codex prompt**：
```
读 specs/ui-design-discipline-overhaul-2026-05-07.md 的 Batch 3。

任务：
1. 把 surfaces/composer.css:652-664 和 surfaces/conversation.css:801-814 中的 body[data-theme=...] 局部 override 抽成 token。
2. 在 cascade/dark.css、light.css、vscode-dark.css 各加：
   - --executor-menu-bg
   - --executor-menu-shadow
   - --executor-menu-row-hover-bg
   - --task-bar-bg
   - --task-bar-backdrop-filter （三主题分别 blur(18px)/none/none，根据现有视觉）
   - --task-bar-border-color
3. surfaces/composer.css、conversation.css 删除主题分支 selector，统一使用 token。
4. 同时复核 overlay-architecture-guards.test.ts:200 的 `body\[data-theme/g` ≤ 3 阈值断言：现在 surfaces/ 应该 = 0，把阈值改成 0 或者删除（cascade 内仍有 body[data-theme=] 是合法的，断言应限定在 surfaces/）。

验收：
- grep -rn 'body\[data-theme=' packages/overlay/src/styles/surfaces 应 = 0
- bun test 全过

提交：refactor(overlay/styles): hoist surfaces theme branches to cascade tokens [rule 8]
git push
```

**验收（Claude）**：grep + bun test。

---

### Batch 4：base.css :root 色值/color-scheme 重构 + 删死路径

**目标**：消灭 base.css `:root` 块的色值类 token + color-scheme 硬编码，全部移到三主题文件；删除 dark.css `body:not([data-theme])` 死路径及其测试断言。

**操作**：
1. `base.css:24` `color-scheme: dark` 删除。
2. `base.css:28` `--text-on-accent: #ffffff` 删除（移到三主题）。
3. `base.css:30` `--dialog-backdrop` 删除（已在三主题各声明，去掉 :root 这一份）。
4. `base.css:23-73` `:root` 块只保留布局常量（`--ui-scale`、`--ui-gap-*`、`--ui-titlebar-*`、`--ui-input-*`、`--ui-btn-*`、`--ui-pill-*`、`--ui-badge-*`、`--ui-card-*`、`--ui-section-*`、`--ui-dialog-*`、`--ui-status-dot`、`--ui-chat-*`、`--ui-select-*`），删除 `--ui-window-opacity`（如果是色彩相关，但实际是 opacity 控制，保留）和 `--text-on-accent`、`--dialog-backdrop`、`--session-scrollbar-size`（这些是色彩或主题相关）。

   实际审计：`--ui-window-opacity` 是 opacity 控制不是色值，保留；`--session-scrollbar-size` 是尺寸，保留。删除的只有 `color-scheme: dark`、`--text-on-accent`、`--dialog-backdrop`。
5. 三主题文件（cascade/dark.css、light.css、vscode-dark.css）的 selector 改成：
   - dark.css: `:root[data-theme="dark"], body[data-theme="dark"]`（删除 `body:not([data-theme])` 死路径）
   - light.css: `:root[data-theme="light"], body[data-theme="light"]`
   - vscode-dark.css: `:root[data-theme="vscode-dark"], body[data-theme="vscode-dark"]`
   - 加 selector `:root` 是因为 `applyTheme` 已经写 `documentElement.dataset.theme`，让 :root 上也跟随主题切。
6. 三主题文件各补 `--text-on-accent` 的值（`#ffffff` 三主题都是合理的，但允许各自微调；spec 默认值同 dark 即 `#ffffff`）。
7. 同步删除 `flat-redesign-theme-symmetry.test.ts:75-78` 的 `body:not([data-theme])` 安全网断言（rule 17 死代码），换成 `:root[data-theme="dark"]` 断言。
8. 同步删除 `surfaces/dialog.css:20` 的 `color-scheme: inherit` patch（不再需要，因为 :root 跟主题切了）和注释（rule 17）。

**Codex prompt**：
```
读 specs/ui-design-discipline-overhaul-2026-05-07.md 的 Batch 4。

任务：
1. base.css 的 :root 块删 color-scheme: dark / --text-on-accent / --dialog-backdrop 三条。
2. cascade/dark.css 选择器从 `body:not([data-theme]), body[data-theme="dark"]` 改成 `:root[data-theme="dark"], body[data-theme="dark"]`（删除 body:not([data-theme]) 死路径）。
3. cascade/light.css、vscode-dark.css 同步加 :root[data-theme="X"] 共同选择器。
4. 三主题文件各补 --text-on-accent（默认 #ffffff，按视觉需要可微调）。
5. surfaces/dialog.css:20 的 color-scheme: inherit 删除 + 注释删除（rule 17 死代码，原本是 :root color-scheme 钉死的 patch，现在不需要）。
6. 同步更新 flat-redesign-theme-symmetry.test.ts:75-78 把 body:not([data-theme]) 断言换成 :root[data-theme="dark"] 断言。
7. 检查 default-theme.test.ts 是否还断言 inline script — 暂不删，留到 Batch 5。

验收：
- grep -n 'color-scheme' packages/overlay/src/styles/cascade/base.css 应 = 0
- grep -n 'body:not\(\[data-theme\]\)' packages/overlay/src/styles 应 = 0
- bun test packages/overlay/test/flat-redesign-theme-symmetry.test.ts 全过
- 视觉自测：切换三主题，:root 的 color-scheme 应跟随（开 devtools 检查 html 元素 computed style）

提交：refactor(overlay/cascade): retire base.css :root color tokens + dark.css boot deadcode, hoist :root[data-theme=...] [rule 7,17]
git push
```

**验收（Claude）**：grep + bun test + Read 几个 cascade 文件确认。

---

### Batch 5：boot 时序简化

**目标**：删 index.html inline script + main.tsx createEffect 立即触发的 applyTheme。

**操作**：
1. 删 `index.html:44-56` inline script。
2. `main.tsx` 的 `createEffect(() => applyTheme(settingsStore.theme))` 移到 `loadSettings()` await 完之后第一次执行（或者用 `createMemo` 等 settings 字段就绪）。
3. 同步更新 `default-theme.test.ts:23-24` 删除 `'document.documentElement.dataset.theme = "light"'` 断言（不再有 inline script）。

**Codex prompt**：
```
读 specs/ui-design-discipline-overhaul-2026-05-07.md 的 Batch 5。

任务：
1. 删除 index.html:44-56 的 inline script 整段。
2. 在 main.tsx 找到 createEffect(() => applyTheme(settingsStore.theme))，确认它在 initApp() / loadSettings() await 之后才第一次执行，不要在 settings 未 hydrate 时立即应用 DEFAULT_THEME 一次（当前是立即触发）。如果当前架构无法直接调整，至少把 createEffect 移到 loadSettings 完成的回调内创建。
3. 更新 default-theme.test.ts:23-24 删除 inline script 相关断言，加新断言"index.html 不包含 dataset.theme 写入"（保证不回归）。

验收：
- grep -n 'document.documentElement.dataset.theme' packages/overlay/src/index.html 应 = 0
- bun test packages/overlay/test/default-theme.test.ts 全过

提交：refactor(overlay/boot): retire inline theme bootstrap script, gate applyTheme on settings hydrate [rule 8 dedup]
git push
```

---

### Batch 6：VSCode webview host theme handshake

**目标**：让 overlay 在 VSCode webview 启动时跟随 VSCode 当前主题。

**操作**：
1. `packages/vscode-extension/src/webview/panel.ts`（或对应入口）读 `vscode.window.activeColorTheme.kind`，在创建 webview 时把初始主题字符串传给 webview（通过 `panel.webview.options.localResourceRoots` 之外的 query string / `<script>window.__VSCODE_THEME__ = ...</script>` 注入）。
2. 监听 `vscode.window.onDidChangeActiveColorTheme`，每次变化通过 `panel.webview.postMessage({ type: "host:theme", kind })` 通知 overlay。
3. `packages/overlay/src/services/host-transport.ts`（或对应 bridge）接收 `host:theme` 消息，调 `settingsStore.setTheme(...)`。
4. `services/theme.ts:69` `resolvedTheme()` 在 `system` 选项下，host 是 vscode-webview 时优先解析为 vscode-dark / light（按 `kind`）。
5. 默认 `settings.theme` 在 vscode-webview 宿主下从 "light" 改为 "system"（让用户首次打开自动跟随 VSCode）。

**Codex prompt**：
```
读 specs/ui-design-discipline-overhaul-2026-05-07.md 的 Batch 6。

任务（跨包，注意 packages/overlay 和 packages/vscode-extension 的 SDK 边界）：
1. packages/vscode-extension/src/webview/panel.ts（或同等位置）：
   - 创建 webview 时读 vscode.window.activeColorTheme.kind（Light/Dark/HighContrast/HighContrastLight）映射到 overlay 主题（"light" / "vscode-dark" / "vscode-dark" / "light"）。
   - 注入到 webview 初始 HTML 的 <script> 块：window.__VSCODE_INITIAL_THEME__ = "..."
   - 注册 vscode.window.onDidChangeActiveColorTheme 监听，postMessage({ type: "host:theme", theme: ... }) 给 webview。
2. packages/overlay/src/services/host-transport.ts（或 vscode 适配器）：
   - 接收 host:theme 消息，调用 settings store 的 setTheme。
   - 启动时如果 window.__VSCODE_INITIAL_THEME__ 存在，初始 settings.theme 用它。
3. packages/overlay/src/services/theme.ts:
   - resolvedTheme() 的 system 分支：在 host kind === "vscode-webview" 时，根据 window.__VSCODE_INITIAL_THEME__ 或 settings 解析到 vscode-dark / light，而不是仅 dark/light 二分。
4. 在 packages/overlay/test/ 加 e2e 或 unit 测试：模拟 host:theme 消息，断言 settings.theme 被更新且 applyTheme 写入正确的 dataset.theme。

验收：
- bun test 全过 + 新加的 host theme handshake 测试通过
- 手测：在 VSCode 切换主题，webview 内 overlay 跟随切换（commit body 描述测试方法）

提交：feat(vscode-extension+overlay): wire host theme handshake — webview follows VSCode active color theme [rule 7,8]
git push
```

**验收（Claude）**：跑测试 + 手测引导（用户实际打开 VSCode 验）。

---

### Batch 7：UI 状态机 → data-attr 驱动

**目标**：消灭 1.6 节列出的真违规状态机。

**操作**：
1. 新建 `packages/overlay/src/utils/status-mapping.ts`，导出：
   ```ts
   export const TASK_STATUS_PRIORITY: Record<string, number> = {
     pending: 0, queued: 1, active: 2, completed: 3, failed: 3, cancelled: 3,
   };
   export function goalStatusToTaskStatus(s: string): TaskStatus { /* passed→completed, failed→failed, running→active, default→idle */ }
   ```
2. `Board.tsx` 的 `statusIconName` 改成从 status-mapping 导出（保留为合规集中映射，不删）。
3. `GoalWorkflowGroup.tsx`：
   - `goalStatusIconName` 删除，改用 `statusIconName(goalStatusToTaskStatus(status))`。
   - `goalStatusClass` 删除，模板从 `class={\`gwg ${goalStatusClass(...)}\`}` 改成 `class="gwg" data-goal-status={status}`。
   - CSS 同步：`.gwg--passed` → `.gwg[data-goal-status="passed"]`（如果对应 CSS 存在）。
4. `RequirementsPanel.tsx`：`statusBadgeClass` 删除，模板 `class={\`req-status ${statusBadgeClass(...)}\`}` 改成 `class="req-status" data-req-status={status || "pending"}`。CSS 同步。
5. `EvaluationCriteriaPanel.tsx`：`statusIcon` 删除，4 处调用改 `<Icon name={statusIconName("passed"/"failed"/"skipped")} />`（"skipped" 需要 status-mapping 加 case）。
6. `TodoListPart.tsx`：`statusIcon` 删除，调用改 Icon 组件。"in_progress" / "pending" / "cancelled" 添加到 IconName 集合或映射到现有图标。
7. `TaskList.tsx:95-96` 三元链改 `TASK_STATUS_PRIORITY[status] ?? 99` 排序。

**Codex prompt**：
```
读 specs/ui-design-discipline-overhaul-2026-05-07.md 的 Batch 7。

任务：
1. 新建 packages/overlay/src/utils/status-mapping.ts 集中所有 status → icon name / priority 映射。
2. Board.tsx 的 statusIconName 移到 status-mapping.ts，原文件 re-export 或 import 使用。
3. GoalWorkflowGroup.tsx 删除 goalStatusIconName + goalStatusClass，改用 status-mapping + data-goal-status attr。
4. RequirementsPanel.tsx 删除 statusBadgeClass，改用 data-req-status attr。
5. EvaluationCriteriaPanel.tsx 删除 statusIcon (unicode 字面量)，改用 <Icon name={...} />。
6. TodoListPart.tsx 删除 statusIcon (unicode 字面量)，改用 <Icon> 组件。Icon.tsx 的 ICON_PATHS 如果缺失对应 status name，新增。
7. TaskList.tsx:95-96 三元链改 TASK_STATUS_PRIORITY 查表。
8. CSS 同步：modifier class 改 attr selector（`.gwg--passed` → `.gwg[data-goal-status="passed"]`）。
9. 删除遗留 .gwg--passed / .req-status--passed 类（如果还存在）。

验收：
- grep -rn 'function .*[Ss]tatus.*Class\(' packages/overlay/src/components 应 = 0
- grep -rn '"\\u271[34]"\|"\\u25D0"\|"\\u25CB"\|"\\u2715"' packages/overlay/src/components 应 = 0
- 视觉自测：状态显示正常（spinner / 完成勾 / 失败叉）
- bun test 全过

提交：refactor(overlay/components): retire UI status switches, hoist to data-attr + status-mapping single source [rule 11,13]
git push
```

---

### Batch 8：动效字面量 → token

**目标**：5 处 animation 时长字面量改用 `--ui-duration-*` token。

**操作**：
1. 在 `tokens/design-language.css` 加新 token：`--ui-duration-loop-spin: 0.8s`、`--ui-duration-loop-pulse: 1.6s`、`--ui-duration-loop-progress: 1.1s`（如果不已有）。
2. 替换：
   - `card.css:626` `0.8s` → `var(--ui-duration-loop-spin)`
   - `card.css:1688` `1.6s` → `var(--ui-duration-loop-pulse)`
   - `conversation.css:87` `1.1s` → `var(--ui-duration-loop-progress)`
   - `cmdk.css:20` `0.12s` → `var(--ui-duration-fast)`（已存在 token）
   - `field.css:102` `9999s` autofill hack — 加注释说明，**保留例外**（这是 Chrome 浏览器 hack，不是设计时长）

**Codex prompt**：
```
读 specs/ui-design-discipline-overhaul-2026-05-07.md 的 Batch 8。

任务：
1. tokens/design-language.css 加 --ui-duration-loop-spin: 0.8s、--ui-duration-loop-pulse: 1.6s、--ui-duration-loop-progress: 1.1s（如果不已有）。
2. 替换 4 处字面量为 token。
3. field.css:102 的 9999s 加注释说明它是 Chrome autofill hack，保留字面量，例外在 motion-coverage.test.ts 加 inline ignore comment。
4. 强化 flat-redesign-motion-coverage.test.ts 覆盖 animation: 时长（不只 transition:）。

验收：
- grep -rEn 'animation:[^;]*\b\d+(\.\d+)?m?s\b' packages/overlay/src/styles 应只在 field.css:102（autofill hack）和 cascade/tokens 内
- bun test packages/overlay/test/flat-redesign-motion-coverage.test.ts 全过

提交：refactor(overlay/styles): tokenize 4 animation durations, document autofill 9999s exception [rule 10]
git push
```

---

### Batch 9：启用守卫 + 测试加固

**目标**：启用 Batch 0 创建的所有 placeholder 守卫，加 inline style 检查、symmetry 强化、status discipline。

**Codex prompt**：
```
读 specs/ui-design-discipline-overhaul-2026-05-07.md 的 Batch 9。

任务：
1. 启用 packages/overlay/test/flat-redesign-color-literal-coverage.test.ts 全部 it.skip → it（应该全过，因为前面批次已清干净）。
2. 启用 flat-redesign-theme-cascade-discipline.test.ts 全部 it。
3. 启用 flat-redesign-status-discipline.test.ts 全部 it。
4. 加 packages/overlay/test/flat-redesign-inline-style-coverage.test.ts：扫描 components/**/*.tsx 中 style={{...}} 含颜色 / 尺寸字面量，应 = 0（仅允许 transform / opacity / display 等非视觉决策属性）。
5. 强化 flat-redesign-theme-symmetry.test.ts 加 light↔vscode-dark 对称检查（98-120 行后追加 describe）。

验收：
- bun test packages/overlay/test/flat-redesign-* 全过
- bun test packages/overlay/test/overlay-architecture-guards.test.ts 全过

提交：feat(overlay/test): enable color/cascade/status/inline-style discipline guards [rule 36]
git push
```

---

## 4. 中断恢复

如果某批失败：
1. codex 必须把失败原因写入该批 commit 的 body，不要 push 残缺 commit。
2. 失败的批次锁住下游，直到修复。
3. 二次审查（rule 24/35）：每批 push 后由 Claude 跑验收命令；如发现遗漏调用点，原批次显式标注 "codex 审查反馈" 加补丁 commit，禁止静默重写。

## 5. 完成标准

- 所有 9 批 commit 入主线（dev 分支）。
- 全套 flat-redesign-*.test.ts + overlay-architecture-guards.test.ts 0 失败。
- `grep -rn 'body\[data-theme=' packages/overlay/src/styles/surfaces` = 0。
- `grep -rEn 'color-mix\([^)]*\b(white|black)\b' packages/overlay/src/styles/surfaces` = 0。
- `grep -rn 'function .*[Ss]tatus.*Class\(' packages/overlay/src/components` = 0。
- VSCode webview 中切换 VSCode 主题，overlay 跟随切换（手测）。
- 用户视觉确认：dark / vscode-dark 主题不再"混入异色"。
