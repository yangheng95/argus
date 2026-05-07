# Inspector Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-tab right panel with a single scrollable column of collapsible InspectorSection cards, each containing unified InspectorRow items.

**Architecture:** Two new Solid primitives (`InspectorSection`, `InspectorRow`) compose into a single `InspectorPanel` component that mounts in a simplified `index.html` shell. The three-tab structure (`rightPanelWorkflow` / `rightPanelInspector` / `rightPanelPreview`) and all associated tab-switching code in `main.tsx` are removed.

**Tech Stack:** Solid.js, CSS custom properties (all from existing token set), Bun test (static-analysis style), TypeScript.

---

## File Map

### Create
| File | Responsibility |
|------|---------------|
| `packages/overlay/src/components/InspectorSection.tsx` | Collapsible section shell: header button + badge + chevron + grid-template-rows body |
| `packages/overlay/src/components/InspectorRow.tsx` | Unified row: status dot / prefix / tag + label + meta badge |
| `packages/overlay/src/components/InspectorPanel.tsx` | Right-panel root: reads boardStore + preview props; renders 5 InspectorSections |
| `packages/overlay/src/styles/surfaces/inspector-panel.css` | All CSS for the three new components |
| `packages/overlay/test/inspector-section.test.ts` | CSS contract + JSX export guards for InspectorSection |
| `packages/overlay/test/inspector-row.test.ts` | CSS contract + JSX export guards for InspectorRow |
| `packages/overlay/test/inspector-panel.test.ts` | Pure-function guards for goalStatusToDot, changePrefix, criteriaStatusToDot |

### Modify
| File | Change |
|------|--------|
| `packages/overlay/src/index.html` | Remove `sections-header` + 3 `sections-tab-body` divs; add `<div id="solidInspectorPanelMount" class="sections-stack">` |
| `packages/overlay/src/main.tsx` | Remove tab signals/functions/effects; remove individual section mounts; add InspectorPanel mount |
| `packages/overlay/src/styles/surfaces/inspector.css` | Delete `.sections-tab-body` and `.sections-tabs` rule blocks |
| `packages/overlay/src/styles/surfaces/header.css` | Delete `.sections-tabs.oc-surface-header__actions` rule block |
| `packages/overlay/src/i18n/en-US.json` | Remove `right_panel.tabs`, `right_panel.workflow`, `right_panel.inspector`, `right_panel.preview` keys |
| `packages/overlay/src/i18n/zh-CN.json` | Same |

### Retire from `main.tsx` (lines to delete)
- `rightPanelTab` + `rightPanelManualKey` signals
- `selectRightPanelTab()` function
- `rightPanelTabsEl` render (Tabs + three Tab components)
- `agentWorkflowMountEl` render (AgentWorkflowPanel)
- `filesSectionMountEl` render (FilesSection) — data migrated into InspectorPanel
- `solidDeliveryMount` render (DeliveryPanel) — data migrated into InspectorPanel
- `frontendPreviewMountEl` render (FrontendPreviewPanel) — migrated into InspectorPanel props
- `createEffect` for `data-active` tab switching (lines 1005–1013)
- `solidBoardMount` render (Board component) — Goals/Architect migrated into InspectorPanel; task action callbacks (onRetry/onReplan/onCancel) move to InspectorPanel props

> **Note:** `frontendPreviewResolution`, `frontendPreviewLoading`, `frontendPreviewError`, `refreshFrontendPreview` stay in `main.tsx` — they become props passed to InspectorPanel.

> **Note on Board.tsx fate:** Board.tsx currently renders Requirements, Architect, Goals sections in the right panel. With InspectorPanel taking over the right panel, Board.tsx is retired from the right-panel mount. The Requirements section is dropped from the new design (it was already behind `taskScopeSections()` and is low-priority for the new unified panel). The GoalWorkflowGroup card (with edit/delete controls) is replaced by simple InspectorRow items; goal editing can be done via the conversation context.

---

## Task 1: Create `inspector-panel.css`

**Files:**
- Create: `packages/overlay/src/styles/surfaces/inspector-panel.css`

- [ ] **Step 1: Write the CSS file**

```css
/* ── inspector-panel.css ──
   Owns all visual chrome for InspectorSection, InspectorRow, and the
   InspectorPanel shell. All values route through existing design tokens;
   no hex literals, no literal z-index, no literal opacity outside tokens. */

/* ── InspectorSection ── */

.inspector-section {
  display: flex;
  flex-direction: column;
}

.inspector-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 28px;
  padding: 0 6px;
  border: none;
  border-radius: var(--oc-radius-soft);
  background: transparent;
  cursor: pointer;
  gap: 4px;
  text-align: left;
  transition: background var(--ui-duration-fast) var(--ui-timing-standard);
}

.inspector-section__header:hover {
  background: var(--surface-hover);
}

.inspector-section__title {
  flex: 1;
  min-width: 0;
  font-size: var(--ui-font-meta);
  font-weight: var(--ui-font-weight-medium);
  color: var(--text-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.inspector-section__header-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.inspector-section__badge {
  font-size: var(--ui-font-small);
  padding: 1px 5px;
  border-radius: var(--oc-radius-pill);
  white-space: nowrap;
}

.inspector-section__badge[data-tone="neutral"] {
  background: color-mix(in srgb, var(--border) 60%, transparent);
  color: var(--text-muted);
}

.inspector-section__badge[data-tone="good"] {
  background: var(--good-dim);
  color: var(--good);
}

.inspector-section__badge[data-tone="warn"] {
  background: var(--warn-dim);
  color: var(--warn);
}

.inspector-section__badge[data-tone="bad"] {
  background: var(--bad-dim);
  color: var(--bad);
}

.inspector-section__chevron {
  display: flex;
  align-items: center;
  color: var(--text-muted);
  transition: transform var(--ui-duration-base) var(--ui-timing-standard);
}

.inspector-section__header[aria-expanded="false"] .inspector-section__chevron {
  transform: rotate(-90deg);
}

/* grid-template-rows collapse: body height is content-driven, no max-height cap */
.inspector-section__body {
  display: grid;
  overflow: hidden;
  transition: grid-template-rows var(--ui-duration-slow) var(--ui-timing-standard);
}

.inspector-section__body[data-expanded="true"] {
  grid-template-rows: 1fr;
}

.inspector-section__body[data-expanded="false"] {
  grid-template-rows: 0fr;
}

.inspector-section__body-inner {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* ── InspectorRow ── */

.inspector-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 30px;
  padding: 4px 6px;
  border: none;
  border-left: 2px solid transparent;
  border-radius: var(--oc-radius-soft);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background var(--ui-duration-fast) var(--ui-timing-standard),
    border-color var(--ui-duration-base) var(--ui-timing-standard);
}

.inspector-row:hover:not([data-active="true"]) {
  background: var(--surface-hover);
}

.inspector-row[data-active="true"] {
  background: var(--accent-dim);
  border-left-color: var(--accent);
  padding-left: 4px; /* 6px - 2px border */
}

.inspector-row[data-active="true"] .inspector-row__label {
  color: var(--text-strong);
}

.inspector-row[data-status="pending"] {
  opacity: var(--ui-opacity-faint);
}

.inspector-row__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--oc-radius-pill);
  flex-shrink: 0;
}

.inspector-row__dot[data-status="done"],
.inspector-row__dot[data-status="passed"] {
  background: var(--good);
}

.inspector-row__dot[data-status="running"],
.inspector-row__dot[data-status="active"] {
  background: var(--oc-stage-executor);
}

.inspector-row__dot[data-status="warn"] {
  background: var(--warn);
}

.inspector-row__dot[data-status="fail"],
.inspector-row__dot[data-status="failed"] {
  background: var(--bad);
}

.inspector-row__dot[data-status="pending"],
.inspector-row__dot[data-status="skipped"] {
  background: var(--text-muted);
}

.inspector-row__prefix {
  width: 10px;
  text-align: center;
  font-size: var(--ui-font-meta);
  font-weight: var(--ui-font-weight-strong);
  flex-shrink: 0;
}

.inspector-row__prefix[data-change="added"] {
  color: var(--accent);
}

.inspector-row__prefix[data-change="modified"] {
  color: var(--warn);
}

.inspector-row__prefix[data-change="deleted"] {
  color: var(--bad);
}

.inspector-row__tag {
  font-size: var(--ui-font-tiny);
  padding: 1px 4px;
  border-radius: var(--oc-radius-soft);
  background: color-mix(in srgb, var(--oc-stage-architect) 14%, transparent);
  color: var(--oc-stage-architect);
  flex-shrink: 0;
  white-space: nowrap;
}

.inspector-row__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--ui-font-meta);
  color: var(--text-soft);
}

.inspector-row__label-mono {
  font-family: var(--mono);
  font-size: var(--ui-font-code);
}

.inspector-row__meta {
  font-size: var(--ui-font-small);
  flex-shrink: 0;
  white-space: nowrap;
  padding: 1px 5px;
  border-radius: var(--oc-radius-soft);
}

.inspector-row__meta[data-tone="good"] {
  color: var(--good);
  background: var(--good-dim);
}

.inspector-row__meta[data-tone="warn"] {
  color: var(--warn);
  background: var(--warn-dim);
}

.inspector-row__meta[data-tone="bad"] {
  color: var(--bad);
  background: var(--bad-dim);
}

.inspector-row__meta[data-tone="muted"],
.inspector-row__meta[data-tone="neutral"] {
  color: var(--text-muted);
  background: transparent;
}

.inspector-row__meta[data-tone="active"] {
  color: var(--oc-stage-executor);
  background: color-mix(in srgb, var(--oc-stage-executor) 14%, transparent);
}

/* ── Inspector divider ── */

.inspector-divider {
  border: none;
  height: 1px;
  background: var(--divider-soft);
  margin: 2px 4px;
  flex-shrink: 0;
}

/* ── InspectorPanel header (replaces tab strip) ── */

.inspector-panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 0 10px;
  border-block-end: 1px solid var(--divider-soft);
  background: var(--surface-strong);
  flex-shrink: 0;
  overflow: hidden;
}

.inspector-panel-header__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--ui-font-meta);
  font-weight: var(--ui-font-weight-medium);
  color: var(--text-strong);
}

.inspector-panel-header__action {
  border: 1px solid var(--border);
  border-radius: var(--oc-radius-soft);
  background: transparent;
  color: var(--text-soft);
  font-size: var(--ui-font-small);
  padding: 2px 8px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background var(--ui-duration-fast) var(--ui-timing-standard),
    border-color var(--ui-duration-fast) var(--ui-timing-standard);
}

.inspector-panel-header__action:hover {
  background: var(--surface-hover);
  border-color: var(--border-hover);
}

/* ── Preview section iframe ── */

.inspector-preview-frame {
  width: 100%;
  height: 120px;
  border: 1px solid var(--border);
  border-radius: var(--oc-radius-soft);
  background: var(--surface-inset);
}

.inspector-preview-link {
  font-size: var(--ui-font-small);
  color: var(--accent);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
  display: inline-block;
}

.inspector-preview-link:hover {
  color: var(--accent-hover);
}
```

- [ ] **Step 2: Add CSS link to `index.html`**

In `packages/overlay/src/index.html`, find the block of `<link rel="stylesheet">` tags for surfaces. Add after the existing `inspector.css` link:
```html
<link rel="stylesheet" href="/src/styles/surfaces/inspector-panel.css">
```

- [ ] **Step 3: Commit**

```bash
git add packages/overlay/src/styles/surfaces/inspector-panel.css packages/overlay/src/index.html
git commit -m "feat(overlay): add inspector-panel.css with InspectorSection + InspectorRow token-based styles"
```

---

## Task 2: Write InspectorSection + InspectorRow CSS contract tests

**Files:**
- Create: `packages/overlay/test/inspector-section.test.ts`
- Create: `packages/overlay/test/inspector-row.test.ts`

- [ ] **Step 1: Write failing tests for InspectorSection CSS**

`packages/overlay/test/inspector-section.test.ts`:
```typescript
import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const ROOT = join(import.meta.dir, "../")
const css = readFileSync(join(ROOT, "src/styles/surfaces/inspector-panel.css"), "utf8")

describe("inspector-panel.css — InspectorSection classes", () => {
  test("defines .inspector-section root", () => {
    expect(css).toMatch(/\.inspector-section\s*\{/)
  })

  test("defines .inspector-section__header", () => {
    expect(css).toMatch(/\.inspector-section__header\s*\{/)
  })

  test("defines .inspector-section__body with grid-template-rows collapse", () => {
    expect(css).toMatch(/\.inspector-section__body\s*\{/)
    expect(css).toContain("grid-template-rows")
  })

  test("body expanded uses 1fr", () => {
    expect(css).toMatch(/data-expanded="true"[\s\S]*?grid-template-rows:\s*1fr/)
  })

  test("body collapsed uses 0fr", () => {
    expect(css).toMatch(/data-expanded="false"[\s\S]*?grid-template-rows:\s*0fr/)
  })

  test("defines .inspector-section__body-inner with min-height: 0", () => {
    expect(css).toMatch(/\.inspector-section__body-inner\s*\{/)
    const ruleStart = css.lastIndexOf(".inspector-section__body-inner")
    const body = css.slice(ruleStart, css.indexOf("}", ruleStart))
    expect(body).toContain("min-height: 0")
  })

  test("badge defines 4 tones: neutral, good, warn, bad", () => {
    expect(css).toMatch(/\.inspector-section__badge\[data-tone="neutral"\]/)
    expect(css).toMatch(/\.inspector-section__badge\[data-tone="good"\]/)
    expect(css).toMatch(/\.inspector-section__badge\[data-tone="warn"\]/)
    expect(css).toMatch(/\.inspector-section__badge\[data-tone="bad"\]/)
  })

  test("badge uses semantic tokens (no hex literals)", () => {
    const badgeBlock = css.match(/\.inspector-section__badge\[data-tone[\s\S]*?(?=\.inspector-row|$)/)?.[0] ?? ""
    expect(badgeBlock).not.toMatch(/#[0-9a-fA-F]{3,6}/)
  })

  test("transitions use motion tokens, not literal ms values", () => {
    const sectionBlock = css.match(/\.inspector-section[\s\S]*?(?=\.inspector-row)/)?.[0] ?? ""
    expect(sectionBlock).toContain("var(--ui-duration-")
    expect(sectionBlock).not.toMatch(/\b\d+ms\b/)
  })
})
```

- [ ] **Step 2: Write failing tests for InspectorRow CSS**

`packages/overlay/test/inspector-row.test.ts`:
```typescript
import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const ROOT = join(import.meta.dir, "../")
const css = readFileSync(join(ROOT, "src/styles/surfaces/inspector-panel.css"), "utf8")

describe("inspector-panel.css — InspectorRow classes", () => {
  test("defines .inspector-row root", () => {
    expect(css).toMatch(/\.inspector-row\s*\{/)
  })

  test("active row uses --accent-dim background and --accent left border", () => {
    expect(css).toMatch(/\.inspector-row\[data-active="true"\]/)
    const activeBlock = css.match(/\.inspector-row\[data-active="true"\]\s*\{([^}]+)\}/)?.[1] ?? ""
    expect(activeBlock).toContain("var(--accent-dim)")
    expect(activeBlock).toContain("var(--accent)")
  })

  test("pending row uses opacity token, not literal", () => {
    const pendingBlock = css.match(/\.inspector-row\[data-status="pending"\]\s*\{([^}]+)\}/)?.[1] ?? ""
    expect(pendingBlock).toContain("var(--ui-opacity-faint)")
    expect(pendingBlock).not.toMatch(/opacity:\s*0\.\d+/)
  })

  test("dot defines status colors using semantic tokens", () => {
    expect(css).toMatch(/\.inspector-row__dot\[data-status="done"\][\s\S]*?var\(--good\)/)
    expect(css).toMatch(/\.inspector-row__dot\[data-status="failed"\][\s\S]*?var\(--bad\)/)
    expect(css).toMatch(/\.inspector-row__dot\[data-status="running"\][\s\S]*?var\(--oc-stage-executor\)/)
  })

  test("prefix colors use semantic tokens", () => {
    const prefixAdded = css.match(/\.inspector-row__prefix\[data-change="added"\]\s*\{([^}]+)\}/)?.[1] ?? ""
    expect(prefixAdded).toContain("var(--accent)")
    const prefixMod = css.match(/\.inspector-row__prefix\[data-change="modified"\]\s*\{([^}]+)\}/)?.[1] ?? ""
    expect(prefixMod).toContain("var(--warn)")
    const prefixDel = css.match(/\.inspector-row__prefix\[data-change="deleted"\]\s*\{([^}]+)\}/)?.[1] ?? ""
    expect(prefixDel).toContain("var(--bad)")
  })

  test("no hex literals in inspector-row rules", () => {
    const rowBlock = css.slice(css.indexOf(".inspector-row"))
    expect(rowBlock).not.toMatch(/#[0-9a-fA-F]{3,6}/)
  })
})
```

- [ ] **Step 3: Run tests — expect PASS (CSS already written in Task 1)**

```bash
bun test packages/overlay/test/inspector-section.test.ts packages/overlay/test/inspector-row.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/overlay/test/inspector-section.test.ts packages/overlay/test/inspector-row.test.ts
git commit -m "test(overlay): CSS contract guards for InspectorSection and InspectorRow"
```

---

## Task 3: Create `InspectorSection.tsx`

**Files:**
- Create: `packages/overlay/src/components/InspectorSection.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { createSignal, JSX, Show } from "solid-js"
import { Icon } from "./Icon"

export type BadgeTone = "neutral" | "good" | "warn" | "bad"

interface InspectorSectionProps {
  title: string
  badge?: string
  badgeTone?: BadgeTone
  defaultExpanded?: boolean
  children: JSX.Element
}

export function InspectorSection(props: InspectorSectionProps) {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? true)

  return (
    <div class="inspector-section">
      <button
        class="inspector-section__header"
        type="button"
        aria-expanded={expanded() ? "true" : "false"}
        onClick={() => setExpanded((v) => !v)}
      >
        <span class="inspector-section__title">{props.title}</span>
        <div class="inspector-section__header-right">
          <Show when={props.badge}>
            <span
              class="inspector-section__badge"
              data-tone={props.badgeTone ?? "neutral"}
            >
              {props.badge}
            </span>
          </Show>
          <span class="inspector-section__chevron">
            <Icon name="chevron-down" size={12} />
          </span>
        </div>
      </button>
      <div
        class="inspector-section__body"
        data-expanded={expanded() ? "true" : "false"}
      >
        <div class="inspector-section__body-inner">
          {props.children}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add export guard test to `inspector-section.test.ts`**

Append to `packages/overlay/test/inspector-section.test.ts`:
```typescript
describe("InspectorSection.tsx — JSX contract", () => {
  test("exports InspectorSection function", () => {
    const src = readFileSync(join(ROOT, "src/components/InspectorSection.tsx"), "utf8")
    expect(src).toContain("export function InspectorSection(")
  })

  test("exports BadgeTone type", () => {
    const src = readFileSync(join(ROOT, "src/components/InspectorSection.tsx"), "utf8")
    expect(src).toContain("export type BadgeTone")
  })

  test("uses grid data-expanded attribute for collapse", () => {
    const src = readFileSync(join(ROOT, "src/components/InspectorSection.tsx"), "utf8")
    expect(src).toContain('data-expanded={expanded()')
  })

  test("aria-expanded reflects signal", () => {
    const src = readFileSync(join(ROOT, "src/components/InspectorSection.tsx"), "utf8")
    expect(src).toContain('aria-expanded={expanded()')
  })
})
```

- [ ] **Step 3: Run tests**

```bash
bun test packages/overlay/test/inspector-section.test.ts
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/overlay/src/components/InspectorSection.tsx packages/overlay/test/inspector-section.test.ts
git commit -m "feat(overlay): InspectorSection collapsible primitive with grid-template-rows animation"
```

---

## Task 4: Create `InspectorRow.tsx`

**Files:**
- Create: `packages/overlay/src/components/InspectorRow.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Show } from "solid-js"

export type RowStatus = "done" | "passed" | "running" | "active" | "warn" | "fail" | "failed" | "pending" | "skipped"
export type RowMetaTone = "good" | "warn" | "bad" | "muted" | "neutral" | "active"
export type ChangePrefix = "added" | "modified" | "deleted"

interface InspectorRowProps {
  /** Determines dot color. Ignored when prefix or categoryTag is set. */
  status?: RowStatus
  label: string
  /** Use monospace font for label (file paths) */
  labelMono?: boolean
  meta?: string
  metaTone?: RowMetaTone
  /** Highlights the row with accent left-border + tinted background */
  active?: boolean
  onClick?: () => void
  /** File change prefix symbol (overrides dot) */
  prefix?: ChangePrefix
  /** Short category label (overrides dot), e.g. "auth", "api" */
  categoryTag?: string
}

/** Map goal/step status string to a dot data-status value */
export function rowDotStatus(status: string): RowStatus {
  switch (status) {
    case "passed": return "done"
    case "failed": return "failed"
    case "running": return "running"
    case "completed": return "done"
    case "skipped": return "skipped"
    default: return "pending"
  }
}

/** Map FileChange.status to a ChangePrefix */
export function fileChangePrefix(status: string): ChangePrefix {
  if (status === "added") return "added"
  if (status === "deleted") return "deleted"
  return "modified"
}

/** Format +N / ±N / -N diff count for meta column */
export function formatDiffCount(additions: number, deletions: number): string {
  if (additions > 0 && deletions > 0) return `±${additions + deletions}`
  if (additions > 0) return `+${additions}`
  if (deletions > 0) return `-${deletions}`
  return ""
}

/** Map goal status to metaTone */
export function goalMetaTone(status: string): RowMetaTone {
  switch (status) {
    case "passed": return "good"
    case "failed": return "bad"
    case "running": return "active"
    default: return "muted"
  }
}

/** Map criteria status to dot status */
export function criteriaRowStatus(status: string): RowStatus {
  if (status === "passed") return "passed"
  if (status === "failed") return "failed"
  return "skipped"
}

/** Map criteria status to metaTone */
export function criteriaMetaTone(status: string): RowMetaTone {
  if (status === "passed") return "good"
  if (status === "failed") return "bad"
  return "muted"
}

export function InspectorRow(props: InspectorRowProps) {
  return (
    <button
      class="inspector-row"
      type="button"
      data-status={props.status ?? "pending"}
      data-active={props.active ? "true" : "false"}
      onClick={props.onClick}
    >
      {/* Leading indicator: category tag > prefix symbol > status dot */}
      <Show when={props.categoryTag}>
        <span class="inspector-row__tag">{props.categoryTag}</span>
      </Show>
      <Show when={!props.categoryTag && props.prefix}>
        <span class="inspector-row__prefix" data-change={props.prefix}>
          {props.prefix === "added" ? "+" : props.prefix === "deleted" ? "−" : "~"}
        </span>
      </Show>
      <Show when={!props.categoryTag && !props.prefix}>
        <span class="inspector-row__dot" data-status={props.status ?? "pending"} />
      </Show>

      <span class={`inspector-row__label${props.labelMono ? " inspector-row__label-mono" : ""}`}>
        {props.label}
      </span>

      <Show when={props.meta}>
        <span class="inspector-row__meta" data-tone={props.metaTone ?? "neutral"}>
          {props.meta}
        </span>
      </Show>
    </button>
  )
}
```

- [ ] **Step 2: Write tests for the pure helper functions**

`packages/overlay/test/inspector-row.test.ts` — append:
```typescript
import {
  rowDotStatus,
  fileChangePrefix,
  formatDiffCount,
  goalMetaTone,
  criteriaRowStatus,
  criteriaMetaTone,
} from "../src/components/InspectorRow"

describe("InspectorRow — helper functions", () => {
  test("rowDotStatus: passed → done", () => {
    expect(rowDotStatus("passed")).toBe("done")
  })
  test("rowDotStatus: failed → failed", () => {
    expect(rowDotStatus("failed")).toBe("failed")
  })
  test("rowDotStatus: running → running", () => {
    expect(rowDotStatus("running")).toBe("running")
  })
  test("rowDotStatus: completed → done", () => {
    expect(rowDotStatus("completed")).toBe("done")
  })
  test("rowDotStatus: anything else → pending", () => {
    expect(rowDotStatus("queued")).toBe("pending")
    expect(rowDotStatus("")).toBe("pending")
  })

  test("fileChangePrefix: added → added", () => {
    expect(fileChangePrefix("added")).toBe("added")
  })
  test("fileChangePrefix: deleted → deleted", () => {
    expect(fileChangePrefix("deleted")).toBe("deleted")
  })
  test("fileChangePrefix: modified → modified", () => {
    expect(fileChangePrefix("modified")).toBe("modified")
  })

  test("formatDiffCount: additions only", () => {
    expect(formatDiffCount(10, 0)).toBe("+10")
  })
  test("formatDiffCount: deletions only", () => {
    expect(formatDiffCount(0, 5)).toBe("-5")
  })
  test("formatDiffCount: both", () => {
    expect(formatDiffCount(3, 2)).toBe("±5")
  })
  test("formatDiffCount: zero both → empty string", () => {
    expect(formatDiffCount(0, 0)).toBe("")
  })

  test("goalMetaTone: passed → good", () => {
    expect(goalMetaTone("passed")).toBe("good")
  })
  test("goalMetaTone: failed → bad", () => {
    expect(goalMetaTone("failed")).toBe("bad")
  })
  test("goalMetaTone: running → active", () => {
    expect(goalMetaTone("running")).toBe("active")
  })
  test("goalMetaTone: pending → muted", () => {
    expect(goalMetaTone("pending")).toBe("muted")
  })

  test("criteriaRowStatus: passed → passed", () => {
    expect(criteriaRowStatus("passed")).toBe("passed")
  })
  test("criteriaRowStatus: failed → failed", () => {
    expect(criteriaRowStatus("failed")).toBe("failed")
  })
  test("criteriaRowStatus: skipped → skipped", () => {
    expect(criteriaRowStatus("skipped")).toBe("skipped")
  })

  test("criteriaMetaTone: passed → good", () => {
    expect(criteriaMetaTone("passed")).toBe("good")
  })
  test("criteriaMetaTone: failed → bad", () => {
    expect(criteriaMetaTone("failed")).toBe("bad")
  })
  test("criteriaMetaTone: skipped → muted", () => {
    expect(criteriaMetaTone("skipped")).toBe("muted")
  })
})

describe("InspectorRow.tsx — JSX contract", () => {
  test("exports InspectorRow function", () => {
    const src = readFileSync(join(ROOT, "src/components/InspectorRow.tsx"), "utf8")
    expect(src).toContain("export function InspectorRow(")
  })

  test("exports all helper functions", () => {
    const src = readFileSync(join(ROOT, "src/components/InspectorRow.tsx"), "utf8")
    expect(src).toContain("export function rowDotStatus(")
    expect(src).toContain("export function fileChangePrefix(")
    expect(src).toContain("export function formatDiffCount(")
    expect(src).toContain("export function goalMetaTone(")
    expect(src).toContain("export function criteriaRowStatus(")
    expect(src).toContain("export function criteriaMetaTone(")
  })
})
```

- [ ] **Step 3: Add the `readFileSync` import to the test file top** (if not already present — it should be from Task 2)

The test file already imports `readFileSync` and `join` from Task 2. The new imports of the helper functions go after the existing bun:test import:

```typescript
// Add to the imports block at the top of inspector-row.test.ts
import {
  rowDotStatus,
  fileChangePrefix,
  formatDiffCount,
  goalMetaTone,
  criteriaRowStatus,
  criteriaMetaTone,
} from "../src/components/InspectorRow"
```

- [ ] **Step 4: Run tests**

```bash
bun test packages/overlay/test/inspector-row.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/overlay/src/components/InspectorRow.tsx packages/overlay/test/inspector-row.test.ts
git commit -m "feat(overlay): InspectorRow primitive with status dot/prefix/tag + helper fns"
```

---

## Task 5: Create `InspectorPanel.tsx`

**Files:**
- Create: `packages/overlay/src/components/InspectorPanel.tsx`
- Create: `packages/overlay/test/inspector-panel.test.ts`

- [ ] **Step 1: Write the test first**

`packages/overlay/test/inspector-panel.test.ts`:
```typescript
import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const ROOT = join(import.meta.dir, "../")

describe("InspectorPanel.tsx — JSX contract", () => {
  test("exports InspectorPanel function", () => {
    const src = readFileSync(join(ROOT, "src/components/InspectorPanel.tsx"), "utf8")
    expect(src).toContain("export function InspectorPanel(")
  })

  test("reads boardStore.board.goalWorkflows", () => {
    const src = readFileSync(join(ROOT, "src/components/InspectorPanel.tsx"), "utf8")
    expect(src).toContain("boardStore.board")
    expect(src).toContain("goalWorkflows")
  })

  test("reads boardStore.board.architect", () => {
    const src = readFileSync(join(ROOT, "src/components/InspectorPanel.tsx"), "utf8")
    expect(src).toContain("architect")
  })

  test("renders all five section titles", () => {
    const src = readFileSync(join(ROOT, "src/components/InspectorPanel.tsx"), "utf8")
    // Goals, Changes, Evaluation, Architect, Preview sections must be present
    expect(src).toContain("InspectorSection")
    // At least 5 occurrences of InspectorSection (one per section)
    const count = (src.match(/InspectorSection/g) ?? []).length
    expect(count).toBeGreaterThanOrEqual(5)
  })

  test("imports currentChanges from diff service", () => {
    const src = readFileSync(join(ROOT, "src/components/InspectorPanel.tsx"), "utf8")
    expect(src).toContain("currentChanges")
    expect(src).toContain("services/diff")
  })

  test("accepts previewResolution prop", () => {
    const src = readFileSync(join(ROOT, "src/components/InspectorPanel.tsx"), "utf8")
    expect(src).toContain("previewResolution")
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL (InspectorPanel.tsx not yet created)**

```bash
bun test packages/overlay/test/inspector-panel.test.ts
```

Expected: FAIL — `ENOENT: no such file or directory`.

- [ ] **Step 3: Write InspectorPanel.tsx**

```tsx
import { createMemo, For, Show } from "solid-js"
import { boardStore } from "../store/board"
import { currentChanges } from "../services/diff"
import { t } from "../utils/i18n"
import { statusLabel, statusIconName } from "./Board"
import { Icon } from "./Icon"
import { InspectorSection } from "./InspectorSection"
import {
  InspectorRow,
  rowDotStatus,
  fileChangePrefix,
  formatDiffCount,
  goalMetaTone,
  criteriaRowStatus,
  criteriaMetaTone,
} from "./InspectorRow"
import type { FrontendPreviewResolution } from "../services/frontend-preview"

interface InspectorPanelProps {
  previewResolution: FrontendPreviewResolution | null
  previewLoading: boolean
  previewError: string
  onRefreshPreview: () => void
  onRetry?: () => void
  onReplan?: () => void
  onCancel?: () => void
}

/** Focus a card in the Board center panel by emitting a custom event.
 *  Board.tsx / GoalWorkflowGroup listen for "inspector:focus-goal" and
 *  scroll the matching section into view. */
function emitFocusGoal(goalID: string): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent("inspector:focus-goal", { detail: { goalID } }))
}

function emitFocusFile(filePath: string): void {
  if (typeof window === "undefined") return
  // Reuse existing workspace diff bridge
  ;(window as any).openWorkspaceDiff?.({ filePath })
}

export function InspectorPanel(props: InspectorPanelProps) {
  const board = () => boardStore.board

  // ── Goals ──
  const goalWorkflows = createMemo(() => (board()?.goalWorkflows as any[]) ?? [])
  const goalsDoneCount = createMemo(() =>
    goalWorkflows().filter((g) => g.goalStatus === "passed").length,
  )
  const goalsBadge = createMemo(() => {
    const gw = goalWorkflows()
    if (gw.length === 0) return undefined
    return `${goalsDoneCount()} / ${gw.length}`
  })
  const goalsBadgeTone = createMemo(() => {
    const gw = goalWorkflows()
    if (gw.length === 0) return "neutral" as const
    if (goalsDoneCount() === gw.length) return "good" as const
    if (gw.some((g) => g.goalStatus === "failed")) return "bad" as const
    return "neutral" as const
  })

  // ── Changes ──
  const changes = createMemo(() => currentChanges())
  const changesBadge = createMemo(() => {
    const n = changes().length
    return n > 0 ? `${n} ${t("inspector.files") ?? "files"}` : undefined
  })
  // Show first 8; if more, add a "view all" row
  const MAX_CHANGES_VISIBLE = 8
  const changesVisible = createMemo(() => changes().slice(0, MAX_CHANGES_VISIBLE))
  const changesOverflow = createMemo(() => Math.max(0, changes().length - MAX_CHANGES_VISIBLE))

  // ── Evaluation ──
  const criteria = createMemo(
    () => (board()?.criteriaResults as any[]) ?? [],
  )
  const criteriaFailCount = createMemo(() =>
    criteria().filter((c) => c.status === "failed").length,
  )
  const criteriaWarnCount = createMemo(() =>
    criteria().filter((c) => c.status === "skipped").length,
  )
  const criteriaPassCount = createMemo(() =>
    criteria().filter((c) => c.status === "passed").length,
  )
  const criteriaBadge = createMemo(() => {
    const list = criteria()
    if (list.length === 0) return undefined
    if (criteriaFailCount() > 0) return `${criteriaFailCount()} failed`
    if (criteriaWarnCount() > 0) return `${criteriaWarnCount()} skipped`
    return "✓"
  })
  const criteriaBadgeTone = createMemo(() => {
    if (criteriaFailCount() > 0) return "bad" as const
    if (criteriaWarnCount() > 0) return "warn" as const
    if (criteriaPassCount() > 0) return "good" as const
    return "neutral" as const
  })
  const criteriaDefaultExpanded = createMemo(
    () => criteriaFailCount() > 0 || criteriaWarnCount() > 0,
  )

  // ── Architect ──
  const architect = createMemo(() => board()?.architect as any)
  const decisions = createMemo(() => (architect()?.decisions as any[]) ?? [])
  const architectBadge = createMemo(() => {
    const n = decisions().length
    return n > 0 ? `${n} ${t("inspector.decisions") ?? "decisions"}` : undefined
  })

  // ── Preview ──
  const previewUrl = createMemo(() => props.previewResolution?.url ?? null)
  const previewBadgeLabel = createMemo(() => {
    const url = previewUrl()
    if (!url) return undefined
    try {
      const u = new URL(url)
      return u.hostname === "localhost" || u.hostname === "127.0.0.1"
        ? `localhost:${u.port || 80}`
        : u.hostname.slice(0, 20)
    } catch {
      return url.slice(0, 20)
    }
  })

  // ── Task status (for panel header) ──
  const taskStatus = createMemo(() => (board()?.task as any)?.status ?? "")
  const taskTitle = createMemo(() => (board()?.task as any)?.request ?? "")
  const overview = createMemo(() => board()?.overview as any)
  const canRetry = createMemo(() => overview()?.controls?.canRetry ?? false)
  const canReplan = createMemo(() => overview()?.controls?.canReplan ?? false)

  return (
    <div style="display:flex;flex-direction:column;height:100%">

      {/* ── Panel header: task title + status badge + action buttons ── */}
      <div class="inspector-panel-header">
        <span class="inspector-panel-header__title">{taskTitle()}</span>
        <Show when={taskStatus()}>
          <span class="status-badge" style="flex-shrink:0">
            <span class="status-icon" data-status={taskStatus()}>
              <Icon name={statusIconName(taskStatus())} />
            </span>
            <span class="status-label">{statusLabel(taskStatus())}</span>
          </span>
        </Show>
        <Show when={canRetry()}>
          <button class="inspector-panel-header__action" type="button" onClick={props.onRetry}>
            {t("task.action.retry") ?? "Retry"}
          </button>
        </Show>
        <Show when={canReplan()}>
          <button class="inspector-panel-header__action" type="button" onClick={props.onReplan}>
            {t("task.action.replan") ?? "Replan"}
          </button>
        </Show>
      </div>

      {/* ── Sections stack ── */}
      <div class="sections-stack">

      {/* ── Goals ── */}
      <Show when={goalWorkflows().length > 0}>
        <InspectorSection
          title={t("workflow.goals") ?? "Goals"}
          badge={goalsBadge()}
          badgeTone={goalsBadgeTone()}
          defaultExpanded={true}
        >
          <For each={goalWorkflows()}>
            {(goal) => (
              <InspectorRow
                status={rowDotStatus(goal.goalStatus)}
                label={goal.goalTitle}
                meta={
                  goal.goalStatus === "running"
                    ? (t("common.active") ?? "active")
                    : (goal.goalStatus ?? "pending")
                }
                metaTone={goalMetaTone(goal.goalStatus)}
                onClick={() => emitFocusGoal(goal.goalID)}
              />
            )}
          </For>
        </InspectorSection>
        <hr class="inspector-divider" />
      </Show>

      {/* ── Changes ── */}
      <Show when={changes().length > 0}>
        <InspectorSection
          title={t("section.changes") ?? "Changes"}
          badge={changesBadge()}
          defaultExpanded={true}
        >
          <For each={changesVisible()}>
            {(file) => (
              <InspectorRow
                prefix={fileChangePrefix(file.status)}
                label={file.file}
                labelMono={true}
                meta={formatDiffCount(file.additions, file.deletions)}
                metaTone="muted"
                onClick={() => emitFocusFile(file.file)}
              />
            )}
          </For>
          <Show when={changesOverflow() > 0}>
            <InspectorRow
              label={`${t("inspector.view_all") ?? "View all"} ${changes().length} ${t("inspector.files") ?? "files"}`}
              metaTone="neutral"
              onClick={() => emitFocusFile("")}
            />
          </Show>
        </InspectorSection>
        <hr class="inspector-divider" />
      </Show>

      {/* ── Evaluation ── */}
      <Show when={criteria().length > 0}>
        <InspectorSection
          title={t("section.criteria") ?? "Evaluation"}
          badge={criteriaBadge()}
          badgeTone={criteriaBadgeTone()}
          defaultExpanded={criteriaDefaultExpanded()}
        >
          <For each={criteria()}>
            {(c) => (
              <InspectorRow
                status={criteriaRowStatus(c.status)}
                label={c.label ?? c.name}
                meta={c.status}
                metaTone={criteriaMetaTone(c.status)}
              />
            )}
          </For>
        </InspectorSection>
        <hr class="inspector-divider" />
      </Show>

      {/* ── Architect ── */}
      <Show when={decisions().length > 0}>
        <InspectorSection
          title={t("workflow.architect") ?? "Architect"}
          badge={architectBadge()}
          defaultExpanded={false}
        >
          <For each={decisions()}>
            {(d) => (
              <InspectorRow
                categoryTag={(d.key as string).slice(0, 6)}
                label={d.value as string}
              />
            )}
          </For>
        </InspectorSection>
        <hr class="inspector-divider" />
      </Show>

      {/* ── Preview ── */}
      <Show when={previewUrl()}>
        <InspectorSection
          title={t("right_panel.preview") ?? "Preview"}
          defaultExpanded={true}
        >
          <Show when={previewBadgeLabel()}>
            <a
              class="inspector-preview-link"
              href={previewUrl()!}
              target="_blank"
              rel="noopener noreferrer"
            >
              {previewBadgeLabel()} ↗
            </a>
          </Show>
          <Show
            when={!props.previewLoading && !props.previewError}
            fallback={
              <div class="inspector-preview-frame" style="display:flex;align-items:center;justify-content:center">
                <span style="color:var(--text-muted);font-size:var(--ui-font-small)">
                  {props.previewLoading ? (t("delivery.preview.loading") ?? "Loading…") : props.previewError}
                </span>
              </div>
            }
          >
            <iframe
              class="inspector-preview-frame"
              src={previewUrl()!}
              title={t("right_panel.preview") ?? "Preview"}
            />
          </Show>
        </InspectorSection>
      </Show>

      </div>{/* end sections-stack */}
    </div>
  )
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
bun test packages/overlay/test/inspector-panel.test.ts
```

Expected: all pass.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/overlay && bun run typecheck 2>&1 | head -40
```

Fix any type errors before proceeding.

- [ ] **Step 6: Commit**

```bash
git add packages/overlay/src/components/InspectorPanel.tsx packages/overlay/test/inspector-panel.test.ts
git commit -m "feat(overlay): InspectorPanel — unified right panel with Goals/Changes/Eval/Architect/Preview sections"
```

---

## Task 6: Add i18n keys for new Inspector strings

**Files:**
- Modify: `packages/overlay/src/i18n/en-US.json`
- Modify: `packages/overlay/src/i18n/zh-CN.json`

- [ ] **Step 1: Add keys to en-US.json**

Find the `"section"` object in `en-US.json` and add:
```json
"section": {
  ...,
  "changes": "Changes"
},
"inspector": {
  "files": "files",
  "decisions": "decisions",
  "view_all": "View all"
}
```

- [ ] **Step 2: Add keys to zh-CN.json**

```json
"section": {
  ...,
  "changes": "变更"
},
"inspector": {
  "files": "个文件",
  "decisions": "条决策",
  "view_all": "查看全部"
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/overlay/src/i18n/en-US.json packages/overlay/src/i18n/zh-CN.json
git commit -m "feat(overlay): add inspector i18n keys for Changes/files/decisions"
```

---

## Task 7: Wire InspectorPanel into `index.html` and `main.tsx`

**Files:**
- Modify: `packages/overlay/src/index.html`
- Modify: `packages/overlay/src/main.tsx`

- [ ] **Step 1: Simplify the `.sections` div in `index.html`**

Replace the entire block from `<header class="sections-header oc-surface-header">` through the closing `</div>` of `#sections` (lines ~269–298) with:

```html
<!-- Collapsible Sections (right) — single scrollable column, no tabs -->
<div class="sections" id="sections">
  <div id="solidInspectorPanelMount"></div>
</div>
```

The old content to remove:
```html
<header class="sections-header oc-surface-header">
  <span class="sections-title oc-surface-header__title hidden" data-i18n="sections.title">Workspace</span>
  <div id="solidRightPanelTabs" class="sections-tabs oc-surface-header__actions"></div>
</header>
<div class="sections-tab-body" id="rightPanelWorkflow" data-panel-tab="workflow" data-active="false">
  <div id="solidAgentWorkflowMount"></div>
</div>
<div class="sections-tab-body" id="rightPanelInspector" data-panel-tab="inspector" data-active="true">
  <div class="sections-stack">
    <div id="solidBoardMount"></div>
    <div id="solidInteractionMount"></div>
    <div id="solidDeliveryMount"></div>
    <div id="solidFilesSectionMount"></div>
  </div>
</div>
<div class="sections-tab-body" id="rightPanelPreview" data-panel-tab="preview" data-active="false">
  <div id="solidFrontendPreviewMount"></div>
</div>
```

- [ ] **Step 2: Add InspectorPanel import to main.tsx**

Add at the top of main.tsx with other component imports:
```typescript
import { InspectorPanel } from "./components/InspectorPanel"
```

- [ ] **Step 3: Add InspectorPanel mount in main.tsx**

Find the section `// ── Mount: Right panel Inspector / Preview tabs ──` (around line 945) and replace the entire block (from `const rightPanelTabsEl` through `const agentWorkflowMountEl` block, inclusive) with:

```typescript
// ── Mount: InspectorPanel ──
// Single scrollable right panel replacing the former three-tab structure.
// Preview state is owned here and passed as props so InspectorPanel remains
// import-free from main.tsx's module-level signals.

const inspectorPanelMountEl = document.getElementById("solidInspectorPanelMount")
if (inspectorPanelMountEl) {
  render(
    () => (
      <InspectorPanel
        previewResolution={frontendPreviewResolution()}
        previewLoading={frontendPreviewLoading()}
        previewError={frontendPreviewError()}
        onRefreshPreview={() => refreshFrontendPreview({ manual: true })}
      />
    ),
    inspectorPanelMountEl,
  )
}
```

- [ ] **Step 4: Remove retired mount points from main.tsx**

Delete these blocks:
- `const frontendPreviewMountEl` render (FrontendPreviewPanel — now inside InspectorPanel)
- `createEffect` for `data-active` tab switching (the one reading `rightPanelTab()`)
- `const agentWorkflowMountEl` render (AgentWorkflowPanel — workflow tab is gone)
- `const filesSectionMountEl` render (FilesSection — now inside InspectorPanel)
- `const solidDeliveryMount`-related render (search for "solidDeliveryMount")
- `const solidBoardMount`-related render — **NOTE: verify Board mount target** before deleting; Board.tsx may still be needed for the `taskActionsBar`. If `solidBoardMount` is inside the now-removed inspector tab, it is already gone from HTML.

- [ ] **Step 5: Remove retired signals from main.tsx**

Delete or comment out:
- `const [rightPanelTab, setRightPanelTab] = ...`
- `const [rightPanelManualKey, setRightPanelManualKey] = ...`
- `function selectRightPanelTab(...)` 
- `RightPanelTab` type import from `./services/frontend-preview`

Keep: `frontendPreviewResolution`, `frontendPreviewLoading`, `frontendPreviewError`, `refreshFrontendPreview`, `frontendPreviewRequest` — these are still used by InspectorPanel's props.

- [ ] **Step 6: TypeScript check**

```bash
cd packages/overlay && bun run typecheck 2>&1 | head -60
```

Fix all type errors. Common issues:
- Unused import of `RightPanelTab`
- `selectRightPanelTab` reference in `nextTabForPreviewResolution` call (remove or update)
- Mount point IDs that no longer exist

- [ ] **Step 7: Commit**

```bash
git add packages/overlay/src/index.html packages/overlay/src/main.tsx
git commit -m "feat(overlay): replace 3-tab right panel with single InspectorPanel mount"
```

---

## Task 8: Clean up retired CSS rules

**Files:**
- Modify: `packages/overlay/src/styles/surfaces/inspector.css`
- Modify: `packages/overlay/src/styles/surfaces/header.css`

- [ ] **Step 1: Remove tab-body rules from inspector.css**

Delete the following rule blocks from `packages/overlay/src/styles/surfaces/inspector.css` (lines 54–80):
```css
/* DELETE all of these: */
.sections-tab-body { ... }
.sections-tab-body[data-active="false"] { ... }
.sections-tab-body[data-panel-tab="inspector"] { ... }
.sections-tab-body[data-panel-tab="inspector"][data-active="false"] { ... }
.sections-tab-body[data-panel-tab="workflow"] { ... }
.sections-tab-body[data-panel-tab="preview"] { ... }
```

Also delete the `.sections-title` rule (the `hidden` class toggle logic no longer applies):
```css
/* DELETE: */
.sections-title { ... }
```

Keep: `.sections`, `.sections-stack`, `.sections-tab-body` references are gone — keep only the first two.

- [ ] **Step 2: Remove sections-tabs CSS from header.css**

Delete from `packages/overlay/src/styles/surfaces/header.css`:
```css
/* DELETE: */
.sections-tabs.oc-surface-header__actions { ... }
```

Also delete:
```css
/* DELETE: */
.sections-header.oc-surface-header { ... }
```

(The sections column no longer has a tab-strip header.)

- [ ] **Step 3: Verify no dangling selectors**

```bash
cd packages/overlay && bun test test/styles-no-dangling-selectors.test.ts
```

Expected: pass. If failing, the deleted selector is referenced somewhere still — fix by either removing the remaining HTML reference or restoring the CSS rule with a TODO.

- [ ] **Step 4: Remove unused i18n keys**

From both `en-US.json` and `zh-CN.json`, remove:
- `right_panel.tabs`
- `right_panel.workflow`
- `right_panel.inspector`
- `right_panel.preview`

First verify no non-tab usages: `grep -r "right_panel\." packages/overlay/src --include="*.ts" --include="*.tsx"` — all usages should be in the now-deleted tab mounting code.

- [ ] **Step 5: Commit**

```bash
git add packages/overlay/src/styles/surfaces/inspector.css packages/overlay/src/styles/surfaces/header.css packages/overlay/src/i18n/en-US.json packages/overlay/src/i18n/zh-CN.json
git commit -m "refactor(overlay): remove tab-body CSS + header tab strip + unused i18n keys"
```

---

## Task 9: Add focus-goal event listener in `main.tsx`

**Files:**
- Modify: `packages/overlay/src/main.tsx`

> The `inspector:focus-goal` event emitted by InspectorPanel needs a listener that scrolls the first conversation card belonging to that goal into view. Cards have `data-card-id` attribute (from `Card.tsx` line 235) and `CardNode` has `goalID?: string` in `card-tree.ts`.

- [ ] **Step 1: Import cardTreeStore in main.tsx** (if not already imported)

Check: `grep "cardTreeStore" packages/overlay/src/main.tsx` — if absent, add:
```typescript
import { cardTreeStore } from "./store/card-tree"
```

- [ ] **Step 2: Add event listener for inspector:focus-goal in main.tsx**

After the InspectorPanel mount block, add:
```typescript
// ── inspector:focus-goal → scroll conversation to goal's first card ──
window.addEventListener("inspector:focus-goal", (e) => {
  const goalID = (e as CustomEvent<{ goalID: string }>).detail?.goalID
  if (!goalID) return
  // Find the first card whose goalID matches
  const cards = Object.values(cardTreeStore.cards)
  const match = cards.find((c) => c.goalID === goalID)
  if (!match) return
  const el = document.querySelector(`[data-card-id="${match.id}"]`)
  el?.scrollIntoView({ behavior: "smooth", block: "nearest" })
}, { signal: moduleTeardown.signal })
```

> `moduleTeardown.signal` is the AbortController signal already used by other listeners in main.tsx for cleanup on HMR dispose.

- [ ] **Step 3: TypeScript check**

```bash
cd packages/overlay && bun run typecheck 2>&1 | head -30
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/overlay/src/main.tsx
git commit -m "feat(overlay): inspector:focus-goal scrolls conversation to goal's first card"
```

---

## Task 10: Run full test suite and verify

- [ ] **Step 1: TypeScript full check**

```bash
cd packages/overlay && bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 2: Run relevant test files**

```bash
bun test packages/overlay/test/inspector-section.test.ts packages/overlay/test/inspector-row.test.ts packages/overlay/test/inspector-panel.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run architecture guards**

```bash
bun test packages/overlay/test/styles-no-dangling-selectors.test.ts packages/overlay/test/overlay-architecture-guards.test.ts
```

Expected: pass. Fix any dangling selector or architecture violations.

- [ ] **Step 4: Run flat-redesign coverage guards**

```bash
bun test packages/overlay/test/flat-redesign-font-weight-coverage.test.ts packages/overlay/test/flat-redesign-motion-coverage.test.ts packages/overlay/test/flat-redesign-opacity-coverage.test.ts
```

Expected: pass. These guard against hardcoded values in CSS — inspector-panel.css must pass.

- [ ] **Step 5: Push**

```bash
git push
```

Expected: pre-push hooks pass (typecheck + api:routes-check + docs:check). If hooks fail, fix the root cause — do not use `--no-verify`.

---

## Task 11: Visual verification

> The CLAUDE.md rule 25 ("禁止 headless overlay benchmark，视觉有关的 benchmark 必须以视觉呈现") applies. Start the overlay dev server and visually inspect the right panel.

- [ ] **Step 1: Start dev server**

```bash
cd packages/overlay && bun run dev
```

- [ ] **Step 2: Open overlay in browser and verify**

Checklist:
- [ ] Right panel shows a single scrollable column (no tabs visible)
- [ ] Goals section: each goal has a colored dot + title + status badge
- [ ] Goals section: active/running goal has accent left-border highlight
- [ ] Goals section: pending goals are visually dimmed (opacity)
- [ ] Changes section: each file has +/~/− prefix with correct color + monospace path
- [ ] Evaluation section: collapsed when all pass; expanded when any fail
- [ ] Architect section: collapsed by default; shows category tag + decision line
- [ ] Preview section: only visible when delivery has a URL
- [ ] Clicking a Goal row scrolls the center Board to that goal's card
- [ ] Clicking a Change file opens the diff in the workspace panel
- [ ] All three themes (dark, light, vscode-dark) render correctly — no hex-colored elements

- [ ] **Step 3: Final commit if visual adjustments needed**

```bash
git add -p  # stage only needed changes
git commit -m "fix(overlay): inspector panel visual adjustments after browser verification"
git push
```
