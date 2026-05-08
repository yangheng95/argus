# UI 设计规范围剿 Round 2（2026-05-07）

> 总指挥：Claude Opus 4.7
> 执行者：Codex（`codex exec`）
> 验收人：Claude
>
> Round 1（specs/ui-design-discipline-overhaul-2026-05-07.md）9 批已完成，覆盖 theme cascade / 双源 / 颜色字面量 / 状态机 / boot 时序 / host theme handshake / 动效字面量。
>
> Round 2 扩大范围：5 个 Explore agent 并行审查，发现 **127 处剩余违规**，覆盖 CSS 非颜色字面量、CSS 卫生、TSX 视觉决策、i18n 硬编码、守卫加固。

---

## 1. 围剿对象总清单

### 1.1 CSS 非颜色字面量（70 处，rule 10）

**letter-spacing 56 处**（em/px 字面量）：
- `card.css`: 335, 507, 780, 872, 937, 1010, 1070, 1093, 1594, 1664（10 处）
- `composer.css`: 327, 687, 696（3 处）
- `conversation.css`: 158, 828, 864, 935（4 处）
- 其他 11 个 surfaces 各 1-3 处
- 决策：抽 `--ui-letter-spacing-tight/normal/loose` token

**@media breakpoint 14 处**（px 字面量）：
| 文件 | 行 | 断点 |
|---|---|---|
| composer.css | 414 | 700px |
| conversation.css | 43, 1160 | 900px, 760px |
| messages.css | 672 | 520px |
| settings.css | 1765, 2237, 2379 | 820px, 760px |
| titlebar.css | 171, 201, 675, 880, 853 | 760px, 520px, 32.5em |
| workspace.css | 547 | 1120px |
| workspace-onboarding.css | 253 | 860px |

- 决策：抽 `--ui-breakpoint-sm(520) / -md(760) / -lg(900) / -xl(1120)` token；用 `@media (max-width: var(--ui-breakpoint-X))`

### 1.2 CSS 卫生（25 处）

**!important 9 处滥用**（删除）：
- `cmdk.css:145` 动画禁用（用 specificity 替代）
- `conn-banner.css:91` 同上
- `workspace-onboarding.css:10` 背景（无 specificity 冲突）
- `workspace.css:416,424` `.pane-resizer` 游标
- `settings.css:1285` `.about-body gap`
- 删除 9 处，保留 4 处合法（base.css `[hidden]`、`base.css:167 .hidden`、`base.css:173` reduced-motion、`field.css:99-100` autofill webkit hack）

**重复 class 跨文件 23 处**：
- `.mini-badge` typography.css:45,57 + settings.css + sidebar.css（应单源 → typography.css）
- `.config-section-head` typography.css:16 + settings.css:1000
- `.config-subsection-head` typography.css:23 + settings.css:1144
- `.dialog-subtitle` typography.css:22 + dialog.css:88
- 决策：settings.css / sidebar.css 删除重复定义，改用 typography.css 单源

**死代码 selector ~12 处**：
- `.mini-badge` 在 settings.css + sidebar.css 定义但 components 无人引用
- 12 个 selector 定义但实际只在 inline style / data-attr 用（非 class 引用）
- 决策：grep components 对照 styles，删除无引用的 selector

**stylesheet 加载顺序错配**：
- `index.html:7-12` 当前 `tokens → dark/vscode-dark/light → base → typography → primitives → surfaces`
- 应该 `tokens → base → themes → typography → primitives → surfaces`
- 决策：base.css 提前到 themes 之前

### 1.3 TSX 视觉决策违规（12 处，rule 11/13/15）

**TextPart.tsx 直接 DOM 操作**（违反 SolidJS 反应式）：
- TextPart.tsx:69, 95-103, 116-118, 125 用 `document.createElement / innerHTML / insertBefore / appendChild`
- 决策：改成 SolidJS `<For>` / `<Show>` + 信号驱动

**className 拼接视觉变体**：
- `ChatComposer.tsx:569` `class={\`chat-send${props.busy ? " chat-interrupt" : ""}\`}`
- 决策：改 `class="chat-send" data-busy={props.busy}` + CSS `.chat-send[data-busy="true"]`

**Board.tsx badgeTone 三元链**（5 处）：
- :680 `badgeTone={isGenerating ? "accent" : ""}`
- :683 `badgeTone={failed > 0 ? "bad" : passed === rs.length ? "good" : "accent"}`
- :704 `badgeTone={architect() ? "accent" : ""}`
- :723, :763, :792 IIFE 内三元
- 决策：抽 `verdictTone(checks: ...)` 单源 helper / 或改 data-verdict attr

**ConfigDialogHost.tsx 多源 listener**（:165-185）：
- pointermove/pointerup/pointercancel 多 global window listener
- 决策：抽组件 / 单一 listener registry

**Conversation.tsx scroll listener**（:100-102）：
- `el.addEventListener("scroll", resumeTracking)` + removeEventListener 对
- 改用 `onScroll={...}` prop

### 1.4 i18n 卫生（20 处，rule 15）

**fallback || 反模式 2 处**：
- Board.tsx:748 `title={t("section.criteria") || "评估指标"}`
- CardHeader.tsx:451 `title={t("card.rewind") || "回到这一步"}`
- 决策：删除 `|| "xxx"`（rule 7 禁 fallback；t() 应该保证 key 存在）

**title/aria-label 硬编码英文 9 处**：
- Card.tsx:361, 364
- CardHeader.tsx:277, 410, 452
- ChatComposer.tsx:465 "Remove"
- CommandPalette.tsx:302 "Command palette"
- TitlebarMenubar.tsx:354 "OpenCorvus"
- TracePanel.tsx:284 "Copy trace as JSON"
- 决策：走 `t()` 或 `data-i18n-aria-label` + 加 i18n key

**placeholder 硬编码示例值 9 处**（决策待定 — 占位文本可能不需要 i18n）：
- 多在 ProvidersPanel / ChannelsPanel / SkillMarketPanel 的输入框
- 决策：评估是否走 i18n，或者作为"开发者不可见的示例值"白名单

### 1.5 测试守卫加固（rule 36）

**启用未启用的守卫**：
- `flat-redesign-inline-style-coverage.test.ts`（Round 1 Batch 9 创建未启用）

**新增守卫**：
- `flat-redesign-letter-spacing-coverage.test.ts`：surfaces/ 禁 letter-spacing 字面量
- `flat-redesign-breakpoint-coverage.test.ts`：surfaces/ 禁 @media (...px) 字面量
- `flat-redesign-important-policy.test.ts`：surfaces/ 禁 `!important`（白名单 4 处合法）
- `flat-redesign-class-uniqueness.test.ts`：每个 class selector 单源（除显式覆盖白名单）
- `flat-redesign-i18n-fallback-policy.test.ts`：禁 `t(...) || "..."` 反模式

---

## 2. 分批执行计划

```
R2-1 CSS 非颜色字面量（letter-spacing + breakpoint） — 70 处
  ↓
R2-2 CSS 卫生（!important + 重复 class + 死代码 + 加载顺序） — 25 处
  ↓
R2-3 TSX 视觉决策（TextPart + Board badgeTone + ChatComposer + ConfigDialogHost） — 12 处
  ↓
R2-4 i18n 卫生（fallback + title 硬编码） — 11+9 处
  ↓
R2-5 测试守卫加固 + 启用 inline-style + 5 个新守卫
```

每批 commit + push（不绕 hook）。验收 grep + bun test 通过才进下一批。

---

## 3. 各批详情

### R2-1: letter-spacing + breakpoint token 化

**Codex prompt**：
```
读 specs/ui-design-discipline-overhaul-round2-2026-05-07.md 第 1.1 节。

任务：
1. tokens/design-language.css 加：
   --ui-letter-spacing-tight: -0.01em
   --ui-letter-spacing-normal: 0
   --ui-letter-spacing-loose: 0.04em
   --ui-breakpoint-sm: 520px
   --ui-breakpoint-md: 760px
   --ui-breakpoint-lg: 900px
   --ui-breakpoint-xl: 1120px

2. surfaces/ 56 处 letter-spacing: 0.01em/0.02em/... → 选最近的 tight/normal/loose token

3. 14 处 @media (max-width: NNNpx) → @media (max-width: var(--ui-breakpoint-X))
   注意 CSS 规范：媒体查询里的 var() 受限，可能要用 custom-media 或加注释保留字面量

验收：
- rg 'letter-spacing:\s*-?[\d\.]+(em|px|%)' packages/overlay/src/styles/surfaces → 0
- rg '@media\s*\([^)]*\d+px\)' packages/overlay/src/styles/surfaces → 0（或例外）
- bun test 全过

提交：refactor(overlay/styles): tokenize letter-spacing + breakpoint literals [rule 10 round-2]
```

### R2-2: CSS 卫生清理

**Codex prompt**：
```
读 spec round-2 第 1.2 节。

任务：
1. 删除 9 处 !important 滥用（保留 4 处白名单：base.css [hidden] / .hidden / reduced-motion / field.css autofill）
2. 合并重复 class：settings.css 的 .mini-badge / .config-section-head / .config-subsection-head 等定义删除，统一在 typography.css
3. dialog.css:88 .dialog-subtitle 删除（已在 typography.css）
4. 死代码 selector：grep components 找无引用 class，删除（向用户确认 list 后再删）
5. index.html stylesheet 加载顺序：base.css 移到 themes 之前

验收：
- rg '!important' packages/overlay/src/styles | wc -l → ≤ 4
- 每个 class selector 单源（同一 class 在 ≤ 1 个 css 文件定义）
- bun test 全过

提交：refactor(overlay/styles): retire !important abuse + dedupe cross-file class definitions [rule 8 round-2]
```

### R2-3: TSX 视觉决策迁移

**Codex prompt**：
```
读 spec round-2 第 1.3 节。

任务：
1. TextPart.tsx 重构：删除 createElement/innerHTML/insertBefore/appendChild，改用 SolidJS <For>/<Show>/{信号}
2. ChatComposer.tsx:569 chat-send 加 data-busy attr，CSS 改 [data-busy="true"] selector
3. Board.tsx 5 处 badgeTone 三元 → 抽 utils/verdict-tone.ts 单源 helper（rule 8）
4. ConfigDialogHost.tsx:165-185 resize handler 重构：抽 useResizable hook，单 listener
5. Conversation.tsx:100-102 onScroll prop 替代 addEventListener

验收：
- rg 'innerHTML\s*=' packages/overlay/src/components → 0（除 markdown 隔离组件）
- rg 'addEventListener.*window' packages/overlay/src/components → 限制在合理框架（如全局快捷键）
- bun test + typecheck 全过

提交：refactor(overlay/components): retire DOM imperative + visual ternary chains, single-source via hooks/data-attr [rule 11,13,15]
```

### R2-4: i18n 卫生

**Codex prompt**：
```
读 spec round-2 第 1.4 节。

任务：
1. 删除 2 处 t(...) || "fallback" 反模式：
   - Board.tsx:748
   - CardHeader.tsx:451
   - 确认 i18n key 存在（en-US.json + zh-CN.json）
2. 9 处硬编码 title/aria-label 走 i18n：
   - 在 i18n/en-US.json + zh-CN.json 加 key
   - 改 t() 调用或 data-i18n-aria-label
3. placeholder 9 处评估：
   - 如果是用户可见的"输入提示"（如 URL/示例 token） → 走 i18n
   - 如果是内部不变的格式标记 → 加白名单 + 注释
4. i18n panel_revision 同步（如果 index.html 因加 data-i18n-* 改了）

验收：
- rg 't\([^)]*\)\s*\|\|\s*"' packages/overlay/src → 0
- 9 处 title 字面量替换
- bun test 全过 + i18n check 通过

提交：refactor(overlay/i18n): retire t() || fallback + tokenize hardcoded title/aria-label [rule 7,15 round-2]
```

### R2-5: 测试守卫加固

**Codex prompt**：
```
读 spec round-2 第 1.5 节。

任务：
1. 启用 flat-redesign-inline-style-coverage.test.ts（Round 1 Batch 9 漏启用）
2. 新建 flat-redesign-letter-spacing-coverage.test.ts：surfaces/ 禁 letter-spacing 字面量
3. 新建 flat-redesign-breakpoint-coverage.test.ts：surfaces/ 禁 @media px 字面量
4. 新建 flat-redesign-important-policy.test.ts：surfaces/ 禁 !important（白名单 4 处）
5. 新建 flat-redesign-class-uniqueness.test.ts：每个 class selector 单源
6. 新建 flat-redesign-i18n-fallback-policy.test.ts：禁 t(...) || ""

验收：
- 5 个新 test 文件 + 1 个 enable 全过
- bun test 全过

提交：feat(overlay/test): R2 guards — letter-spacing/breakpoint/important/class-uniqueness/i18n-fallback [rule 36]
```

---

## 4. 完成标准

- 5 批全部 commit + push
- 6 个新守卫 + 1 个启用守卫全过
- 总违规 127 处全消灭（除明确白名单）
- bun test + typecheck + i18n check 全过
- 视觉手测无 regression
