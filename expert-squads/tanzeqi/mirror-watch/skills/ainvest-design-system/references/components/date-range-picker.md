# Guidelines — Date Range Picker (范围日期选择器)

## 0. Document Role

This document covers **only the differences** between the Date Range Picker (范围日期选择器) and the basic Date Picker. All shared behavior — navigation, view modes, disabled dates, markers, drill-down rules, action bar, internationalization — follows the same rules as `date-picker.md`. Read that document first.

<!-- - Component import: `@ainvest/date-range-picker` -->

---

## 1. Definition

The Date Range Picker is a consecutive day interval selector with a **start** and **end** concept. The user selects two specific days to define a range; every day between them is included and highlighted as a contiguous block.

Use it when the user needs to specify a **consecutive period of days** rather than a single point in time.

**Typical use cases:** viewing projected returns over an options expiry period, filtering data by a custom date range.

---

## 2. When to Use vs Date Picker

| Need | Component |
|---|---|
| Select a **single** date, week, month, or year | `date-picker` |
| Select a **consecutive range of days** with a start and end | `date-range-picker` |

---

## 3. Key Props

These are the props specific to `date-range-picker`. All other props (`viewMode`, `minDate`, `maxDate`, `timezone`, `locale`, `displayMode`, `markedDates`, `showTodayIndicator`, `showViewOptions`, `datePickerModes`) behave identically to `date-picker` — refer to `date-picker.md §4`.

| Prop | Type | Notes |
|---|---|---|
| `dateRange` | `{ startDate: Date \| null, endDate: Date \| null }` | Controlled range value. Pass `null` for unset start or end. |
| `onSelectDateRange` | `(range: { startDate: Date, endDate: Date }) => void` | Fires when the user completes a range selection |
| `startPlaceholder` | `string` | Placeholder text for the start date field (e.g., `"Start"`) |
| `endPlaceholder` | `string` | Placeholder text for the end date field (e.g., `"End"`) |
| `minDate` | `Date \| string` | Earliest selectable date — shared with `date-picker` |
| `maxDate` | `Date \| string` | Latest selectable date — shared with `date-picker` |
| `timezone` | `string` | IANA timezone (e.g., `'Asia/Shanghai'`) — shared with `date-picker` |
| `locale` | `string` | Locale string (e.g., `'en'`, `'zh-hans'`) — shared with `date-picker` |

---

## 4. Range Selection Interaction Rules

This is the core difference from the basic Date Picker. The selection flow works as follows:

1. **First click** — sets the start date. The bottom bar shows: `Start: 13 Jun, 2025 — End: --`
2. **Second click** — sets the end date. The system automatically sorts the two dates chronologically: the earlier date fills `Start`, the later fills `End`.
3. **Same date clicked twice** — start and end are set to the same day (single-day range).
4. **Click after a complete range is set** — clears the existing range and begins a new selection from the clicked date.

> **Auto-sort:** The user does not need to click in chronological order. If the user selects a date earlier than the current start, the system swaps them automatically.

The selected range is always shown at the bottom of the panel:
```
Start: 13 Jun, 2025  —  End: 17 Jun, 2025
```

### Re-select Behavior (初始聚焦)

When the picker is opened and a **complete range already exists** (both `startDate` and `endDate` are set), the **Start** field is automatically pre-focused. This signals to the user that they are in "re-select" mode. Once the user selects a new date, the highlight clears and normal selection flow resumes.

---

## 5. Action Bar (操作栏)

Unlike the basic Date Picker (where action bar is optional), the Date Range Picker **always requires an action bar with Confirm and Cancel buttons** — the user must explicitly confirm the range before the value is returned.

| Type | Examples | Notes |
|---|---|---|
| **操作按钮** (Required) | Confirm, Cancel | Always include — range selection needs explicit confirmation |
| **业务功能按钮** (Optional) | Last 7 Days, Last 30 Days, This Month | Quick-set common ranges; placed on the left side |
| **Combined** | Shortcuts left + Confirm/Cancel right | Most common pattern for range pickers |

---

## 6. Selection Mode

The Date Range Picker supports **day-level selection only**. The selected range must be a **consecutive sequence of days** — no gaps, no week/month/year granularity.

- `viewMode` is always `'day'` — the precision switcher, if shown, only affects navigation, not the selection unit.
- Start and end must both be specific calendar days.
- All days between start and end are included in the range and highlighted.

---

## 7. Disabled Dates

Same as `date-picker` — use `minDate` / `maxDate` to constrain the selectable range. Additionally, a **maximum span** can be configured to limit how wide a range the user can select (e.g., max 90 days). Dates that would exceed the max span are disabled after the first date is selected.

---

## 8. Everything Else

The following are **identical** to `date-picker.md` — refer to that document:

- Navigation bar configurations and styles (§7 in `date-picker.md`)
- Date precision switcher (`viewMode`, `showViewOptions`, `datePickerModes`)
- Drill-down navigation rules (§10 in `date-picker.md`)
- Markers (`markedDates`, `showTodayIndicator`) (§9 in `date-picker.md`)
- Internationalization (`locale`, `timezone`) (§11 in `date-picker.md`)
- `displayMode` (desktop vs mobile)

---

## 9. Do / Don't

| ✅ Do | ❌ Don't | Reason |
|---|---|---|
| Always include Confirm + Cancel in the action bar | Use auto-confirm (no action bar) for range selection | Users need to review and confirm start/end before submitting |
| Rely on auto-sort — let the system order the dates | Enforce that users must click start before end | Auto-sort removes friction and prevents selection errors |
| Show the `Start / End` display at the bottom during selection | Hide the current selection state | Users need to see what they have selected before confirming |
| Use shortcut buttons for common ranges (Last 7 Days, etc.) | Require users to always navigate manually for common ranges | Shortcuts reduce interaction cost significantly |
| Set `minDate` / `maxDate` and a max span where applicable | Allow unrestricted range selection when the domain has limits | Unbounded range selection can produce invalid or nonsensical queries |
| Pass `null` for unset dates in `dateRange` | Pass `undefined` or omit the key | The component expects explicit `null` to represent an unset start or end |

---

## 10. Decision Table

| Scenario | `viewMode` | Action Bar | Shortcuts |
|---|---|---|---|
| Custom consecutive day range | `'day'` | Confirm + Cancel | Optional (Last 7/30 days) |
| Range with a max span constraint | `'day'` | Confirm + Cancel | Use `minDate`/`maxDate` + max span |
| Re-opening picker with existing range | `'day'` | Confirm + Cancel | Start field auto-focused |

---

## 11. Related Documents

- `ainvest-design-system/references/components/date-picker.md`
- `ainvest-design-system/references/components/input.md`
- `ainvest-design-system/SKILL.md`
