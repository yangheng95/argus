/**
 * Deterministic design-language extraction from an ExtractedPage.
 *
 * Ported from mirror/src/infra/design-language-extract.ts. Produces an
 * abstract design spec (colour system, typography scale, spacing, layout,
 * component styling) suitable for template/plan context injection — WITHOUT
 * copying the source page's DOM or content layout.
 *
 * This module is structurally typed: any object shaped like
 * `{ url: string; tree: Array<{ styles: StyleBag; children?: [...] }> }`
 * can be consumed. The full Zod `ExtractedPage` schema (Phase B) will
 * satisfy the same shape, so no changes are needed when it lands.
 *
 * Zero LLM, zero network, <10 ms for typical pages.
 */

// ─── Structural input shapes ─────────────────────────────────────────────

/** Subset of computed-style fields we consume (`ExtractedStyles` superset). */
export interface StyleBag {
  backgroundColor?: string
  color?: string
  border?: string
  fontSize?: string
  fontWeight?: string
  lineHeight?: string
  fontFamily?: string
  gap?: string
  padding?: string
  margin?: string
  borderRadius?: string
  boxShadow?: string
  display?: string
  flexDirection?: string
  gridTemplateColumns?: string
}

export interface ElementLike {
  styles: StyleBag
  children?: ElementLike[]
}

export interface PageLike {
  url: string
  tree: ElementLike[]
}

// ─── Output schema ────────────────────────────────────────────────────────

export interface DesignLanguage {
  colors: {
    backgrounds: ColorEntry[]
    text: ColorEntry[]
    borders: ColorEntry[]
    accents: ColorEntry[]
  }
  typography: TypographyEntry[]
  fontFamilies: string[]
  spacing: SpacingEntry[]
  layoutPatterns: LayoutPattern[]
  componentStyle: ComponentStyle
  sourceUrl: string
}

export interface ColorEntry {
  value: string
  frequency: number
}

export interface TypographyEntry {
  role: string
  fontSize: string
  fontWeight: string
  lineHeight?: string
}

export interface SpacingEntry {
  value: string
  frequency: number
}

export interface LayoutPattern {
  type: "flex-row" | "flex-col" | "grid" | "block"
  frequency: number
  details?: string
}

export interface ComponentStyle {
  borderRadius: string[]
  boxShadow: string[]
  borderStyles: string[]
}

// ─── Colour helpers ───────────────────────────────────────────────────────

function parseRgb(color: string): { r: number; g: number; b: number } | null {
  const rgbMatch = color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/)
  if (rgbMatch) {
    return { r: +(rgbMatch[1] ?? 0), g: +(rgbMatch[2] ?? 0), b: +(rgbMatch[3] ?? 0) }
  }
  const hexMatch = color.match(/^#([0-9a-f]{6})$/i)
  if (hexMatch && hexMatch[1]) {
    const hex = hexMatch[1]
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    }
  }
  return null
}

function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")
}

function normalizeColor(color: string): string {
  const rgb = parseRgb(color)
  if (!rgb) return color
  return rgbToHex(rgb.r, rgb.g, rgb.b)
}

// ─── Generic helpers ──────────────────────────────────────────────────────

function walkElements(tree: ElementLike[], visitor: (el: ElementLike) => void): void {
  for (const el of tree) {
    visitor(el)
    if (el.children) walkElements(el.children, visitor)
  }
}

function topN<T>(counter: Map<T, number>, n: number): Array<{ value: T; frequency: number }> {
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, frequency]) => ({ value, frequency }))
}

// ─── Extraction ───────────────────────────────────────────────────────────

export function extractDesignLanguage(page: PageLike): DesignLanguage {
  const bgColors = new Map<string, number>()
  const textColors = new Map<string, number>()
  const borderColors = new Map<string, number>()
  const fontSizes = new Map<string, number>()
  const fontWeights = new Map<string, number>()
  const lineHeights = new Map<string, number>()
  const fontFamilyCounter = new Map<string, number>()
  const gapValues = new Map<string, number>()
  const paddingValues = new Map<string, number>()
  const marginValues = new Map<string, number>()
  const borderRadii = new Map<string, number>()
  const boxShadows = new Map<string, number>()
  const borderStyles = new Map<string, number>()
  const layoutTypes = new Map<string, number>()
  const gridDetails = new Map<string, number>()

  const SKIP_COLORS = new Set(["rgba(0, 0, 0, 0)", "transparent", "inherit", "initial", "unset", ""])
  const SKIP_VALUES = new Set(["", "none", "normal", "auto", "0px", "0", "inherit", "initial", "unset"])

  function incr<T>(map: Map<T, number>, key: T | undefined): void {
    if (key === undefined) return
    map.set(key, (map.get(key) ?? 0) + 1)
  }

  walkElements(page.tree, (el) => {
    const s = el.styles

    if (s.backgroundColor && !SKIP_COLORS.has(s.backgroundColor)) incr(bgColors, s.backgroundColor)
    if (s.color && !SKIP_COLORS.has(s.color)) incr(textColors, s.color)

    if (s.border && !SKIP_VALUES.has(s.border)) {
      incr(borderStyles, s.border)
      const colorMatch = s.border.match(/#[0-9a-f]{3,8}|rgba?\([^)]+\)/i)
      if (colorMatch) incr(borderColors, colorMatch[0])
    }

    if (s.fontSize && !SKIP_VALUES.has(s.fontSize)) incr(fontSizes, s.fontSize)
    if (s.fontWeight && !SKIP_VALUES.has(s.fontWeight)) incr(fontWeights, s.fontWeight)
    if (s.lineHeight && !SKIP_VALUES.has(s.lineHeight)) incr(lineHeights, s.lineHeight)
    if (s.fontFamily) {
      const primary = (s.fontFamily.split(",")[0] ?? "").replace(/['"]/g, "").trim()
      if (primary) incr(fontFamilyCounter, primary)
    }

    if (s.gap && !SKIP_VALUES.has(s.gap)) incr(gapValues, s.gap)
    if (s.padding && !SKIP_VALUES.has(s.padding) && !/^0px(\s+0px)*$/.test(s.padding)) {
      incr(paddingValues, s.padding)
    }
    if (s.margin && !SKIP_VALUES.has(s.margin) && !/^0px(\s+0px)*$/.test(s.margin)) {
      incr(marginValues, s.margin)
    }

    if (s.borderRadius && !SKIP_VALUES.has(s.borderRadius)) incr(borderRadii, s.borderRadius)
    if (s.boxShadow && !SKIP_VALUES.has(s.boxShadow)) incr(boxShadows, s.boxShadow)

    const display = s.display
    if (display === "flex" || display === "inline-flex") {
      const dir = s.flexDirection
      incr(layoutTypes, dir === "column" || dir === "column-reverse" ? "flex-col" : "flex-row")
    } else if (display === "grid" || display === "inline-grid") {
      incr(layoutTypes, "grid")
      if (s.gridTemplateColumns) incr(gridDetails, s.gridTemplateColumns)
    }
  })

  // Categorise background colours by saturation+luminance → accent vs neutral.
  const allBgEntries = topN(bgColors, 50)
  const accentColors: ColorEntry[] = []
  const plainBgColors: ColorEntry[] = []

  for (const entry of allBgEntries) {
    const rgb = parseRgb(entry.value)
    if (!rgb) {
      plainBgColors.push({ value: entry.value, frequency: entry.frequency })
      continue
    }
    const lum = luminance(rgb.r, rgb.g, rgb.b)
    const max = Math.max(rgb.r, rgb.g, rgb.b)
    const min = Math.min(rgb.r, rgb.g, rgb.b)
    const saturation = max === 0 ? 0 : (max - min) / max
    if (saturation > 0.3 && lum > 0.1 && lum < 0.85) {
      accentColors.push({ value: normalizeColor(entry.value), frequency: entry.frequency })
    } else {
      plainBgColors.push({ value: normalizeColor(entry.value), frequency: entry.frequency })
    }
  }

  function categorizeColors(counter: Map<string, number>, limit: number): ColorEntry[] {
    return topN(counter, limit).map(({ value, frequency }) => ({
      value: normalizeColor(value),
      frequency,
    }))
  }

  const colors = {
    backgrounds: plainBgColors.slice(0, 8),
    text: categorizeColors(textColors, 8),
    borders: categorizeColors(borderColors, 5),
    accents: accentColors.slice(0, 5),
  }

  // Typography scale: top sizes sorted by px desc, first 3 are heading weight.
  const sizeEntries = topN(fontSizes, 10)
  const sorted = sizeEntries
    .map((e) => ({ ...e, px: parseFloat(e.value) || 0 }))
    .filter((e) => e.px > 0)
    .sort((a, b) => b.px - a.px)

  const roles = ["h1", "h2", "h3", "h4", "body", "body-sm", "caption", "button", "label", "overline"]
  const typography: TypographyEntry[] = sorted.slice(0, roles.length).map((entry, i) => {
    const weight = topN(fontWeights, 1)[0]?.value ?? "400"
    const lh = topN(lineHeights, 1)[0]?.value
    return {
      role: roles[i] ?? `text-${i}`,
      fontSize: entry.value,
      fontWeight: i < 3 ? "700" : i < 4 ? "600" : weight,
      lineHeight: lh,
    }
  })

  const fontFamilies = topN(fontFamilyCounter, 4).map((e) => e.value)

  // Merge gap/padding/margin into one spacing scale.
  const allSpacing = new Map<string, number>()
  for (const [v, c] of gapValues) allSpacing.set(v, (allSpacing.get(v) ?? 0) + c)
  for (const [v, c] of paddingValues) allSpacing.set(v, (allSpacing.get(v) ?? 0) + c)
  for (const [v, c] of marginValues) allSpacing.set(v, (allSpacing.get(v) ?? 0) + c)

  const spacing = topN(allSpacing, 12).map(({ value, frequency }) => ({ value, frequency }))

  const layoutPatterns: LayoutPattern[] = topN(layoutTypes, 4).map(({ value, frequency }) => {
    const type = value as LayoutPattern["type"]
    let details: string | undefined
    if (type === "grid") {
      const topGrid = topN(gridDetails, 2)
      if (topGrid.length > 0) details = topGrid.map((g) => g.value).join("; ")
    }
    return { type, frequency, details }
  })

  const componentStyle: ComponentStyle = {
    borderRadius: topN(borderRadii, 5).map((e) => e.value),
    boxShadow: topN(boxShadows, 3).map((e) => e.value),
    borderStyles: topN(borderStyles, 3).map((e) => e.value),
  }

  return {
    colors,
    typography,
    fontFamilies,
    spacing,
    layoutPatterns,
    componentStyle,
    sourceUrl: page.url,
  }
}

// ─── Markdown rendering ───────────────────────────────────────────────────

/** Render a DesignLanguage as a Markdown spec for template injection. */
export function renderDesignLanguageMarkdown(dl: DesignLanguage): string {
  const lines: string[] = []

  lines.push("## 设计语言规范（基于同赛道竞品提炼）")
  lines.push("")
  lines.push("> 以下设计规范从同赛道竞品页面中提炼而来，代表行业设计共性。")
  lines.push("> 请作为设计 Token 和视觉风格的参考基准，结合自身产品特色灵活运用。")
  lines.push("")

  lines.push("### 色彩体系")
  if (dl.colors.accents.length > 0) {
    lines.push("**强调色/品牌色:**")
    for (const c of dl.colors.accents) lines.push(`- ${c.value}`)
  }
  if (dl.colors.backgrounds.length > 0) {
    lines.push("**背景色:**")
    for (const c of dl.colors.backgrounds.slice(0, 5)) lines.push(`- ${c.value}`)
  }
  if (dl.colors.text.length > 0) {
    lines.push("**文字色:**")
    for (const c of dl.colors.text.slice(0, 5)) lines.push(`- ${c.value}`)
  }
  if (dl.colors.borders.length > 0) {
    lines.push("**边框色:**")
    for (const c of dl.colors.borders.slice(0, 3)) lines.push(`- ${c.value}`)
  }
  lines.push("")

  if (dl.typography.length > 0) {
    lines.push("### 字体排版阶梯")
    if (dl.fontFamilies.length > 0) {
      lines.push(`**字体族:** ${dl.fontFamilies.join(", ")}`)
    }
    lines.push("")
    lines.push("| 角色 | 字号 | 字重 | 行高 |")
    lines.push("|------|------|------|------|")
    for (const t of dl.typography) {
      lines.push(`| ${t.role} | ${t.fontSize} | ${t.fontWeight} | ${t.lineHeight ?? "-"} |`)
    }
    lines.push("")
  }

  if (dl.spacing.length > 0) {
    lines.push("### 间距系统")
    lines.push(`常用间距值: ${dl.spacing.map((s) => s.value).join(", ")}`)
    lines.push("")
  }

  if (dl.layoutPatterns.length > 0) {
    lines.push("### 布局模式偏好")
    for (const lp of dl.layoutPatterns) {
      const detail = lp.details ? ` (${lp.details})` : ""
      lines.push(`- **${lp.type}**: 使用 ${lp.frequency} 次${detail}`)
    }
    lines.push("")
  }

  const cs = dl.componentStyle
  if (cs.borderRadius.length > 0 || cs.boxShadow.length > 0) {
    lines.push("### 组件造型风格")
    if (cs.borderRadius.length > 0) {
      lines.push(`**圆角:** ${cs.borderRadius.join(", ")}`)
    }
    if (cs.boxShadow.length > 0) {
      lines.push(`**阴影:** ${cs.boxShadow.slice(0, 2).join("; ")}`)
    }
    if (cs.borderStyles.length > 0) {
      lines.push(`**边框:** ${cs.borderStyles.slice(0, 2).join("; ")}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}
