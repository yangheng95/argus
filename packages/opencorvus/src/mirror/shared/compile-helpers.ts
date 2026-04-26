/**
 * Compile helpers shared across all `mirror/*` IR → XML compilers.
 *
 * Originally folded into `mirror/figma/compile.ts` (see commit history of that
 * file). Promoted to `shared/` when `image2code` joined `figma2code` /
 * `url2code` as a third compile target — same XML dialect, same attribute
 * layout, same text-style serialisation. Single source per rule 22.
 *
 * No cross-module imports inside `mirror/` — these helpers depend only on
 * native types so `figma/`, `image/`, and any future `<source>/compile.ts`
 * can pull them without violating the README's `figma ⊥ url ⊥ visual`
 * orthogonality (this is `shared/`, the explicitly-allowed dependency edge).
 */

export interface TextStyleInput {
  font?: string
  size?: number
  weight?: number
  color?: string
  lineHeight?: number | string
  letterSpacing?: number | string
  align?: string
  decoration?: string
  textCase?: string
}

export interface CompileTextStyleOptions {
  suppressDefaultAlign?: boolean
  lineHeightUnit?: string
}

export function joinAttrs(...parts: string[]): string {
  return parts.filter(Boolean).join(" ")
}

export function compileSizeAttr(bounds: { w: number; h: number } | undefined): string {
  if (!bounds) return ""
  return `size="${bounds.w}x${bounds.h}"`
}

export function compileTextStyle(input: TextStyleInput, options?: CompileTextStyleOptions): string {
  const parts: string[] = []
  if (input.font) parts.push(input.font)
  if (input.size) parts.push(`${input.size}px`)
  if (input.weight) parts.push(String(input.weight))
  if (input.color) parts.push(input.color)
  if (input.lineHeight !== undefined) {
    const unit = options?.lineHeightUnit ?? ""
    parts.push(`lh:${input.lineHeight}${unit}`)
  }
  if (input.letterSpacing) parts.push(`ls:${input.letterSpacing}`)
  if (input.align) {
    if (!(options?.suppressDefaultAlign && input.align === "left")) {
      parts.push(`align:${input.align}`)
    }
  }
  if (input.decoration) parts.push(`decoration:${input.decoration}`)
  if (input.textCase) parts.push(`case:${input.textCase}`)
  return parts.join(" ")
}
