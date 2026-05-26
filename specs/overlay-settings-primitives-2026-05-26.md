# Overlay Settings Primitives (2026-05-26)

> Settings dialog 各 panel 的字号、card 容器、行布局长期各写各的 — `perm-row` / `extension-row` / `market-card` / `channel-doc-card` / `provider-flat-row` / `agent-model-row` / `knowledge-item` 七套类做同一件事，settings.css 已经膨胀到 2700+ 行。本次重构建立一套 `.s-*` primitive 作为单一来源（rule 8），按 VSCode/JetBrains 风格 — 完全 flat、无 card 边框、靠 spacing + font-weight 分层。

## 设计契约

### 视觉基调
- **完全 flat**：primitive 默认 `border: 0; background: transparent; border-radius: 0`。需要边界感的位置靠 spacing + 微妙的 hover wash 表达。
- **hover wash** 走 `--settings-surface-hover`（已在 `.config-dialog-layout` 上 derive 自 `--surface-hover`）；不画 shadow，不画 transform。
- **字号不变**：`--ui-font-heading: 14px` / `--ui-font-title: 13px` / `--ui-font-body: 12px` 不动。层级靠 `--ui-font-weight-strong` (600) / `medium` (500) / `body` (400) + `--text-strong` / `--text-soft` / `--text-muted` 表达。
- **spacing 单一来源**：所有 padding / gap 必须来自 `--ui-gap-xs/sm/md/lg` 或 `--section-*` 已有 token，禁止裸 `calc(Npx * var(--ui-scale))`。

### Primitive 清单

| Primitive | 角色 | 替换的旧类 |
|---|---|---|
| `.s-panel` | panel 最外层 wrapper（提供整体 padding 和列方向 flex） | `perm-panel` / `memory-panel` / `general-panel` / `provider-panel` |
| `.s-group` | 一个分组容器 | `config-panel-group` / `extension-block` / `ext-group` |
| `.s-group-head` | 分组头部（标题 + 可选 actions） | `config-panel-group-head` / `extension-head` / `provider-section-head` / SurfaceHeader[variant="settings-group"] |
| `.s-group-body` | 分组正文 | `config-panel-card` / `extension-list` / `ext-group-body` / `provider-flat-list` |
| `.s-row` | 列表行（一条权限 / 一个 provider / 一个 channel / 一条记忆等） | `perm-row` / `extension-row` / `market-card` / `channel-doc-card` / `provider-flat-row` / `agent-model-row` / `knowledge-item` / `config-toggle-list-item` |
| `.s-row-main` | 行的左侧主信息区 | `perm-row-info` / `extension-row-main` / `market-card-main` / `channel-doc-copy` / `provider-row-main` / `knowledge-item-main` |
| `.s-row-title` | 行的标题（13px strong） | `perm-row-label` / `extension-row strong` / `market-card-main strong` / `knowledge-item-title` |
| `.s-row-desc` | 行的描述（12px soft） | `perm-row-desc` / `extension-row span` / `market-card-main span` / `channel-doc-title` |
| `.s-row-meta` | 行的次要 meta（12px muted） | `extension-row small` / `market-card-main small` / `channel-doc-credit` / `knowledge-item-meta` |
| `.s-row-actions` | 行的右侧按钮 cluster | `perm-row-actions` / `extension-row-actions` / `market-card-actions` / `channel-row-actions` / `provider-row-actions` / `knowledge-item-actions` |
| `.s-pill` (+ `data-tone="ok\|warn\|bad\|neutral\|accent"`) | 状态徽章 | `extension-status` / `provider-row-status` / `provider-count-pill` / `knowledge-scope` |
| `.s-toolbar` | 搜索 / 筛选工具栏 | `knowledge-toolbar` / `provider-search-field`-as-toolbar |
| `.s-empty` | 空态文字 / 占位 | `empty-hint` / `provider-empty` 中的 inline 形式 |
| `.s-segmented` + `.s-segmented-btn[data-active][data-tone]` | tri-state 分段控件 | `perm-action-btn` (allow/ask/deny) |

### 互动状态
- `.s-row:hover` → `background: var(--settings-surface-hover)`（仅当 row 是可点击或包含 hover-able 子项时；通过 `data-interactive="true"` opt-in，避免误为静态信息行加 hover）
- `.s-row:focus-within` → 同上 + 不改 border
- `.s-segmented-btn[data-active="true"]` → 用 `color-mix` 在对应 tone 上 24%，匹配现有 perm-action-btn 配色，作为 visual contract 不动

### Solid 组件 API

```tsx
<SettingsPanel>
  <SettingsGroup title={t("settings.section.connection")} actions={<Button…/>}>
    <SettingsRow
      title={t("settings.server_url")}
      desc={t("settings.server_url_hint")}
      actions={<Button>Save</Button>}
    >
      <input class="field-input" … />
    </SettingsRow>
  </SettingsGroup>
</SettingsPanel>
```

- `SettingsRow` 接受 `title` / `desc` / `meta` / `actions` / `leading` / `children` slot；如果 `children` 传入则不显示 desc（用 child 作为 main 区内容，desc/meta 转为 sub-text）。
- `SettingsPill tone="ok|warn|bad|neutral|accent"` → `<span class="s-pill" data-tone="...">`
- `SettingsSegmented options={[{id, label, tone, active}]} onChange={…}` → 替代 perm-action-btn 三态

## 迁移顺序

1. **PermissionsPanel** — 体量小、类家族独立、最能验证 Segmented + Row 组合 → 本次实施
2. ChannelsPanel
3. SkillMarketPanel
4. ProvidersPanel（最复杂，6 个 row-子容器 → 用 Row 的多 slot 表达）
5. AgentModelsPanel
6. MemoryPanel
7. PromptCatalog（Row + ActionBar，再做 textarea/preview）
8. GeneralPanel（已经最接近，最后做以验证 primitives 已稳态）

每迁一个 panel：
- 删除该 panel 在 settings.css 中的旧类块（rule 8）
- 更新 `overlay-architecture-guards.test.ts` 中对应的 "owned by surfaces/settings.css" guard
- commit + push（rule 33）

## 拒绝清单（防止 rule 5/6 过度工程）

- **不**抽 `<SettingsField>` 替代 `.field` — 现有 `.field` / `.field-input` / `.field-label` 已经是 single source，再包一层只会绕。
- **不**给 `<SettingsCard>` 加 elevation / shadow 变体 — VSCode 风一律 flat。
- **不**写 BEM `__` 子类，s-row-actions 直接用连字符，与现有 token 命名一致。
- **不**做主题切换 storybook — 这是 Settings 内部统一，不是设计系统对外。

## 测试责任分配

- `overlay-architecture-guards.test.ts`：primitives 必须 owned by `settings.css`；老类家族必须从 settings.css 删除。
- `settings-primitives.test.ts`（新）：组件级 render 测试，断言 slot 行为 + tone data 属性 + segmented active 切换。
- 每个 panel 迁移配一个 panel-level render 测试，断言用了新的 primitive class（不再用旧类）。
