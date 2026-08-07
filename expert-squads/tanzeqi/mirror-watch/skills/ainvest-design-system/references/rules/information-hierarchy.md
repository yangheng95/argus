# Information Hierarchy & Contrast Rules

**Category:** Design Principle
**Scope:** All components — cards, list rows, tables, tooltips, any multi-level information display

---

## Core Principle

**Primary information must be visually dominant. The contrast between levels must be strong enough to be felt at a glance — not just technically present.**

In a dense financial interface, users scan before they read. If primary and secondary information look similar in size, weight, or color, the user has to read every item to find the most important one. That breaks scan efficiency.

---

## Information Level Definitions

| Level          | What it is                                                | Examples                                                   |
| -------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| L1 — Primary   | The subject of the card / row. Who or what this is about. | Politician name + avatar, stock ticker symbol              |
| L2 — Secondary | The core action or data point. What happened.             | Transaction type, amount, date                             |
| L3 — Tertiary  | Context, metadata, supporting detail.                     | Party/state, event label, description text, relative dates |

---

## MUST

- MUST ensure L1 is visually larger and heavier than L2
- MUST ensure L2 is visually larger or heavier than L3
- MUST create a clear step between each level — the difference must be perceivable without close inspection
- MUST use at least TWO of the following contrast signals between L1 and L2:
  - font size difference (≥ 2px between levels)
  - font weight difference (e.g. 700 vs 400)
  - color contrast difference (e.g. `color.text.primary` vs `color.text.secondary` or `color.text.tertiary`)
  - spatial size (e.g. avatar/image size)

---

## MUST NOT

- MUST NOT use the same font size and weight for L1 and L2 — even if the color differs, similar size creates visual ambiguity
- MUST NOT use `color.text.secondary` for L1 content
- MUST NOT use the same font weight across all levels of a card

---

## Applied Examples

### Politician Card (Recommended carousel)

| Element         | Level | Rule                                                                                               |
| --------------- | ----- | -------------------------------------------------------------------------------------------------- |
| Avatar          | L1    | Larger size (≥ 64px). The face is the primary identifier                                           |
| Politician name | L1    | Largest text in the card. `font-size: 16px`, `font-weight: 700`, `color.text.primary`              |
| Ticker symbol   | L2    | `font-size: 13px`, `font-weight: 600`, `color.text.primary` — smaller than name but still readable |
| Amount          | L2    | `font-size: 12px`, `font-weight: 400`, `color.text.secondary`                                      |
| Date            | L3    | `font-size: 11px`, `color.text.tertiary`                                                           |

### Trade Event Card (Suspicious Trades carousel)

| Element           | Level | Rule                                                                    |
| ----------------- | ----- | ----------------------------------------------------------------------- |
| Avatar            | L1    | `40px` — larger than a standard inline avatar to signal primary subject |
| Politician name   | L1    | `font-size: 15px`, `font-weight: 700`, `color.text.primary`             |
| Party / State     | L3    | `font-size: 11px`, `color.text.tertiary` — subordinate metadata         |
| Ticker symbol     | L2    | `font-size: 13px`, `font-weight: 600` — smaller and lighter than name   |
| Amount            | L2    | `font-size: 12px`, `font-weight: 400`, `color.text.secondary`           |
| Event label       | L3    | `font-size: 11px`, styled with status color                             |
| Event description | L3    | `font-size: 12px`, `color.text.secondary`                               |

---

## Contrast Signal Reference

Use multiple signals in combination. A single signal (e.g. color alone) is not sufficient for L1 vs L2 distinction.

| Signal      | L1                       | L2                                   | L3                    |
| ----------- | ------------------------ | ------------------------------------ | --------------------- |
| Font size   | largest (15–16px)        | mid (12–13px)                        | smallest (11px)       |
| Font weight | 700                      | 600 or 400                           | 400                   |
| Color       | `color.text.primary`     | `color.text.primary` or `.secondary` | `color.text.tertiary` |
| Image size  | largest (40–64px avatar) | mid (20px logo)                      | —                     |

---

## FAILURE

- If a card's politician name is the same size as the ticker symbol below it → increase name to ≥ 15px, reduce ticker or lower its weight
- If a card's avatar is so small it reads as a decorative element rather than a primary identifier → increase to ≥ 40px for event cards, ≥ 64px for compact cards
- If all text in a card is the same color → add `color.text.secondary` / `.tertiary` to lower levels
- If the user's eye does not immediately land on the politician name when scanning the card → the L1/L2 contrast is insufficient
