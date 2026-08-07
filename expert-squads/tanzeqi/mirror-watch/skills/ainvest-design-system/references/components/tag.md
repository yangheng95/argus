# Guidelines — Tag (标签)

## 0. Document Role

This document defines the design rules, visual attributes, and usage guidelines for the **Tag (标签)** component across App and Web platforms. Unlike other component files, Tag does not yet have a developed component — this file serves as the **authoritative design specification** and must be referenced whenever a tag element is generated. All size, color, padding, radius, stroke, and interaction values are defined here.

The component is divided into four categories based usage context: **通用标签**, **业务标签**, **文字标签**, **自定义标签**.

Related files:
- Design tokens: `ainvest-design-system/references/tokens/colors`, `ainvest-design-system/references/tokens/spacing`
- Color system: `ainvest-design-system/references/tokens/color.md`
- Radius system: `ainvest-design-system/references/tokens/radius.md`

---

## 1. Definition

Tag (标签) is a small label used for **marking, categorizing, and content recommendation** (进行标记、分类和内容推荐的小标签). Tags are non-form elements — they annotate content, surface attributes, or guide navigation. They are not buttons and must not replace interactive controls.

---

## 2. When to Use

Use Tag when:

- Marking a piece of content with a category, status, or attribute (e.g., HOT, Bullish, Live)
- Surfacing content recommendations or related topics inline
- Displaying stock/entity labels with price change data
- Identifying source, topic, or ticker inline within text
- Categorizing items in a list or card

---

## 3. When NOT to Use

| Situation | Use Instead |
|---|---|
| The action is a primary or secondary CTA | Button (Full Rounded / Rect) |
| The user needs to filter or select options | RadioGroup / CheckboxGroup / Filter Pill |
| The element triggers navigation to a new page as the primary action | Link / Button |
| The content is a status that changes interactively | Toggle / Badge |

---

## 4. Component Categories

The four tag categories map directly to different design intents and content types:

| Category | Chinese Name | Description |
|---|---|---|
| General Tag | 通用标签 | Marking, classification, atmosphere-building. Divided into 重要标签, 常规标签, 次要标签 |
| Business Tag | 业务标签 | Functional tags, recommendation tags, and stock tags for product-specific content |
| Text Tag | 文字标签 | Inline text-based labels with no fixed size; follows page typography |
| Custom Tag | 自定义标签 | Fully custom size, color, shape, and content for special highlight scenarios |

### 4.1 Default Tag Type — MANDATORY

> ⚠️ **Default rule (强制规则)**: When using the Tag component, **常规标签 (Regular Tag)** is the default and MUST be used unless explicitly specified otherwise. **严禁 (strictly forbidden)** to use any other tag type (重要标签, 次要标签, 业务标签, 文字标签, 自定义标签) without explicit specification of the scenario justifying that choice.

Rationale: 重要标签 has a strong visual weight that loses meaning if overused; 次要标签, 业务标签, 文字标签 and 自定义标签 each serve specific scenarios. Defaulting to 常规标签 keeps hierarchy intact and prevents visual noise.

When using a non-default tag type, the requesting spec MUST explicitly state both:
1. Which tag type is being used (e.g. "Use 重要标签")
2. Why that type is required (e.g. "to mark a live event with high attention priority")

Without both pieces of information, the non-default tag request is invalid; do not infer a tag type.

---

## 5. Design Attributes — General Tag (通用标签)

### 5.1 Sizes

General tags have **three sizes**: Small (小标签), Medium (中标签), Large (大标签).

| Size | Height | Usage |
|---|---|---|
| Small (小标签) | 16px | Weak presence in scene, mostly no interaction |
| Medium (中标签) | 24px | Moderate presence, often has marketing value |
| Large (大标签) | 28px | Strong presence, serves as key information anchor |

> Note: For custom tags, align height to 16px, 24px, or 28px as much as possible.

### 5.2 Padding, Radius & Typography

Exact values per size — do NOT approximate or interpolate between sizes.

| Size | Font | Font Weight | H-Padding (L+R) | V-Padding (T+B) | Radius | Icon / Arrow Size |
|---|---|---|---|---|---|---|
| Small (小标签) | 11px | Medium | 4px | 1px | 4px | 12 × 12px |
| Medium (中标签) | 12px | Medium | 8px | 4px | 6px | 16 × 16px |
| Large (大标签) | 14px | Medium | 12px | 5px | 6px | 18 × 18px |

Rules:
- Radius values are **fixed per size** — MUST NOT use `radius.pill` or `border-radius: 50%` for general tags
- Horizontal padding applies equally to left and right
- Vertical padding applies equally to top and bottom
- Icon and arrow must strictly follow the size defined above — do NOT scale them independently

### 5.3 Stroke (Border)

General tag stroke rules differ by platform and tag weight:

| Tag Type | Platform | Stroke Width |
|---|---|---|
| 重要标签 (Important) | App + Web | No stroke — solid filled |
| 常规标签 (Regular) — Small | Web | 1px |
| 常规标签 (Regular) — Small | App (Mobile) | 0.5px |
| 常规标签 (Regular) — Medium & Large | App + Web | 1px |
| 次要标签 (Secondary) | App + Web | No stroke — uses background fill only |

> 描边样式中的小标签区分Web端和移动端：Web端描边为1px，移动端为0.5px

### 5.4 Content Composition

Tag content is composed of up to three elements. **Text is mandatory; icon and arrow are optional and selected based on context.**

| Element | Required | Notes |
|---|---|---|
| Text (文本) | ✅ Yes | Always present |
| Icon (图标) | Optional | Left of text; use based on scene |
| Arrow / Chevron (箭头) | Optional | Right of text; indicates the tag is tappable/linked |

### 5.5 Tag Weight Variants (通用标签)

#### 重要标签 (Important Tag)
- Used for tags that require strong attention due to high hierarchy
- Use sparingly in regular functional pages — only use colors defined in the color spec for this type
- Solid filled background (no stroke)
- Common use cases: HOT, Bullish, live events, breaking news, featured content

> ⚠️ **Color priority for 重要标签 — MANDATORY (强制规则)**
>
> When using 重要标签, color must be selected following this priority order, and the choice must match the semantic context (使用时需要理解使用语境):
>
> 1. **Blue (`#165DFF`) — Default & most common (默认常用)**. Use for: state indication, atmosphere-building, general emphasis. This is the first choice for 重要标签 in most cases.
> 2. **Green (`#009B67`)**. Use for: low risk, safety, success, price up (涨幅), discount/promotion (降价促销).
> 3. **Red (`#FF381A`)**. Use for: live, price down (跌幅), warning, failure.
> 4. **Orange (`#FF6600`)**. Use for: emphasized important tags, HOT (热门), new arrivals (上新).
>
> **严禁 (strictly forbidden)** to use any color outside the four listed above (Blue / Green / Red / Orange) as 重要标签 color, unless explicitly specified otherwise. In particular, gray MUST NOT be used as 重要标签 under any circumstances.

#### 常规标签 (Regular Tag)
- **Default tag type** (默认使用)
- Used as a secondary-importance attribute of content
- Stroke border style (no solid fill background)
- Stroke: 1px Web / 0.5px App for small; 1px for medium and large
- **Color: gray stroke only (灰色描边)** — 常规标签 is always gray. It does NOT have colored variants under any circumstance.

#### 次要标签 (Secondary Tag)
- Same structural role as 常规标签 but used when content description density is high and visual simplification is needed
- Shallow background fill (底色为10%透明度, 与文字同色)
- No stroke
- Used to reduce visual prominence while still conveying attribute
- **Color: gray only (灰色)** — 次要标签 is always gray. It does NOT have colored variants under any circumstance.

### 5.6 Color Rules — General Tag (通用标签)

Color application must follow semantic rules. Color choice is **only relevant for 重要标签** — 常规标签 and 次要标签 are always gray (see §5.5).

> ⚠️ Price-related green and red MUST use platform-specific tokens — App and Web tokens are different and MUST NOT be swapped.
> ⚠️ If the required color is not defined in the table below, select from the color library first (优先选择颜色库中的颜色).

#### Visual Style by Weight

| Weight | Visual Style |
|---|---|
| 重要标签 | Solid filled background (Blue / Green / Red / Orange), white text |
| 常规标签 | Transparent background, gray stroke border, gray text |
| 次要标签 | Gray background at **10% opacity**, gray text, no stroke |

#### Color Semantic Table (重要标签 only)

The four semantic colors below are the **only allowed colors for 重要标签**. Each color carries a specific meaning and must be selected by matching the content's semantic context.

| Color | Hex Token | Platform | Semantic / Scene | Priority for 重要标签 |
|---|---|---|---|---|
| 蓝色 — Blue | `#165DFF` | App + Web | State indication, atmosphere-building, general emphasis | **1 — First-choice (default & most common)** |
| 绿色 — Green | `#009B67` | App + Web | Low risk, safety, success, price up (涨幅), discount/promotion (降价促销) | 2 — Second-choice |
| 红色 — Red | `#FF381A` | App + Web | Live, price down (跌幅), warning, failure | 3 — Third-choice |
| 橙色 — Orange | `#FF6600` | App + Web | Emphasized important tags, HOT (热门), new arrivals (上新) | 4 — Fourth-choice |
| Other colors | — | — | Any color outside the four above | ❌ MUST NOT use unless explicitly specified |

> **Gray** (`#F2F2F2` Light / `#292929` Dark) is reserved for 常规标签 and 次要标签 only. It MUST NOT be used as 重要标签.

#### Color Usage Rules
- **常规标签 / 次要标签**: always **gray** — no colored variants under any circumstance. Gray stroke for 常规标签, gray 10%-opacity background for 次要标签.
- **重要标签 color priority (强制)**: Blue (default & most common) → Green → Red → Orange. Choose by semantic context (see §5.5). MUST NOT use any color outside these four for 重要标签 unless explicitly specified.
- MUST NOT use **blue** for price-up/down semantics — use green (`#009B67`) or red (`#FF381A`)
- MUST NOT use **red** outside of: live, price down, warning, failure
- MUST NOT apply **gray** as a 重要标签 — gray is always weak/tertiary in hierarchy
- Gray MUST switch between `#F2F2F2` (Light mode) and `#292929` (Dark mode) — do NOT hardcode a single value

---

## 6. Design Attributes — Business Tag (业务标签)

Business tags are divided into **功能标签**, **推荐标签**, and **股票标签**.

### 6.1 Sizes

Business tags have **two sizes**: Small (小标签) and Large (大标签).

| Size | Height | L-Padding | R-Padding | V-Padding | Font | Font Weight | Icon Size | Logo Size | Usage |
|---|---|---|---|---|---|---|---|---|---|
| Small (小标签) | 28px | 4px | 8px | 4px | 12px | Medium | 12 × 12px | 20px circle | Used in combined card content; tag is NOT the primary recommended action |
| Large (大标签) | 36px | 4px | 12px | 4px | 14px | Medium | 14 × 14px | 28px circle | Used in strong-association content; tag IS the primary recommended action (default) |

### 6.2 Radius

- All business tags use **full rounded** radius — `radius.pill` (capsule shape)
- MUST NOT use rectangular or partially rounded corners on business tags

### 6.3 Stroke & Color

- **Stroke width**: 1px on all sizes
- **Stroke color**: `rgba(0, 0, 0, 0.10)` (`#000` at 10% opacity) — applied uniformly across all business tag sub-types (功能标签, 推荐标签, 股票标签)
- Stroke color does NOT change between Default and Hover/Click states — only the background color overlay changes per §9.3
- Dark mode: use `rgba(255, 255, 255, 0.10)` as the equivalent stroke color

### 6.4 Content Composition

- **功能标签 & 推荐标签**: content is composed of **图形/logo + 文本 + 箭头** (text is mandatory; icon and arrow are optional based on scene)
- **股票标签**: content is composed of **logo + 标的名 + 涨跌幅** (ticker name and price change are optional; logo can follow scene or type)

### 6.5 Image Alignment Rules (图片对齐方式)

| Alignment | When to Use |
|---|---|
| 同心圆 (concentric) | Image is important, the primary information subject of the tag (e.g. 功能标签, 股票标签) |
| 居中对齐 (centered) | Image is not critical; only adds richness and differentiation to tag content |

### 6.6 Interaction

Business tags are interactive by default. Hover and Click state color rules follow the global model in **§9**.

---

## 7. Design Attributes — Text Tag (文字标签)

Text tags do not define a fixed size or symbol — the font and style are chosen based on the page context.

Text tags are divided into two interactivity types. Interactability must be explicitly specified when using the component — see **§10** for the global interaction and state rules that apply to all tag types including text tags.

### 7.1 Non-Interactive Text Tag (不可交互标签)

| Sub-type | Description |
|---|---|
| 弱标签 | Suitable for auxiliary hint-type labels; weak visual presence |
| 强标签 | Used for auxiliary medium-emphasis hint labels; adds underline on hover (Web) |

### 7.2 Interactive Text Tag (可交互标签)

Default color for interactive text tags is **link color (blue, `#165DFF`)**, and supports custom color.

| Sub-type | Format | Description |
|---|---|---|
| 纯文本标签 | `Label` | Plain text; does not emphasize its attribute, just a clickable text label |
| 话题标签 | `#Label` | Content represents a topic attribute |
| 标的标签 | `$Label` | Content represents a ticker / asset attribute |

> Hover and Click state color changes follow the global rule in **§10.3** — hover deepens `#000` 5% (Web only), click deepens `#000` 10%.

---

## 8. Design Attributes — Custom Tag (自定义标签)

Custom tags do not define fixed size, color, shape, or content — they can be fully customized based on the scene.

**Usage contexts**: live streaming, marketing campaigns, honor/achievement systems, social features, and other scenes requiring strong visual prominence.

**Usage principles:**
- Avoid using irregular/异形 tag shapes as much as possible
- Align size to standard general tag heights: **16px, 24px, or 28px**
- Align color choices to the standard tag color recommendations as much as possible

---

## 9. Interaction & States

### 9.1 Global Interaction Model (Applies to ALL Tag Types)

When using any tag component, **interactability must be explicitly specified**. Interactive tag is a special case — it is NOT the default.

| Property | Non-Interactive (Default) | Interactive |
|---|---|---|
| Definition | Tag is purely informational; no click action | Tag triggers navigation, filtering, or an action on click |
| Default state | ✅ | ✅ |
| Hover state | ❌ Not applicable | ✅ Web only — color deepens `#000` 5% |
| Click state | ❌ Not applicable | ✅ App + Web — color deepens `#000` 10% |
| Cursor | Arrow | Pointer (小手) |
| Visual affordance | No arrow needed | Add arrow (>) to signal interactability |

### 9.2 Platform Scope

- **App:** Default and Click states only — Hover MUST NOT be implemented on any tag type
- **Web:** Default, Hover, and Click states

### 9.3 State Color Rules (Interactive Tags — All Types)

| State | Platform | Color Change |
|---|---|---|
| Default | App + Web | No change — base tag color |
| Hover | Web only | Tag color deepens `#000` 5% overlay |
| Click | App + Web | Tag color deepens `#000` 10% overlay |

These rules apply uniformly across 通用标签, 业务标签, 文字标签, and 自定义标签. There are no per-type overrides.

> ⚠️ Non-interactive tags have **only** a Default state. Do NOT implement Hover or Click on non-interactive tags under any circumstance.

---

## 10. Platform Differences

| Attribute | App (Mobile) | Web |
|---|---|---|
| Hover state | ❌ Not available | ✅ Available |
| Small tag stroke width (常规标签) | 0.5px | 1px |
| Medium / Large tag stroke | 1px | 1px |
| Green token | `#009B67` (same on both platforms) | `#009B67` (same on both platforms) |
| Red token | `#FF381A` (same on both platforms) | `#FF381A` (same on both platforms) |
| Gray (Light / Dark) | `#F2F2F2` / `#292929` | `#F2F2F2` / `#292929` |
| Multilingual mirror (Arabic) | ✅ Required — R→L reading order | ✅ Required |

---

## 11. Multilingual Adaptation (多语言适配)

1. **General multilingual**: select maximum tag width based on scene; if text overflows, truncate with `"…"`. Minimum font size when reducing: **11px**
2. **Arabic (RTL)**: reading order is R→L; content combination layout must be **mirrored** when adapting to Arabic, as shown:

| Language | Layout |
|---|---|
| Default (LTR) | `[icon] Label >` / `TSLA +1.21%` / `✦ Opportunity:18 Risk:24 >` |
| Arabic (RTL) | `< Label [icon]` / `+1.21% TSLA` / `< Risk:24 Opportunity:18 ✦` |

---

## 12. Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| **Default to 常规标签** when using the Tag component unless another type is explicitly specified | Use 重要标签, 次要标签, 业务标签, 文字标签, or 自定义标签 as the default without explicit specification |
| **Always specify** whether a tag is interactive or non-interactive when using the component | Leave interactability unspecified — non-interactive is the default and interactive is the special case |
| Use **Hover + Click** states only on interactive tags (Web: both; App: Click only) | Add Hover or Click states to non-interactive tags |
| Use **color deepens `#000` 5%** for Hover, **`#000` 10%** for Click on all interactive tags | Use arbitrary custom hover/click colors instead of the defined overlay values |
| Use **重要标签** only for genuinely high-priority content (HOT, live, featured) | Use 重要标签 as a default label style — it loses meaning if overused |
| Use **常规标签** as the default tag type | Use 重要标签 or custom styles as a default |
| For **重要标签**, choose color by priority: Blue (default) → Green → Red → Orange, matched to the semantic context | Use any color outside Blue / Green / Red / Orange as 重要标签 (especially gray or arbitrary brand colors) |
| Apply **0.5px stroke on App small tags**, 1px on Web small tags | Use 1px stroke uniformly across both platforms for small tags |
| Add an **arrow (>)** to indicate the tag is interactive / tappable | Use an interactive tag with no visual affordance |
| Truncate with `"…"` and reduce font to minimum **11px** for long multilingual text | Let tag text overflow its container |
| Mirror tag content layout for **Arabic (RTL)** | Leave LTR layout unchanged for Arabic builds |
| For 次要标签: use **gray at 10% opacity** as background (always gray, no colored variants) | Use a custom background color or any non-gray color for 次要标签 |
| Keep custom tag sizes aligned to **16px / 24px / 28px** heights | Use arbitrary heights for custom tags |
| Avoid irregular shapes (异形标签) in custom tags | Use non-pill or non-rectangular shapes without strong justification |

---

## 13. Decision Table

| Scenario | Category | Weight / Sub-type | Size | Color Guidance | Arrow |
|---|---|---|---|---|---|
| Breaking news label, HOT, live event | 通用标签 | 重要标签 | Medium or Large | Blue (default) → Green / Red / Orange per semantic context | Optional |
| Default content attribute tag | 通用标签 | 常规标签 | Small or Medium | Gray (always — no colored variants) | Optional |
| High-density content, attribute needs lower visual weight | 通用标签 | 次要标签 | Small | Gray, 10% opacity background (always — no colored variants) | Optional |
| Function/feature tag in a card | 业务标签 | 功能标签 | Small (in card) / Large (strong CTA) | Gray base | Yes |
| Content recommendation tag | 业务标签 | 推荐标签 | Large (default) | Gray base | No |
| Stock ticker with price change | 业务标签 | 股票标签 | Large (default) | Green/Red per platform token | Optional |
| Inline source attribution (e.g. WSJ) | 文字标签 | 弱标签 | Follows page typography | Inherit | No |
| Inline post label (e.g. Post +1.71%) | 文字标签 | 强标签 | Follows page typography | Inherit | No |
| Inline clickable news channel | 文字标签 | 纯文本标签 | Follows page typography | Blue (link) | No |
| Inline topic hashtag `#Topic` | 文字标签 | 话题标签 | Follows page typography | Blue (link) | No |
| Inline ticker cashtag `$TSLA` | 文字标签 | 标的标签 | Follows page typography | Blue (link) | No |
| Live / marketing / honor badge | 自定义标签 | Custom | Align to 16/24/28px | Per scene | Optional |
| Arabic RTL interface | Any | Any | Same as LTR | Same | Mirror layout |

---

## 14. Related Documents

- RadioGroup: `ainvest-design-system/references/components/radio-group.md`
- CheckboxGroup: `ainvest-design-system/references/components/checkbox-group.md`
- Button: `ainvest-design-system/references/components/button.md`
- Color: `ainvest-design-system/references/tokens/color.md`
- Radius: `ainvest-design-system/references/tokens/radius.md`
