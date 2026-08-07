# Single Focus Page (L1)

Layout pattern for pages centered on a single core content block.

**Prerequisite:** Page must be classified as L1 in `page-structure-types.md` before applying this rule.

---

## 1. Trigger

Use this pattern when:
- Page has one primary content block (table, form, settings panel, list)
- No lateral sections or floor grouping needed
- User has a single clear task or goal on the page
- Content block fills the full container width

---

## 2. Structure

```
Page (H2 — 32px)
└── [Optional subtitle or description]
└── [Optional header actions / filters]
└── Primary content block (full width)
    └── [Optional sub-sections with Tab or filter]
```

- Single column layout by default
- Content block fills the full container width
- No sidebar unless explicitly specified in the page spec

---

## 3. Information Hierarchy

| Role           | Token                              | Size  | Usage                          |
|----------------|------------------------------------|-------|--------------------------------|
| Page title     | `typography.title.web.lg`          | 32px  | H2 — one per page              |
| Section title  | `typography.title.web.md`          | 24px  | H3 — optional sub-section     |
| Content label  | `typography.body.primary.semibold` | 16px  | H4 — table header groups       |
| Body           | `typography.body.secondary.*`      | 14px  | Row content, form fields       |
| Meta           | `typography.body.tertiary.*`       | 12px  | Labels, timestamps, helpers    |

---

## 4. Surface & Color Zones

| Zone              | Background token          | Notes                              |
|-------------------|---------------------------|------------------------------------|
| Page canvas       | `color.bg.layer1`         | Full page background               |
| Content block     | `color.bg.surface`        | Primary content area               |
| Zebra row         | `color.pattern.zebra`     | Alternating rows in tables         |
| Row hover         | `color.interaction.hover` | Applied as overlay on top of row bg|

---

## 5. Spacing Map

### Structural Spacing

| Token      | Value | Usage                                  |
|------------|-------|----------------------------------------|
| space1     | 48px  | Nav → page title                       |
| space2     | 24px  | Page title → content block             |
| space2-alt | 32px  | Page title → content (with subtitle)   |
| space3     | 24px  | Section title → section content        |

### Internal Spacing

| Context                          | Token         |
|----------------------------------|---------------|
| Content block padding            | `spacing.24`  |
| Between table rows               | 0 (divider line only) |
| Between form fields              | `spacing.16`  |
| Between label and input          | `spacing.8`   |
| Between tight elements           | `spacing.4`   |

### Header Actions Spacing

| Context                              | Token         |
|--------------------------------------|---------------|
| Page title → action buttons (right)  | `spacing.16`  |
| Between action buttons               | `spacing.8`   |
| Filter row → content                 | `spacing.16`  |

---

## 6. Production Variants

### Variant 1 — Data Table
- Primary content: sortable/filterable data table
- Table container: no outer border (see `list-table-pattern.md`)
- Row divider: `color.divider.level3`
- Header: `typography.body.tertiary.semibold`, `color.text.tertiary`
- Numeric columns: right-aligned

### Variant 2 — Sub-page with Tab
- Primary content area has a Tab header (Line Tab, Family A)
- Content below tab switches on selection
- Tab → content gap: `spacing.16`

### Variant 3 — Filtered Feed
- Primary content: vertically scrolling card or row list
- Filter bar above content: filter chips (pill) + optional dropdown
- Filter → content gap: `spacing.16`

### Variant 4 — Settings / Form
- Primary content: form with grouped fields
- Groups separated by `spacing.32`
- Destructive actions (Delete, Disconnect) at bottom, Red/Error color, same as standard button token rules

---

## 7. Content Density Strategy

- L1 pages use uniform density throughout — no alternating dense/light rhythm
- Content block should feel consistent and scannable
- If a section becomes very long (>20 rows), add pagination or load-more rather than infinite scroll
- Header actions (sort, filter, export) stay pinned at top of content block

---

## 8. Responsive Rules

| Breakpoint | Behavior                                                         |
|------------|------------------------------------------------------------------|
| XL ≥1410px | Full-width content block in fixed container                      |
| LG 900px   | Same, slight padding reduction                                   |
| MD 500px   | Full-width, table columns reduce (hide lower-priority columns)   |
| SM <500px  | Table collapses to card list; form fields go single column       |

---

## 9. Rules

### MUST
- Use H2 (32px) as page title — MUST NOT use H1
- Single content block fills full container width
- Apply consistent internal spacing throughout the block
- Table/list containers MUST NOT have outer border (see `list-table-pattern.md`)

### MUST NOT
- Use H1 on an L1 page
- Add a sidebar unless explicitly specified in page spec
- Apply `shadow.*` to the static content block container
- Use multiple different content block backgrounds on the same page

---

## 10. Failure

If violated:
- H1 used → replace with H2
- Outer border on list/table → remove, use row dividers only
- Shadow on content block → remove
- Inconsistent spacing within block → standardize to spacing map above
