# Design System — Spacing Tokens

All UI MUST follow this spacing system.

---

# 0. Core Principles

- MUST use spacing tokens
- MUST NOT use arbitrary spacing values
- MUST reflect content hierarchy
- MUST keep consistent rhythm

---

# 1. Base Scale（基础间距体系）

### spacing.0
- value: 0

### spacing.2
- value: 2

### spacing.4
- value: 4

### spacing.6
- value: 6

### spacing.8
- value: 8

### spacing.12
- value: 12

### spacing.16
- value: 16

### spacing.20
- value: 20

### spacing.24
- value: 24

### spacing.32
- value: 32

### spacing.48
- value: 48

---

# 2. App Spacing（移动端规则）

## Usage Logic

- 0 / 2 / 4 / 6 → dense elements
- 8 / 12 / 16 → content spacing
- 20 / 24 / 32 → module spacing

---

## Mapping

### spacing.tight
- value: spacing.4

### spacing.base
- value: spacing.8

### spacing.section
- value: spacing.16

### spacing.module
- value: spacing.24

---

# 3. Web Spacing（网页端规则）

## Page Level

### space.page.large
- value: 48

### space.page.normal
- value: 32

---

## Content Level

### space.lg
- value: 24

### space.md
- value: 16

### space.sm
- value: 8

### space.xs
- value: 4

---

## Usage Definition

### 48
- page sections
- navigation to content

---

### 32
- page blocks
- major grouping

---

### 24
- section spacing
- title to content

---

### 16
- content spacing
- list spacing

---

### 8
- tight content
- icon + text

---

### 4
- ultra dense
- micro spacing

---

# 4. Rules

### MUST

- MUST use spacing tokens
- MUST follow hierarchy (large → small)
- MUST use at least 2 spacing levels per module
- MUST keep vertical rhythm consistent

---

### MUST NOT

- MUST NOT use random spacing values
- MUST NOT mix unrelated spacing scales
- MUST NOT use large spacing inside dense components

---

# 5. Layout Logic（核心）

## Hierarchy

- page > section > module > content > element

---

## Mapping

- page → spacing.48 / 32
- section → spacing.24
- module → spacing.16
- content → spacing.8
- element → spacing.4

---

# 6. Component Mapping

### Page
- spacing.48 / spacing.32

---

### Section
- spacing.24

---

### Card
- internal padding → spacing.16
- element gap → spacing.8

---

### List
- item gap → spacing.8 / spacing.12

---

### Button
- internal padding → spacing.8

---

# 7. AI Rules（最关键）

### Mapping Logic

- IF level = page → spacing.48 / 32
- IF level = section → spacing.24
- IF level = module → spacing.16
- IF level = content → spacing.8
- IF level = element → spacing.4

---

### Density Control

- dense UI → use 4 / 6 / 8
- normal UI → use 8 / 16
- loose UI → use 16 / 24 / 32

---

### Restrictions

- DO NOT use more than 3 spacing scales in one module
- DO NOT mix random spacing

---

### FAILURE

If violated → regenerate UI