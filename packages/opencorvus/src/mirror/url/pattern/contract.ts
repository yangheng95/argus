/**
 * Contract generation: `ComponentCatalog` + `DesignTokenSystem` + page
 * sections → `ProjectScaffold`.
 *
 * Ported verbatim from `mirror/src/infra/pattern/contract.ts`. Every
 * structural decision (file paths, exports, imports, props interfaces,
 * component composition) is made here deterministically — the skill hands
 * this scaffold to the codegen agent as a hard contract the LLM cannot
 * deviate from.
 *
 * Depends on `url/compile::compileElement` for per-section IR snippets.
 * (This is the single cross-module function call we accept because
 * `compileElement` itself is a pure function — no state, no side effects.)
 *
 * Zero LLM, zero network.
 */

import { compileElement } from "../compile"
import type { ExtractedElement, ExtractedPage } from "../../ir/extracted-page"
import type {
  ComponentCatalog,
  ComponentPattern,
  DesignTokenSystem,
  ProjectScaffold,
  FileContract,
  SectionContract,
} from "../../ir/scaffold"
import { DEFAULT_REACT_SOURCE_LAYOUT } from "../../shared/scaffold-helpers"

const SHARED_THRESHOLD = 2
const MAX_IR_DEPTH = 8
const MAX_IR_CHARS = 20_000

// ─── Helpers ─────────────────────────────────────────────────────────────

function toKebab(str: string): string {
  return (
    str
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 40) || "section"
  )
}

function toPascal(str: string): string {
  return (
    str
      .split(/[-_\s]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join("") || "Component"
  )
}

function countElements(el: ExtractedElement): number {
  let count = 1
  if (el.children) {
    for (const c of el.children) count += countElements(c)
  }
  return count
}

function dedup(name: string, existing: Set<string>): string {
  if (!existing.has(name)) return name
  for (let i = 2; i < 100; i++) {
    const candidate = `${name}-${i}`
    if (!existing.has(candidate)) return candidate
  }
  return `${name}-${Date.now()}`
}

// ─── Section detection ───────────────────────────────────────────────────

interface RawSection {
  name: string
  role?: ExtractedElement["role"]
  bounds: { x: number; y: number; w: number; h: number }
  elements: ExtractedElement[]
  elementCount: number
}

function detectSections(page: ExtractedPage): RawSection[] {
  let topLevel = page.tree
  const MAX_UNWRAP = 10
  let unwrapCount = 0
  while (
    unwrapCount < MAX_UNWRAP &&
    topLevel.length === 1 &&
    topLevel[0].children &&
    topLevel[0].children.length >= 2
  ) {
    topLevel = topLevel[0].children
    unwrapCount++
  }

  const sections: RawSection[] = []

  for (let i = 0; i < topLevel.length; i++) {
    const el = topLevel[i]
    const elementCount = countElements(el)
    const name = el.role || `section-${i}`
    const bounds = el.bounds ?? { x: 0, y: 0, w: page.viewport.width, h: 100 }

    sections.push({ name, role: el.role, bounds, elements: [el], elementCount })
  }

  return splitOversizedSections(mergeTinySections(sections))
}

function mergeTinySections(sections: RawSection[]): RawSection[] {
  if (sections.length <= 1) return sections

  const result: RawSection[] = []
  let pending: RawSection | null = null

  for (const sec of sections) {
    const isTiny = sec.elementCount < 15 && sec.bounds.h < 150

    if (isTiny && pending) {
      pending.elements.push(...sec.elements)
      pending.elementCount += sec.elementCount
      pending.bounds = {
        x: Math.min(pending.bounds.x, sec.bounds.x),
        y: Math.min(pending.bounds.y, sec.bounds.y),
        w: Math.max(pending.bounds.w, sec.bounds.w),
        h: sec.bounds.y + sec.bounds.h - pending.bounds.y,
      }
    } else if (isTiny && result.length > 0) {
      const prev = result[result.length - 1]
      prev.elements.push(...sec.elements)
      prev.elementCount += sec.elementCount
      prev.bounds.h = sec.bounds.y + sec.bounds.h - prev.bounds.y
    } else {
      if (pending) result.push(pending)
      pending = { ...sec, elements: [...sec.elements] }
    }
  }
  if (pending) result.push(pending)

  return result
}

function splitOversizedSections(sections: RawSection[]): RawSection[] {
  const SPLIT_THRESHOLD = 250
  const result: RawSection[] = []

  for (const sec of sections) {
    if (sec.elementCount <= SPLIT_THRESHOLD) {
      result.push(sec)
      continue
    }

    let flatElements = [...sec.elements]
    for (let pass = 0; pass < 5; pass++) {
      let anyExpanded = false
      const next: ExtractedElement[] = []
      for (const el of flatElements) {
        if (countElements(el) <= SPLIT_THRESHOLD) {
          next.push(el)
          continue
        }
        let node = el
        for (let i = 0; i < 10; i++) {
          if (!node.children || node.children.length !== 1) break
          node = node.children[0]
        }
        if (node.children && node.children.length >= 2) {
          next.push(...node.children)
          anyExpanded = true
        } else {
          next.push(el)
        }
      }
      flatElements = next
      if (!anyExpanded) break
    }

    if (flatElements.length <= 1) {
      result.push(sec)
      continue
    }

    let current: RawSection | null = null
    let partIndex = 1

    for (const el of flatElements) {
      const elCount = countElements(el)

      if (current && current.elementCount + elCount > SPLIT_THRESHOLD) {
        result.push(current)
        current = null
        partIndex++
      }

      if (!current) {
        const elBounds = el.bounds ?? sec.bounds
        current = {
          name: `${sec.name}-${partIndex}`,
          role: sec.role,
          bounds: { ...elBounds },
          elements: [],
          elementCount: 0,
        }
      }

      current.elements.push(el)
      current.elementCount += elCount
      const elBounds = el.bounds ?? sec.bounds
      current.bounds = {
        x: Math.min(current.bounds.x, elBounds.x),
        y: Math.min(current.bounds.y, elBounds.y),
        w: Math.max(current.bounds.w, elBounds.w),
        h: elBounds.y + elBounds.h - current.bounds.y,
      }
    }

    if (current) {
      if (partIndex === 1) current.name = sec.name
      result.push(current)
    }
  }

  return result
}

// ─── Pattern → section mapping ───────────────────────────────────────────

function mapPatternsToSections(
  patterns: ComponentPattern[],
  sections: RawSection[],
): Map<string, Set<number>> {
  const patternSections = new Map<string, Set<number>>()

  for (const pattern of patterns) {
    const sectionIndices = new Set<number>()

    for (const instance of pattern.instances) {
      const instanceBounds = (instance.element as ExtractedElement).bounds
      if (!instanceBounds) continue

      const instanceMidY = instanceBounds.y + instanceBounds.h / 2
      for (let si = 0; si < sections.length; si++) {
        const sec = sections[si]
        if (instanceMidY >= sec.bounds.y && instanceMidY < sec.bounds.y + sec.bounds.h) {
          sectionIndices.add(si)
          break
        }
      }
    }

    patternSections.set(pattern.name, sectionIndices)
  }

  return patternSections
}

// ─── IR compilation ──────────────────────────────────────────────────────

function compilePatternIR(pattern: ComponentPattern, imageMap?: Record<string, string>): string {
  if (!pattern.templateElement) return ""
  const ir = compileElement(pattern.templateElement as ExtractedElement, 0, 4, imageMap)
  if (ir.length > 3000) return ir.slice(0, 3000) + "\n<!-- IR truncated -->"
  return ir
}

function generatePropsInterface(pattern: ComponentPattern): string {
  if (pattern.props.length === 0) return ""

  const lines = [`interface ${pattern.name}Props {`]
  for (const prop of pattern.props) {
    const tsType =
      prop.type === "string"
        ? "string"
        : prop.type === "image"
          ? "string"
          : prop.type === "href"
            ? "string"
            : "React.ReactNode"
    const optional = prop.required ? "" : "?"
    lines.push(`  ${prop.name}${optional}: ${tsType}`)
  }
  lines.push("}")
  return lines.join("\n")
}

// ─── Contract building ───────────────────────────────────────────────────

function buildSharedComponentContract(pattern: ComponentPattern, imageMap?: Record<string, string>): FileContract {
  const kebab = toKebab(pattern.name)
  return {
    filePath: `${DEFAULT_REACT_SOURCE_LAYOUT.sharedComponentsDir}/${kebab}.tsx`,
    exportName: pattern.name,
    isDefaultExport: false,
    propsInterface: generatePropsInterface(pattern),
    imports: {},
    patterns: [],
    sectionIR: compilePatternIR(pattern, imageMap),
  }
}

function buildSectionContract(
  section: RawSection,
  _sectionIndex: number,
  patternsInSection: ComponentPattern[],
  sharedPatternNames: Set<string>,
  usedNames: Set<string>,
  imageMap?: Record<string, string>,
): SectionContract {
  const kebab = dedup(toKebab(section.name), usedNames)
  usedNames.add(kebab)
  const pascal = toPascal(kebab)

  const imports: Record<string, string[]> = {}
  const patternNames: string[] = []

  for (const pattern of patternsInSection) {
    if (sharedPatternNames.has(pattern.name)) {
      const importPath = `./ui/${toKebab(pattern.name)}`
      imports[importPath] = [pattern.name]
      patternNames.push(pattern.name)
    }
  }

  let sectionIR = ""
  for (const el of section.elements) {
    const chunk = compileElement(el, 0, MAX_IR_DEPTH, imageMap) + "\n"
    if (sectionIR.length + chunk.length > MAX_IR_CHARS) {
      sectionIR += `<!-- IR truncated: ${section.elementCount} elements total -->\n`
      break
    }
    sectionIR += chunk
  }

  const collapsedDetails: Array<{ role: string; ir: string }> = []
  function findCollapsed(nodes: ExtractedElement[], currentDepth: number) {
    for (const n of nodes) {
      if (currentDepth >= MAX_IR_DEPTH && n.role && n.children && n.children.length > 0) {
        const detailIR = compileElement(n, 0, 6, imageMap)
        if (detailIR.length < 4000) {
          collapsedDetails.push({ role: n.role, ir: detailIR })
        }
      }
      if (n.children) findCollapsed(n.children, currentDepth + 1)
    }
  }
  findCollapsed(section.elements, 0)
  if (collapsedDetails.length > 0) {
    for (const detail of collapsedDetails.slice(0, 3)) {
      sectionIR += `\n<!-- Expanded detail for collapsed "${detail.role}" element:\n${detail.ir}\n-->\n`
    }
  }

  const sectionImages: Array<{ src: string; alt?: string }> = []
  function collectImages(nodes: ExtractedElement[]) {
    for (const n of nodes) {
      if (n.imageSrc) {
        const src = imageMap?.[n.imageSrc] ?? n.imageSrc
        sectionImages.push({ src, alt: n.imageAlt })
      }
      if (n.children) collectImages(n.children)
    }
  }
  collectImages(section.elements)
  if (sectionImages.length > 0) {
    const imgLines = sectionImages
      .slice(0, 30)
      .map((img, i) => `  ${i}: ${img.src}${img.alt ? ` (${img.alt})` : ""}`)
    sectionIR += `\n<!-- Section Images (${sectionImages.length} total) — use these paths as src:\n${imgLines.join(
      "\n",
    )}\n-->\n`
  }

  const sectionTexts: Array<{ tag: string; text: string }> = []
  const MAX_TEXT_CATALOG = 80
  const MAX_TEXT_CHARS = 5000
  let textCatalogChars = 0
  function collectTexts(nodes: ExtractedElement[]) {
    for (const n of nodes) {
      if (sectionTexts.length >= MAX_TEXT_CATALOG) return
      if (n.text && n.text.trim().length > 0) {
        const truncated = n.text.length > 120 ? n.text.slice(0, 120) + "..." : n.text
        const entry = `  ${n.role || n.tag}: ${truncated}`
        if (textCatalogChars + entry.length <= MAX_TEXT_CHARS) {
          sectionTexts.push({ tag: n.role || n.tag, text: truncated })
          textCatalogChars += entry.length
        }
      }
      if (n.children) collectTexts(n.children)
    }
  }
  collectTexts(section.elements)
  if (sectionTexts.length > 0) {
    const textLines = sectionTexts.map((t) => `  ${t.tag}: ${t.text}`)
    sectionIR += `\n<!-- Section Text (${sectionTexts.length} items) — use these EXACT texts, do NOT fabricate:\n${textLines.join(
      "\n",
    )}\n-->\n`
  }

  const localPatterns = patternsInSection.filter((p) => !sharedPatternNames.has(p.name))

  const allSubPatterns = patternsInSection.filter((p) => p.props.length > 0 && p.instances.length > 0)
  if (allSubPatterns.length > 0) {
    const usageLines: string[] = []
    for (const pattern of allSubPatterns) {
      const isLocal = !sharedPatternNames.has(pattern.name)
      const importPath = isLocal ? `./${kebab}/${toKebab(pattern.name)}` : `./ui/${toKebab(pattern.name)}`
      usageLines.push(`### ${pattern.name} (import from "${importPath}")`)
      const examples = pattern.instances.slice(0, 2)
      for (const inst of examples) {
        const propStr = pattern.props
          .map((prop) => {
            const val = inst.propValues[prop.name]
            if (val === undefined) return null
            const display = val.length > 80 ? val.slice(0, 77) + "..." : val
            return `${prop.name}="${display}"`
          })
          .filter(Boolean)
          .join(" ")
        usageLines.push(`  <${pattern.name} ${propStr} />`)
      }
    }
    sectionIR += `\n<!-- Sub-component prop usage — pass props EXACTLY as shown:\n${usageLines.join(
      "\n",
    )}\n-->\n`
  }

  for (const p of localPatterns) {
    const importPath = `./${kebab}/${toKebab(p.name)}`
    imports[importPath] = [p.name]
  }

  const mainFile: FileContract = {
    filePath: `${DEFAULT_REACT_SOURCE_LAYOUT.componentsDir}/${kebab}.tsx`,
    exportName: pascal,
    isDefaultExport: false,
    propsInterface: "",
    imports: {
      ...imports,
      "../design-tokens": ["COLORS", "FONTS"],
    },
    patterns: patternNames,
    sectionIR,
  }
  const subComponents: FileContract[] = localPatterns.map((p) => ({
    filePath: `${DEFAULT_REACT_SOURCE_LAYOUT.componentsDir}/${kebab}/${toKebab(p.name)}.tsx`,
    exportName: p.name,
    isDefaultExport: false,
    propsInterface: generatePropsInterface(p),
    imports: {},
    patterns: [],
    sectionIR: compilePatternIR(p, imageMap),
  }))

  return {
    name: kebab,
    role: section.role,
    bounds: section.bounds,
    file: mainFile,
    subComponents,
    elementCount: section.elementCount,
  }
}

function buildTokensFileContract(_tokens: DesignTokenSystem): FileContract {
  return {
    filePath: DEFAULT_REACT_SOURCE_LAYOUT.tokensFilePath,
    exportName: "COLORS",
    isDefaultExport: false,
    propsInterface: "",
    imports: {},
    patterns: [],
  }
}

function buildAppFileContract(sections: SectionContract[]): FileContract {
  const imports: Record<string, string[]> = {}
  for (const sec of sections) {
    const importPath = `./${sec.file.filePath.replace(`${DEFAULT_REACT_SOURCE_LAYOUT.sourceDir}/`, "").replace(/\.tsx$/, "")}`
    imports[importPath] = [sec.file.exportName]
  }

  return {
    filePath: DEFAULT_REACT_SOURCE_LAYOUT.appFilePath,
    exportName: "App",
    isDefaultExport: false,
    propsInterface: "",
    imports,
    patterns: [],
  }
}

// ─── Main entry point ────────────────────────────────────────────────────

/** Build a deterministic `ProjectScaffold` from analysis results. */
export function generateScaffold(
  page: ExtractedPage,
  catalog: ComponentCatalog,
  tokens: DesignTokenSystem,
): ProjectScaffold {
  const rawSections = detectSections(page)
  const patternSections = mapPatternsToSections(catalog.patterns, rawSections)

  const sharedPatternNames = new Set<string>()
  for (const [name, sections] of patternSections) {
    if (sections.size >= SHARED_THRESHOLD) {
      sharedPatternNames.add(name)
    }
  }

  const sharedComponents = catalog.patterns
    .filter((p) => sharedPatternNames.has(p.name))
    .map((p) => buildSharedComponentContract(p, page.assets.imageMap))

  const usedSectionNames = new Set<string>()
  const sections: SectionContract[] = rawSections.map((sec, i) => {
    const patternsInSection = catalog.patterns.filter((p) => {
      const secs = patternSections.get(p.name)
      return secs?.has(i)
    })
    return buildSectionContract(sec, i, patternsInSection, sharedPatternNames, usedSectionNames, page.assets.imageMap)
  })

  const tokensFile = buildTokensFileContract(tokens)
  const appFile = buildAppFileContract(sections)

  return {
    tokensFile,
    sharedComponents,
    sections,
    appFile,
    tokens,
    catalog,
  }
}
