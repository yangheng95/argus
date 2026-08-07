# Modular Content Page (L2)

Standard layout pattern for pages with multiple independent content modules.

**Prerequisite:** Page must be classified as L2 in `page-structure-types.md` before applying this rule.

---

## 1. Trigger

Use this pattern when:
- Page has 2–6 distinct content sections
- Sections are peer modules — no shared parent group above them
- User scans across modules rather than drilling into one
- Each module can be understood independently

---

## 2. Layout Variants

### Variant 1 — Single Column
- All modules stacked vertically in one column
- Full container width
- Use when: all content is equal priority, no persistent sidebar needed

### Variant 2 — Sidebar + Main Content
- Left sidebar (fixed width, typically 280–320px) + main content area
- Sidebar: persistent filters, navigation, or summary
- Main: primary content modules
- Column gap: `spacing.48` (48px)
- See `layout-grid.md` for two-column rules

---

## 3. Surface & Color Zones

| Zone              | Background token          | Notes                              |
|-------------------|---------------------------|------------------------------------|
| Page canvas       | `color.bg.layer1`         | Full page background               |
| Sidebar           | `color.bg.surface`        | Elevated from page canvas          |
| Content module    | `color.bg.surface`        | Card-like module background        |
| Section divider   | `color.divider.level3`    | Between modules (optional)         |

---

## 4. Information Hierarchy

| Role         | Token                          | Usage                       |
|--------------|--------------------------------|-----------------------------|
| Page title   | `typography.title.web.lg`      | H2, 32px Bold — one per page|
| Floor title  | `typography.title.web.md`      | H3, 24px Bold — per module  |
| Module label | `typography.body.primary.semibold` | H4, 16px — sub-sections |
| Body         | `typography.body.secondary.*`  | 14px content                |
| Meta         | `typography.body.tertiary.*`   | 12px labels, timestamps     |

---

## 5. Spacing Map

### L2 Override (applies to this pattern only)

| Token      | Default value | L2 override | Usage                                  |
|------------|---------------|-------------|----------------------------------------|
| space1     | 48px          | 48px        | Nav → page title                       |
| space2     | 24px          | **32px**    | Page title → first module              |
| space2-alt | 32px          | **48px**    | Page title → first module (with subtitle) |
| space3     | 24px          | 24px        | Floor title → floor content            |
| space4     | 48px          | 48px        | Module → next module                   |

### Module Internal Spacing

| Context                        | Token         |
|--------------------------------|---------------|
| Module padding (card)          | `spacing.24`  |
| Section title → content        | `spacing.16`  |
| Between content items          | `spacing.12`  |
| Between tight elements         | `spacing.8`   |
| Between label and value        | `spacing.4`   |

---

## 6. Common Floor Module Types

### A — Hero / Featured Module
- Full-width banner or featured content
- Large image or data visualization
- One primary CTA button (Black Primary, M size)
- No outer card border — sits directly on page canvas

### B — Horizontal Card Strip
- 3–5 cards in a row
- Cards: `radius.md`, `color.bg.surface`, `1px solid color.divider.level3`
- Gap between cards: `spacing.16`
- See `card.md` for card state rules

### C — Feed / List Module
- Vertically stacked rows
- Row divider: `color.divider.level3`
- No outer border on container — see `list-table-pattern.md`
- Row hover: `color.interaction.hover`

### D — Tab-Filtered Module
- Module has a Tab header (use Pill Tab, Family B)
- Content area switches on tab selection
- Tab container: `color.bg.weak`, `radius.pill`
- Tab → content gap: `spacing.16`

### E — Two-Column Paired Module
- Two equal-width panels side by side
- Gap: `spacing.24`
- Each panel: `color.bg.surface`, `radius.md`, `1px solid color.divider.level3`

### F — Tool / Input Module
- Form or filter-heavy section
- Input fields, dropdowns, search bar
- Background: `color.bg.surface`
- Internal spacing: `spacing.16` between fields

---

## 7. Content Density Strategy

- Alternate dense and relaxed modules to create visual rhythm
- Dense module followed by a relaxed or visual module
- MUST NOT stack 3+ dense list/table modules without a visual break
- Visual break options: chart, image strip, featured card, whitespace floor

---

## 8. Responsive Rules

| Breakpoint | Behavior                                           |
|------------|----------------------------------------------------|
| XL ≥1410px | Full layout, sidebar visible if Variant 2          |
| LG 900px   | Sidebar collapses or narrows to 240px              |
| MD 500px   | Single column, sidebar moves to top or hidden      |
| SM <500px  | All modules full-width, reduce module padding to `spacing.16` |

---

## 9. Rules

### MUST
- Use H2 (32px) as page title — never H1
- Apply L2 spacing overrides (space2=32px, space2-alt=48px)
- Each module has a clear floor title (H3) or is explicitly untitled
- Use `color.bg.surface` for module backgrounds

### MUST NOT
- Use H1 on an L2 page
- Stack modules without `spacing.48` between them
- Apply `shadow.*` to static module containers (only overlays use shadow)
- Use different card radius within the same module strip

---

## 10. Failure

If violated:
- H1 used → replace with H2
- Incorrect spacing → re-apply L2 spacing overrides
- Shadow on static module → remove shadow
- Mixed radius in card strip → standardize to `radius.md`
