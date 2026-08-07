# Avatar & Image Sizing

**Category:** Component
**Scope:** Avatars (people), logos (stock/brand), icons, image containers

---

## Shape Rules

- MUST use `radius.full` (50%) for all person avatars — always circular
- MUST use `radius.sm` (6px) for square logo containers and image thumbnails
- MUST NOT use any other radius for avatars

---

## Explicit no-photo variant

- Show initials — max 2 characters
- Background: `color.bg.weak`
- Text color: `color.text.tertiary`
- Font weight: SemiBold (600)

---

## App Container Sizes (system icons, stock logos, feature icons)

Used for icons and logos embedded within UI elements.

| Token                       | px  | Primary use                         |
| --------------------------- | --- | ----------------------------------- |
| `sizing.square.super-small` | 10  | Decorative / indicator dots         |
| `sizing.square.extra-small` | 12  | System icon (smallest)              |
| `sizing.square.small`       | 14  | System icon                         |
| `sizing.square.base-small`  | 16  | System icon                         |
| `sizing.square.medium`      | 20  | System icon / stock logo (compact)  |
| `sizing.square.base`        | 24  | System icon / stock logo (standard) |
| `sizing.square.large`       | 32  | Grid icon / stock logo (prominent)  |
| `sizing.square.extra-large` | 36  | Other containers (use sparingly)    |
| `sizing.square.xl`          | 40  | Stock logo (featured)               |
| `sizing.square.xxl`         | 48  | Page content icon                   |
| `sizing.square.xxxl`        | 64  | News image / featured logo          |
| `sizing.square.xxxxl`       | 80  | Large image container               |

---

## Web Avatar / Person Avatar Sizes

Used for politician photos, user profile pictures, commenter avatars.

| Level    | px            | Typical scene                                                    |
| -------- | ------------- | ---------------------------------------------------------------- |
| XS       | 18            | Small tags, reply/comment threads, low-prominence inline         |
| M        | 28            | **Default** — module logos, standard card rows, table cells      |
| L        | 48            | Prominent card header, featured content, politician profile card |
| Extended | 64 / 80 / 128 | Special scenes (profile page, hero section) — specify explicitly |

**Default avatar size is M (28px)** unless a higher prominence level is required by the Page Spec.

---

## Image Container Sizes

### Square (1:1) — small list thumbnails

Preferred sizes: `48` / `72` / `96` / `128` px
Use `radius.sm` (6px). Do not use custom sizes.

### Rectangle (16:9) — news hero, video

Flexible — use grid column widths. Height = width × (9/16).
Minimum readable height: 96px.

---

## MUST

- MUST use a size from the defined scale — no custom pixel values
- MUST use `sizing.square.base` (24px) as the default stock logo/ticker logo size in table rows
- MUST use `sizing.square.medium` (20px) for ticker logos in dense rows (politician card trade rows)
- MUST use avatar M (28px) as default person avatar in table cells
- MUST use avatar L (48px) for politician card avatars (Compact card variant uses 64px per Page Spec override)

---

## MUST NOT

- MUST NOT mix avatar sizes within the same list context (all rows at the same level must use the same avatar size)
- MUST NOT use arbitrary sizes like 36px, 44px for avatars — use the defined scale only

---

## FAILURE

If a size is not from either the App Container scale or the Web Avatar scale → flag as non-standard and map to the nearest defined token before rendering.
