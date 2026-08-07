# Component Selection Rules — Ainvest-Specific

This file contains ONLY non-obvious, Ainvest-specific component selection rules.
Generic interaction-to-component mappings (e.g., "action → Button", "toggle → Switch") are omitted — models already know these.

---

## Button Shape Selection

- MUST use Full Rounded (pill) button by default in all product UI
- MUST NOT use Square button unless:
  - container space is limited AND multiple short-text options must appear together
  - the action is icon-only
- MUST NOT use Square button on Mobile

## Button Color Selection

- MUST use Black Primary for standard product actions
- MUST use Grey Secondary for supporting actions
- MUST use Brand Blue ONLY for:
  - trading-related UI
  - paid-product-related UI
  - landing pages
- MUST NOT use Brand Blue for general product actions (e.g., "Save", "Filter", "Share")

## SegmentedControl vs Tab

- Use SegmentedControl for binary or small-set state toggles within a module (e.g., "1D / 1W / 1M / 3M" time range)
- Use Tab for switching between distinct content views at section level (e.g., "Overview / Financials / News")
- MUST NOT use Tab for in-module toggles
- MUST NOT use SegmentedControl for page-level navigation

## Filter / Dropdown Hierarchy

- When a page has multiple filter dimensions, use inline filter chips (pill-shaped) for the primary filter and dropdown for secondary filters
- MUST NOT stack multiple dropdowns side by side as the primary filtering mechanism

## Landing Page vs Product Page Components

- Text Button and Landing Page Button MUST NOT appear in standard product pages
- Landing Page Button MUST NOT appear in product UI even if the action is important
- Product pages use Full Rounded pill buttons at all hierarchy levels

## Unspecified component

If no specific component rule exists for a scenario, report the missing component contract. Do not select a nearby component or invent a variant.
