# Multi-Group Page (L3)

Layout pattern for complex pages with multiple thematic groups, each containing multiple floor sections.

**Prerequisite:** Page must be classified as L3 in `page-structure-types.md` before applying this rule.

---

## 1. Trigger

Use this pattern when:
- Page has 3+ distinct thematic groups
- Each group contains 2+ sub-sections (floors)
- Long-scroll page where users need orientation landmarks
- Content has a clear hierarchical parent-child grouping structure

---

## 2. Structure Tree

```
Page (H1 — 40px)
└── Group A (H2 — 32px)
    ├── Floor 1 (H3 — 24px)
    │   └── Module content
    └── Floor 2 (H3 — 24px)
        └── Module content
└── Group B (H2 — 32px)
    ├── Floor 1 (H3 — 24px)
    └── Floor 2 (H3 — 24px)
```

**H1 is exclusively for L3 page title. MUST NOT use H1 in L1 or L2 pages.**

---

## 3. Information Hierarchy

| Role          | Token                              | Size  | Usage                         |
|---------------|------------------------------------|-------|-------------------------------|
| Page title    | `typography.title.web.xl`          | 40px  | H1 — one per page, L3 only    |
| Group title   | `typography.title.web.lg`          | 32px  | H2 — one per group            |
| Floor title   | `typography.title.web.md`          | 24px  | H3 — one per floor section    |
| Module label  | `typography.body.primary.semibold` | 16px  | H4 — sub-section label        |
| Body          | `typography.body.secondary.*`      | 14px  | Content                       |
| Meta          | `typography.body.tertiary.*`       | 12px  | Labels, timestamps            |

---

## 4. Surface & Color Zones

| Zone              | Background token          | Notes                              |
|-------------------|---------------------------|------------------------------------|
| Page canvas       | `color.bg.layer1`         | Full page background               |
| Group zone        | `color.bg.layer2`         | Optional subtle group separation   |
| Floor module      | `color.bg.surface`        | Card-level background              |
| Section divider   | `color.divider.level2`    | Between groups (stronger rule)     |
| Module divider    | `color.divider.level3`    | Between floors within a group      |

Group zone background is optional. Use spacing alone when groups are visually distinct enough.

---

## 5. Spacing Map

| Token  | Value | Usage                                   |
|--------|-------|-----------------------------------------|
| space1 | 48px  | Nav → H1 page title                     |
| space2 | 32px  | H1 → first group                        |
| space3 | 24px  | Group title (H2) → first floor          |
| space4 | 48px  | Floor → next floor (within group)       |
| space5 | 64px  | Group → next group                      |

### Module Internal Spacing

| Context                     | Token         |
|-----------------------------|---------------|
| Module card padding         | `spacing.24`  |
| Floor title → content       | `spacing.16`  |
| Between content items       | `spacing.12`  |
| Between tight elements      | `spacing.8`   |

### Two-Column Module Spacing

- Column gap: `spacing.48`
- Default ratio: 8:4 (main : secondary)
- Both columns MUST be inside the same fixed-width container

---

## 6. Content Density Strategy

L3 pages carry the most content — density rhythm is critical.

- Each group MUST have at least one visually lighter floor (chart, image, whitespace)
- MUST NOT place 3+ dense list/table floors in sequence without a visual break
- Group separations (64px gap) act as natural rest points
- Heavier groups should appear earlier in the page scroll

---

## 7. Production Variants

### Market Overview (Multi-category)
- Groups: Equities / Crypto / Commodities / Bonds
- Each group has: summary strip + data table + chart floor
- Group separation: 64px + optional `color.divider.level2` horizontal rule

### Home Discovery Feed
- Groups: Trending / For You / Watchlist Activity
- Each group has: featured card + horizontal card strip + feed list
- Group titles anchored for scroll navigation

---

## 8. Responsive Rules

| Breakpoint | Behavior                                                    |
|------------|-------------------------------------------------------------|
| XL ≥1410px | Full multi-column layout within each group                  |
| LG 900px   | Two-column modules collapse to single column                |
| MD 500px   | All modules single-column, group title font drops to 24px   |
| SM <500px  | Groups collapse, optional: show group as accordion          |

---

## 9. Rules

### MUST
- Use H1 (40px) as page title — L3 is the only level where H1 is allowed
- Use H2 (32px) for group titles
- Use H3 (24px) for floor titles within groups
- Apply `spacing.64` between groups
- Apply `spacing.48` between floors within a group

### MUST NOT
- Use H1 on any page that is not L3
- Use the same spacing value for group-to-group and floor-to-floor separation
- Apply `shadow.*` to static floor containers
- Mix different card radius values within the same group

---

## 10. Failure

If violated:
- H1 on non-L3 page → re-classify page, then downgrade heading if L3 classification is wrong
- Flat spacing (no distinction between group/floor gaps) → restore space4=48px and space5=64px
- Shadow on static container → remove shadow
