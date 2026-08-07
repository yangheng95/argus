# Page Structure Types

Defines three page structure levels. Every page MUST be classified as L1, L2, or L3 before layout begins.

---

## Structure Overview

| Level | Structure                        | Title heading | Examples                        |
|-------|----------------------------------|---------------|---------------------------------|
| L1    | Page → single content block      | H2 (32px)     | Watchlist, Settings, Portfolio  |
| L2    | Page → multiple independent modules | H2 (32px)  | Screener, News Hub, Discover    |
| L3    | Page → groups → floors → modules | H1 (40px)     | Market Overview, Home Feed      |

**Critical rule: H1 (40px) is ONLY for L3 pages. L1 and L2 MUST use H2 (32px) as page title.**

---

## L1 — Single Focus Page

- One primary content block dominates the page
- No floor grouping, no lateral sections
- Task-oriented: user has a clear single goal
- Content block fills the full container width
- See `single-focus.md` for full layout rules

**Trigger conditions:**
- Single core content block (table, form, settings panel)
- No need to navigate between content groups
- User is focused on one task at a time

---

## L2 — Modular Content Page

- Multiple independent modules on the same page
- Modules are peers — no hierarchical grouping above them
- Each module has its own floor title (H3, 24px)
- Page has a single H2 page title
- See `modular-content.md` for full layout rules

**Trigger conditions:**
- 2–6 distinct content sections that don't belong to a shared parent group
- Content can be consumed independently
- User scans across sections rather than drilling into one

---

## L3 — Multi-Group Page

- Multiple groups, each containing multiple floors
- Groups are the top organizational unit (H2, 32px)
- Page has one H1 title (40px) — only L3 uses H1
- See `multi-group.md` for full layout rules

**Trigger conditions:**
- More than 2 content groups, each with 2+ sub-sections
- Long scroll page with distinct thematic sections
- User needs orientation landmarks across the page

---

## Shared Spacing System

All page types use the same structural spacing tokens:

| Token     | Value | Usage                                      |
|-----------|-------|--------------------------------------------|
| space1    | 48px  | Navigation bar → page title                |
| space2    | 24px  | Page title → content (no sub-content)      |
| space2-alt| 32px  | Page title → content (with sub-content)    |
| space3    | 24px  | Floor title → floor content                |
| space4    | 48px  | Floor → next floor                         |

**L2 override:**
- space2 → 32px (page title → first module)
- space2-alt → 48px (page title → first module when subtitle present)

---

## Heading Hierarchy

| Level | Token                     | Size | Weight | Usage                     |
|-------|---------------------------|------|--------|---------------------------|
| H1    | `typography.title.web.xl` | 40px | Bold   | L3 page title only        |
| H2    | `typography.title.web.lg` | 32px | Bold   | L1/L2 page title; L3 group title |
| H3    | `typography.title.web.md` | 24px | Bold   | Floor title (all levels)  |
| H4    | `typography.body.primary.semibold` | 16px | SemiBold | Module label / card title |

---

## Rules

### MUST
- Classify every page as L1, L2, or L3 before writing layout
- Use H2 as page title for L1 and L2
- Use H1 as page title only for L3
- Apply the shared spacing system tokens

### MUST NOT
- Use H1 on L1 or L2 pages
- Skip classification and guess heading levels
- Mix heading levels within the same structural role (e.g. two H1s on one page)

---

## Failure

If violated:
- H1 on L1/L2 page → downgrade to H2
- Wrong heading hierarchy → re-classify page level first, then reassign headings
