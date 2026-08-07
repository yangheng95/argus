# Guidelines — Input (输入框)

## 0. Document Role

This document covers **when and how to use** the Input component family. It focuses on decisions a developer or AI must make explicitly — visual details handled automatically by the component are omitted.

<!-- - Component import: `@ainvest/input` -->
- Variants: `Input`, `Input.Number`, `Input.RangeNumber`, `Input.Textarea`, `Input.SingleOtp`, `Input.MultipleOtp`

---

## 1. Definition

The Input component provides a control for users to enter and edit text or numbers. It is the primary data entry point on a page. Each variant is optimized for a specific input type or interaction pattern.

---

## 2. When to Use

Use an Input variant when:

- The user needs to enter free-form text, a number, a range, a paragraph, or a verification code.
- The field is part of a form or data collection flow.
- Input validation, character limits, or real-time feedback is required.

---

## 3. When NOT to Use

| Situation | Use Instead |
|---|---|
| User selects from a fixed list of options | Select / Dropdown |
| User toggles a boolean setting | Switch / Checkbox |
| User picks a date or time | Date Picker |
| User uploads a file | File Upload |

---

## 4. Variants Overview

| Variant | When to Use |
|---|---|
| `Input` | Standard single-line text — names, emails, search, general form fields |
| `Input.Number` | Single numeric value with optional stepper and unit suffix |
| `Input.RangeNumber` | Numeric range with a "from" and "to" field — e.g., price range, percentage range |
| `Input.Textarea` | Multi-line free-form text — feedback, descriptions, notes |
| `Input.SingleOtp` | Single-box OTP/verification code entry with send/resend action |
| `Input.MultipleOtp` | Multi-box OTP entry — each digit in its own box, auto-advances on input |

---

## 5. Input (基础输入框)

### States
Component handles all visual state rendering automatically: default → hover → focus/active → typing → disabled → error.

### Key Props

| Prop | Type | Default | When to Use |
|---|---|---|---|
| `label` | `ReactNode` | — | Always provide a label |
| `required` | `boolean` | `false` | Mark field as required; renders `*` marker |
| `placeholder` | `string` | — | Short instructional hint inside the field |
| `maxLength` | `number` | — | Enables character counter (`current/max`); border and text turn red when exceeded. Accurately counts emoji and CJK characters. |
| `allowClear` | `boolean` | `false` | Shows a × clear button when the field has content. Clear button is hidden when the field loses focus. |
| `password` | `boolean` | `false` | Masks input; shows eye icon to toggle visibility. Use for passwords or sensitive values. |
| `addonBefore` | `ReactNode` | — | Prefix element inside the field — icon, emoji, symbol (e.g., 🔍, flag). |
| `addonAfter` | `ReactNode` | — | Suffix element inside the field — icon or symbol. |
| `prefix` | `ReactNode` | — | Fixed prefix label outside the input area (e.g., `$`, `%`). |
| `suffix` | `ReactNode` | — | Fixed suffix label outside the input area (e.g., `%`, unit). |
| `error` | `ReactNode` | — | Error message shown below the field; triggers red border. |
| `success` | `ReactNode` | — | Success message shown below the field; triggers success border. |
| `disabled` | `boolean` | `false` | Disables the field; entered content is greyed out same as placeholder. |
| `onChange` | `(value: string) => void` | — | Fires on every keystroke. Use for real-time validation logic. |

### Label Configuration

Choose based on form requirements:

| Scenario | Config |
|---|---|
| Required field | `required={true}` — renders `*` marker |
| Optional field | Add "Optional" text in `label` — reduces user anxiety |
| Field needs explanation | Add a `?` tooltip node in `label` |
| Helper text needed | Pass helper content into `label` or render below the field |

### Real-time Validation

Real-time validation (带实时检测) is **not a built-in prop** — implement it by combining `onChange` with `error` / `success` to display condition status below the field as the user types. Each condition should be rendered as a separate line in `error` or `success`.

---

## 6. Input.Number (单值数值输入框)

Used for **single numeric values**. Supports min/max range, decimal precision, step size, and stepper controls.

### Key Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `min` / `max` | `number` | — | Constrains the valid input range |
| `step` | `number` | `1` | Increment/decrement amount per stepper click or arrow key |
| `precision` | `number` | — | Decimal places allowed |
| `prefix` / `suffix` | `ReactNode` | — | Unit label (e.g., `%`, `$`, `￥`) |
| `adjustType` | `'button' \| 'arrow'` | `'button'` | **`'button'`**: renders `−` / `+` buttons flanking the field (web). **`'arrow'`**: renders up/down chevrons inside the field (mobile). |
| `error` | `ReactNode` | — | Error message below the field |

### Platform Convention
- Use `adjustType="button"` on **web**.
- Use `adjustType="arrow"` on **mobile**.

---

## 7. Input.RangeNumber (范围数值输入框)

Used when the user must enter **both a lower and upper bound** for a numeric range.

### Key Props

| Prop | Type | Notes |
|---|---|---|
| `prefixes` | `[ReactNode, ReactNode]` | Labels for start and end fields (e.g., `["From", "To"]`) |
| `suffixes` | `[ReactNode, ReactNode]` | Unit labels for both fields (e.g., `["%", "%"]`) |
| `placeholders` | `[string, string]` | Placeholder text for both fields |
| `defaultValues` | `[number, number]` | Initial values |
| `values` | `[number, number]` | Controlled values |
| `startMin/startMax` | `number` | Constrains the start field range |
| `endMin/endMax` | `number` | Constrains the end field range |
| `startPrecision/endPrecision` | `number` | Decimal precision per field |
| `errorContents` | `[ReactNode, ReactNode]` | Per-field error messages; pass `null` for no error on a field |

---

## 8. Input.Textarea (段落输入框)

Used for **multi-line free-form text**. Supports fixed height, auto-grow, and user-resizable modes.

### Key Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `rows` | `number` | `3` | Number of visible rows in fixed height mode |
| `autoSize` | `boolean \| { minRows: number; maxRows: number }` | `false` | **`true`**: height grows freely with content. **`{ minRows, maxRows }`**: height grows within a bounded range. |
| `resizable` | `boolean` | `false` | Shows a drag handle at the bottom-right; user can resize the textarea manually. |
| `maxLength` | `number` | — | Character counter shown at bottom-right (`current/max`); turns red when exceeded. |
| `error` | `ReactNode` | — | Error message below the field; triggers red border. |

### Height Mode Decision

| Mode | Props | When to Use |
|---|---|---|
| **Fixed height** | `rows={n}` (default) | Content length is predictable; overflow scrolls internally |
| **Auto-grow** | `autoSize={true}` | Content length is unpredictable; field expands to fit |
| **Bounded auto-grow** | `autoSize={{ minRows, maxRows }}` | Grows within a min/max range; overflows scroll beyond max |
| **User-resizable** | `resizable={true}` | User needs manual control over textarea height |

---

## 9. Input.SingleOtp (单框验证码输入)

Single input field for verification code entry with an integrated send/resend trigger.

### Key Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `onSendCode` | `() => Promise<boolean>` | — | Called when user clicks "Send code". **Must return `true` to start the countdown.** Returning `false` or throwing keeps the button in "Send code" state — use this to handle API failures gracefully. |
| `countdown` | `number` | `60` | Countdown duration in seconds after a successful send |
| `sendButtonContent` | `ReactNode` | `'Send code'` | Label for the initial send button |
| `sendingButtonContent` | `ReactNode` | `'Sending...'` | Label shown while the API call is in progress |
| `resendButtonContent` | `ReactNode` | `'Resend'` | Label shown after countdown ends |
| `countdownContent` | `ReactNode` | — | Custom template for the countdown display (e.g., "Resend (59s)") |
| `onComplete` | `(otp: string) => void` | — | Fires when OTP entry is complete |
| `error` / `success` | `ReactNode` | — | Validation feedback below the field |

### Send State Flow
```
"Send code" → [click] → "Sending..."
  → onSendCode returns true  → countdown (60s) → "Resend"
  → onSendCode returns false → back to "Send code" (API failed, user can retry)
  → onSendCode throws        → back to "Send code" (network error)
```

---

## 10. Input.MultipleOtp (多框验证码输入)

Multi-box OTP entry where each digit occupies its own box.

### Key Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `length` | `number` | `6` | Number of OTP boxes |
| `masked` | `boolean` | `false` | Masks entered digits (like a password field) |
| `autoFocus` | `boolean` | `false` | Auto-focuses the first box on mount |
| `onSendCode` | `() => Promise<boolean>` | — | Same behavior as `Input.SingleOtp` — returns `true` to start countdown |
| `onComplete` | `(otp: string) => void` | — | Fires when all boxes are filled |
| `countdown` | `number` | `60` | Countdown duration in seconds |
| `sendButtonContent` / `resendButtonContent` / `countdownContent` | `ReactNode` | — | Same as `Input.SingleOtp` |

### Behavior
- Focus **auto-advances** to the next box after each digit.
- **Paste** auto-fills all boxes.
- **Backspace** on an empty box moves focus to the previous box.

---

## 11. Content Guidelines

### Labels
- Keep short and specific: "First name", "Email", "Password".
- Use `required={true}` for required fields — renders `*` marker automatically.
- Add "Optional" to `label` text for non-required fields — reduces form anxiety.
- Use a `?` tooltip node in `label` when a field needs clarification.

### Placeholder
- Use concise instructional text: "Enter text", "Enter your email".
- Never use placeholder as a substitute for a label — it disappears on focus.

### Error & Success Messages (`error` / `success` props)
- Be specific: "Input invalid characters" not just "Error".
- For real-time validation, render each condition as a line in `error` / `success`, updated via `onChange`.

### Character Counter (`maxLength`)
- Displayed automatically as `current/max`.
- Counter and border turn red on overflow — input is not blocked.
- Accurately counts emoji and CJK (Chinese, Japanese, Korean) characters.

---

## 12. Multi-language (RTL)

All input content requires **mirroring** for RTL languages (e.g., Arabic):

- Label and placeholder text align right.
- `addonBefore` moves to the right side; `addonAfter` moves to the left.
- `prefix` / `suffix` swap sides.
- `adjustType="button"` — `−` / `+` buttons swap positions.
- `allowClear` × icon moves to the left side.
- `password` eye icon moves to the left side.
- `Input.RangeNumber` — field order reverses (end field on left, start field on right).
- `Input.Textarea` resize handle moves to the bottom-left corner.
- OTP send/resend link moves to the left side.
- `error` / `success` messages align right.

---

## 13. Do / Don't

| ✅ Do | ❌ Don't | Reason |
|---|---|---|
| Choose the variant that matches the data type | Use plain `Input` for numeric or OTP entry | Each variant has purpose-built UX for its data type |
| Use `adjustType="button"` on web, `adjustType="arrow"` on mobile | Use the same `adjustType` on both platforms | Stepper styles are optimised for mouse vs touch |
| Set `maxLength` when a character limit exists | Silently block input at the limit | Users need to know why they can't type more |
| Implement real-time validation via `onChange` + `error`/`success` | Expect a built-in real-time validation prop | Validation logic is the caller's responsibility |
| Return `false` from `onSendCode` on API failure | Let the button stay in "Sending..." on failure | Stuck state prevents users from retrying |
| Use `masked={true}` on `Input.MultipleOtp` for sensitive codes | Show OTP digits in plain text if security matters | Masking prevents shoulder-surfing |
| Mirror all input elements for RTL languages | Reuse LTR layout for Arabic | Unmirrored inputs break RTL reading flow |
| Always provide `label` | Rely on placeholder as the only label | Placeholder disappears on focus, leaving users without context |

---

## 14. Decision Table

| Scenario | Variant | Key Props |
|---|---|---|
| Standard text field | `Input` | `label`, `placeholder` |
| Required field | Any | `required={true}` |
| Optional field | Any | Add "Optional" to `label` text |
| Field with character limit | `Input` or `Input.Textarea` | `maxLength={n}` |
| Password / sensitive value | `Input` | `password={true}` |
| Field with clear button | `Input` | `allowClear={true}` |
| Field with prefix icon/emoji | `Input` | `addonBefore={<Icon />}` |
| Field with inline unit symbol | `Input` | `prefix="$"` or `suffix="%"` |
| Real-time validation | `Input` | `onChange` + `error` / `success` |
| Single numeric value, web | `Input.Number` | `adjustType="button"` |
| Single numeric value, mobile | `Input.Number` | `adjustType="arrow"` |
| Numeric range (from / to) | `Input.RangeNumber` | `prefixes`, `suffixes`, `startMin/Max`, `endMin/Max` |
| Multi-line free text, fixed | `Input.Textarea` | `rows={n}` (default 3) |
| Multi-line free text, auto-grow | `Input.Textarea` | `autoSize={true}` |
| Multi-line free text, bounded | `Input.Textarea` | `autoSize={{ minRows, maxRows }}` |
| Multi-line free text, resizable | `Input.Textarea` | `resizable={true}` |
| OTP, single field | `Input.SingleOtp` | `onSendCode`, `countdown` |
| OTP, digit-by-digit | `Input.MultipleOtp` | `length`, `onSendCode`, `masked` |

---

## 15. Related Documents

- `ainvest-design-system/references/components/dialog.md`
- `ainvest-design-system/references/components/empty.md`
- `ainvest-design-system/SKILL.md`
