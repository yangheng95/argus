# Hierarchy Clustering — Spacing Rule

**Category:** Spacing / Layout
**Scope:** Any nested structure — rows, cards, sections, lists

---

## The Core Rule

When a layout contains multiple elements that have sub-groupings, the **outer gap between clusters MUST be larger than the inner gap within a cluster**.

This is the single principle that separates readable dense UI from visual noise.

---

## Formal Definition

```
outer_gap > inner_gap
```

Where:

- `inner_gap` = spacing between elements that belong to the **same conceptual unit**
- `outer_gap` = spacing between **separate conceptual units** (clusters)

---

## MUST

- MUST identify grouping levels before assigning spacing
- MUST use at minimum a 2:1 ratio between outer and inner gap (e.g., 12px outer / 4–6px inner)
- MUST apply this rule to every nesting level independently (cards within a section, elements within a card, sub-elements within an element group)
- MUST use spacing tokens — never raw pixel values

Recommended token pairs:

| Inner gap (tight coupling) | Outer gap (cluster separation) |
| -------------------------- | ------------------------------ |
| `spacing.4` (4px)          | `spacing.12` (12px)            |
| `spacing.6` (6px)          | `spacing.16` (16px)            |
| `spacing.8` (8px)          | `spacing.20` (20px)            |
| `spacing.12` (12px)        | `spacing.24` (24px)            |

---

## MUST NOT

- MUST NOT use the same gap value for all elements in a row regardless of their conceptual relationships
- MUST NOT use `flex-wrap` as a substitute for intentional grouping — group first, then let it wrap
- MUST NOT skip a grouping level just because elements are on one line

---

## Example: Trade Row

**Wrong** (uniform gap — all elements equidistant):

```
[logo] [NVDA] [Buy] [$100K] [Jan 16]   ← gap: 6px everywhere
```

**Correct** (two-level grouping):

```
[ [logo] [NVDA] ]   [Buy]   [$100K]   [Jan 16→]
   inner: 4px         ↑ outer gap: 12px ↑
```

- `logo + ticker-symbol` → tightly coupled (same entity), `gap: spacing.4`
- `ticker-cluster` / `badge` / `amount` / `date` → separate semantic clusters, `gap: spacing.12`
- `date` pushed to trailing edge with `margin-left: auto`

---

## Example: Card Sections

```
Card
├── Header block           ← gap between blocks: spacing.16
│   ├── Avatar             ← gap within politician info: spacing.8
│   └── Politician info
│       ├── Name           ← gap between name and meta: spacing.2 (via margin, not gap)
│       └── Meta
├── Divider
└── Content block          ← gap between blocks: spacing.16
    ├── Trade row
    └── Event description
```

The spacing cascade: block gap (16) > element gap (8) > text gap (2).

---

## FAILURE

If outer_gap ≤ inner_gap → visual hierarchy collapses. Elements appear to belong to the wrong group. Flag and fix by identifying clusters first, then assigning spacing top-down.
