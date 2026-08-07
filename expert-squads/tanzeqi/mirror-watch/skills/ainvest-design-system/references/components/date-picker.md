# Guidelines — Date Picker (基础日期选择器)

## 0. Document Role

This document covers **when and how to use** the Date Picker (基础日期选择器) component. It focuses on decisions a developer or AI must make explicitly — visual details handled automatically by the component are omitted.

<!-- - Component import: `@ainvest/date-picker` -->
- Related: `input.md`, `dropdown-menu.md`, `date-range-picker.md`, `dialog.md`

---

## 1. Definition

The Date Picker is a time visualization tool for displaying and selecting a **single date**. It contains three levels of information — year, month, and day — and supports switching between view modes. It is composed of three parts:

1. **日期选择区** — The calendar grid. Clicking a date triggers `onSelectDate` and auto-confirms.
2. **导航控制** — Navigation header. Provides prev/next navigation arrows and a view mode precision switcher (`viewMode`).
3. **操作栏** — Action bar (optional). Used for quick-access shortcut buttons (e.g., "Today", "Yesterday").

---

## 2. When to Use

Use the Date Picker when:

- The user needs to select a **single** specific date, week, month, or year from a visual calendar.
- The scenario is simple — clicking a date auto-returns the value with no additional confirmation step.
- Quick navigation shortcuts (e.g., "Today", "Yesterday", "Last 5 days") would improve efficiency.

**Typical use cases:** viewing a stock's trend on a specific day, browsing a week's trading records.

---

## 3. When NOT to Use

| Situation | Use Instead |
|---|---|
| User needs to select a start and end date (time range) | `date-range-picker` (范围日期选择器) |
| User types a date directly without needing a visual picker | `Input` with date format validation |
| Date selection is part of a larger form with many fields | Inline date input fields |
| Only a year or only a month is needed with no drill-down | A simple Dropdown / Select |

---

## 4. Key Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `date` | `Date \| string` | — | Controlled selected date |
| `defaultDate` | `Date \| string` | — | Initial date for uncontrolled mode |
| `viewMode` | `'day' \| 'week' \| 'month'` | `'day'` | Controlled precision switcher state — sets the minimum selection unit |
| `defaultViewMode` | `'day' \| 'week' \| 'month'` | `'day'` | Initial view mode for uncontrolled mode |
| `onSelectDate` | `(date: Date) => void` | — | Fires when the user selects a date |
| `onViewModeChange` | `(mode: string) => void` | — | Fires when the user switches the precision segment |
| `datePickerModes` | `string[]` | all modes | Restricts which view modes are shown in the switcher (e.g. `['month', 'year']` for month/year only) |
| `showViewOptions` | `boolean` | `true` | Shows or hides the precision switcher (Month/Week/Day toggle). When `false`, navigation is centered. |
| `minDate` | `Date \| string` | — | Earliest selectable date — dates before this are disabled |
| `maxDate` | `Date \| string` | — | Latest selectable date — dates after this are disabled |
| `displayMode` | `'default' \| 'mobile'` | `'default'` | `'default'` = desktop layout; `'mobile'` = mobile layout |
| `timezone` | `string` | — | IANA timezone string (e.g., `'Asia/Shanghai'`, `'America/New_York'`) |
| `locale` | `string` | — | Locale string (e.g., `'zh-hans'`, `'en'`, `'ja'`) |
| `markedDates` | `MarkedDate[]` | — | Array of dates with custom dot markers. Supports multiple markers per day in multiple colors. |
| `showTodayIndicator` | `boolean` | `true` | Shows or hides the today dot indicator on the current date |

---

## 5. Selection Modes (`viewMode`)

The `viewMode` prop controls both the precision switcher display and the minimum selection unit.

| `viewMode` | Min Unit | Calendar Shows | Selection Behavior |
|---|---|---|---|
| `'day'` | Day | Standard month grid (Su–Sa) | Single day selected |
| `'week'` | Week | Standard month grid | Clicking any day selects the full week row. Natural week = Su–Sa; Trading week = Mo–Fr (Su/Sa greyed out) |
| `'month'` | Month | Month grid grouped by year | Single month selected |
| `'year'` *(via `datePickerModes`)* | Year | Year grid (X–Y range) | Single year selected |

> Use `datePickerModes` to restrict available modes. For example, `datePickerModes={['month', 'year']}` shows only Month and Year in the switcher.

---

## 6. Disabled Dates

Use `minDate` and `maxDate` to constrain the selectable range. Dates outside this range are rendered greyed-out and are not interactive. Applies at all granularity levels: year grid, month grid, and day grid.

---

## 7. Navigation (导航)

### 7.1 Navigation Bar Configurations

| Style | Elements | When to Use |
|---|---|---|
| **仅说明文案** | Description text only | Panel with a label, no navigation needed |
| **说明文案 + 关闭按钮** | Description text + × close | Dismissible panel with a label |
| **说明文案 + 日期切换条** | Description text + precision switcher | Panel with label and granularity control |
| **仅年月切换** | `«` `‹` Month/Year `›` `»` only | Standard calendar navigation, no switcher |
| **年月切换 + 关闭** | Month/Year arrows + × close | Dismissible calendar panel |
| **年月切换 + 日期切换** | Month/Year arrows + precision switcher | Full navigation with granularity control (most common) |

Use `showViewOptions={false}` to hide the switcher entirely — navigation arrows will center automatically.

### 7.2 Navigation Arrow Behavior

Arrow availability adapts based on the active `viewMode`:

| Active `viewMode` | Left-side arrows |
|---|---|
| `'year'` or `'month'` | Year-only: `«` `»` |
| `'week'` or `'day'` | Year + month: `«` `‹` `›` `»` |

**Year range display (X–Y):** X = first visible year in the grid; Y = last visible year in the grid.

---

## 8. Action Bar (操作栏)

The action bar is optional — omit it when single-click auto-confirm is sufficient.

| Type | Examples | When to Use |
|---|---|---|
| **业务功能按钮** (Shortcut) | Today, Yesterday, Last 5 Days | Quick-jump to common relative dates |
| **操作按钮** (Action) | Confirm, Cancel, Reset | When explicit confirmation is needed |
| **Combined** | Shortcuts left + Confirm/Cancel right | When both shortcuts and confirmation are needed |

Button styles supported: pill (胶囊), icon only, icon + text, text only. Layout: centered or left-right distributed.

---

## 9. Markers (标记)

Use `markedDates` to place visual dot markers on specific dates (e.g., earnings dates, financial report days).

- Supports **multiple markers per day** in **multiple colors**.
- Use `showTodayIndicator={false}` to hide the default today dot.
- Marker position: small dot below the date number.
- Only applicable on day-level and week-level views (natural day and trading day).

---

## 10. Drill-down Navigation Rules (跳转规则)

Clicking the year/month label in the navigation header drills up to a higher granularity. The available path depends on the active `viewMode`:

| Active `viewMode` | Drill-up path |
|---|---|
| `'day'` or `'week'` | Day/Week grid → Month grid → Year grid |
| `'month'` | Month grid → Year grid |
| `'year'` | Year grid only — navigation arrows only, no further drill-up |

**Year grid header** shows the visible range as X–Y (X = first, Y = last visible year in the panel).

---

## 11. Internationalization

| Prop | Example Values | Notes |
|---|---|---|
| `locale` | `'zh-hans'`, `'en'`, `'ja'` | Controls date labels, month names, weekday headers |
| `timezone` | `'Asia/Shanghai'`, `'America/New_York'`, `'Asia/Tokyo'` | Controls date boundary calculations |

Both props should always be set together for consistent date display across locales and timezones.

---

## 12. Do / Don't

| ✅ Do | ❌ Don't | Reason |
|---|---|---|
| Use for simple single-date selection that auto-confirms | Use for time range selection | Use `date-range-picker` for start/end date scenarios |
| Use `minDate` / `maxDate` to constrain valid dates | Leave out-of-range dates selectable | Selectable out-of-range dates cause invalid data submission |
| Set `viewMode` to match the minimum unit the user needs | Show all view modes when only one granularity is relevant | Unnecessary options confuse users |
| Use `viewMode="week"` with trading week for financial contexts | Use natural week mode for trading data | Trading weeks exclude weekends which are not trading days |
| Use `markedDates` sparingly for genuinely special dates | Mark many dates with dots | Too many markers lose their signal value |
| Always set both `locale` and `timezone` | Set one without the other | Mismatched locale/timezone causes incorrect date boundary display |
| Use shortcut buttons for frequently accessed relative dates | Require users to always navigate the grid manually | Shortcuts reduce interaction cost for common dates |

---

## 13. Decision Table

| Scenario | `viewMode` | `datePickerModes` | Action Bar | `markedDates` |
|---|---|---|---|---|
| View stock trend on a specific day | `'day'` | default | None | Optional (`showTodayIndicator`) |
| Browse a week's trading records | `'week'` | default | None | Optional |
| Browse a natural calendar week | `'week'` | default | None | Optional |
| Filter by month only | `'month'` | `['month', 'year']` | None | None |
| Filter by year only | `'year'` | `['year']` | None | None |
| Quick jump to today / yesterday | `'day'` | default | Shortcut buttons | `showTodayIndicator={true}` |
| Mark earnings / report dates | `'day'` | default | None | `markedDates` array |
| Constrain selectable range | any | any | — | Use `minDate` / `maxDate` |

---
