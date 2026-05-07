/**
 * Pattern detection: find reusable component patterns in an `ExtractedPage`.
 *
 * Ported verbatim from `mirror/src/infra/pattern/detect.ts`. Six-step pipeline:
 *   1. fingerprint every subtree
 *   2. group by fingerprint (≥ 2 members = candidate)
 *   3. filter out trivially small and subsumed patterns
 *   4. cluster near-identical fingerprints into variant clusters
 *   5. infer props by diffing text/image/href across instances
 *   6. generate PascalCase names from role/tag/content hints
 *
 * Zero LLM. `ComponentCatalog` / `ComponentPattern` / `PatternInstance` /
 * `InferredProp` shapes synthesised in `ir/scaffold.ts` (mirror declares
 * none of them).
 */

import { fingerprintBounded, fingerprintSimilarity, countElements } from "./fingerprint"
import type { ExtractedElement, ExtractedPage } from "../../ir/extracted-page"
import type {
  ComponentPattern,
  ComponentCatalog,
  InferredProp,
  PatternInstance,
} from "../../ir/scaffold"

const MIN_INSTANCES = 2
const MIN_ELEMENTS = 2
const MAX_ELEMENTS = 80
const VARIANT_SIMILARITY_THRESHOLD = 0.75
const MAX_PATTERNS = 30

// ─── Step 1-2: Fingerprint & group ───────────────────────────────────────

interface FingerprintEntry {
  element: ExtractedElement
  fingerprint: string
  depth: number
  elementCount: number
  parentPath: string
}

function collectAllFingerprints(page: ExtractedPage): FingerprintEntry[] {
  const entries: FingerprintEntry[] = []

  function walk(el: ExtractedElement, depth: number, parentPath: string) {
    const fp = fingerprintBounded(el, 6)
    const path = `${parentPath}/${entries.length}`
    entries.push({ element: el, fingerprint: fp, depth, elementCount: countElements(el), parentPath: path })
    if (el.children) {
      for (let i = 0; i < el.children.length; i++) {
        walk(el.children[i], depth + 1, path)
      }
    }
  }

  for (let i = 0; i < page.tree.length; i++) {
    walk(page.tree[i], 0, `root-${i}`)
  }

  return entries
}

// ─── Step 3: Filter candidates ───────────────────────────────────────────

interface CandidateGroup {
  fingerprint: string
  entries: FingerprintEntry[]
}

function filterCandidates(groups: Map<string, FingerprintEntry[]>): CandidateGroup[] {
  const candidates: CandidateGroup[] = []

  for (const [fp, entries] of groups) {
    if (entries.length < MIN_INSTANCES) continue

    const elementCount = entries[0].elementCount
    if (elementCount < MIN_ELEMENTS) continue
    if (elementCount > MAX_ELEMENTS) continue

    if (fp.endsWith(":T") && !fp.includes("[")) continue

    candidates.push({ fingerprint: fp, entries })
  }

  const subsumed = new Set<string>()
  for (const a of candidates) {
    for (const b of candidates) {
      if (a === b) continue
      if (a.entries[0].elementCount >= b.entries[0].elementCount) continue
      const bPaths = new Set(b.entries.map((e) => e.parentPath))
      const allSubsumed = a.entries.every((ae) =>
        b.entries.some((be) => ae.parentPath.startsWith(be.parentPath + "/")),
      )
      if (allSubsumed && bPaths.size >= MIN_INSTANCES) {
        subsumed.add(a.fingerprint)
      }
    }
  }

  return candidates.filter((c) => !subsumed.has(c.fingerprint))
}

// ─── Step 4: Variant clustering ──────────────────────────────────────────

interface Cluster {
  fingerprints: string[]
  entries: FingerprintEntry[]
  similarity: number
}

function clusterVariants(candidates: CandidateGroup[]): Cluster[] {
  if (candidates.length === 0) return []

  const sorted = [...candidates].sort(
    (a, b) => b.entries.length * b.entries[0].elementCount - a.entries.length * a.entries[0].elementCount,
  )

  const clustered = new Set<string>()
  const clusters: Cluster[] = []

  for (const candidate of sorted) {
    if (clustered.has(candidate.fingerprint)) continue

    const cluster: Cluster = {
      fingerprints: [candidate.fingerprint],
      entries: [...candidate.entries],
      similarity: 1.0,
    }
    clustered.add(candidate.fingerprint)

    for (const other of sorted) {
      if (clustered.has(other.fingerprint)) continue

      const sim = fingerprintSimilarity(candidate.fingerprint, other.fingerprint)
      if (sim >= VARIANT_SIMILARITY_THRESHOLD) {
        cluster.fingerprints.push(other.fingerprint)
        cluster.entries.push(...other.entries)
        cluster.similarity = Math.min(cluster.similarity, sim)
        clustered.add(other.fingerprint)
      }
    }

    clusters.push(cluster)
  }

  return clusters
}

// ─── Step 5: Prop inference ──────────────────────────────────────────────

function collectTexts(el: ExtractedElement): string[] {
  const texts: string[] = []
  if (el.text) texts.push(el.text.slice(0, 100))
  if (el.children) {
    for (const c of el.children) texts.push(...collectTexts(c))
  }
  return texts
}

function collectImages(el: ExtractedElement): string[] {
  const images: string[] = []
  if (el.imageSrc) images.push(el.imageSrc)
  if (el.children) {
    for (const c of el.children) images.push(...collectImages(c))
  }
  return images
}

function collectHrefs(el: ExtractedElement): string[] {
  const hrefs: string[] = []
  if (el.href) hrefs.push(el.href)
  if (el.children) {
    for (const c of el.children) hrefs.push(...collectHrefs(c))
  }
  return hrefs
}

function inferProps(instances: ExtractedElement[]): InferredProp[] {
  if (instances.length < 2) return []
  const props: InferredProp[] = []

  const textValues = instances.map((el) => collectTexts(el))
  const imageValues = instances.map((el) => collectImages(el))
  const hrefValues = instances.map((el) => collectHrefs(el))

  const maxTextSlots = Math.max(...textValues.map((t) => t.length))
  for (let slot = 0; slot < maxTextSlots; slot++) {
    const values = textValues.map((t) => t[slot])
    const unique = new Set(values.filter(Boolean))
    if (unique.size > 1) {
      const name = slot === 0 ? "title" : slot === 1 ? "description" : `text${slot + 1}`
      props.push({
        name,
        type: "string",
        required: values.every(Boolean),
        samples: [...unique].slice(0, 3),
      })
    }
  }

  const maxImgSlots = Math.max(...imageValues.map((v) => v.length))
  for (let slot = 0; slot < maxImgSlots; slot++) {
    const values = imageValues.map((v) => v[slot])
    const normalizeForDedup = (v: string | undefined): string => {
      if (!v) return ""
      if (v.startsWith("data:")) {
        let hash = 0
        for (let i = 0; i < v.length; i++) {
          hash = ((hash << 5) - hash + v.charCodeAt(i)) | 0
        }
        return `data:hash:${hash}`
      }
      return v
    }
    const unique = new Set(values.map(normalizeForDedup).filter(Boolean))
    if (unique.size > 1) {
      const name = maxImgSlots === 1 ? "imageSrc" : `image${slot + 1}Src`
      props.push({
        name,
        type: "image",
        required: values.every(Boolean),
        samples: [...new Set(values.filter(Boolean))].slice(0, 2).map((v) => {
          if (v.startsWith("data:")) return v.slice(0, 30) + "...[base64]"
          try {
            return new URL(v).pathname.split("/").pop() || v.slice(0, 60)
          } catch {
            return v.slice(0, 60)
          }
        }),
      })
    }
  }

  const maxHrefSlots = Math.max(...hrefValues.map((v) => v.length))
  for (let slot = 0; slot < maxHrefSlots; slot++) {
    const values = hrefValues.map((v) => v[slot])
    const unique = new Set(values.filter(Boolean))
    if (unique.size > 1) {
      const name = maxHrefSlots === 1 ? "href" : `href${slot + 1}`
      props.push({
        name,
        type: "href",
        required: values.every(Boolean),
        samples: [...unique].slice(0, 3),
      })
    }
  }

  return props
}

// ─── Step 6: Naming ──────────────────────────────────────────────────────

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("")
}

function dedup(name: string, existing: Set<string>): string {
  if (!existing.has(name)) return name
  for (let i = 2; i < 100; i++) {
    const candidate = `${name}${i}`
    if (!existing.has(candidate)) return candidate
  }
  return `${name}${Date.now()}`
}

function generatePatternName(entries: FingerprintEntry[], existingNames: Set<string>): string {
  const el = entries[0].element

  if (el.role) {
    const name = toPascalCase(el.role)
    if (!existingNames.has(name)) return name
    return dedup(name, existingNames)
  }

  const childTexts = collectTexts(el)
  const hasImage = el.imageSrc || el.children?.some((c) => c.imageSrc)
  const hasHref = el.href || el.children?.some((c) => c.href)
  const childCount = el.children?.length ?? 0

  if (hasImage && childTexts.length > 0 && childCount >= 3) return dedup("Card", existingNames)
  if (hasHref && childTexts.length === 1 && childCount <= 2) return dedup("NavLink", existingNames)
  if (el.tag === "button" || el.tag === "a") return dedup("Button", existingNames)
  if (el.tag === "li") return dedup("ListItem", existingNames)
  if (hasImage && childTexts.length === 0) return dedup("MediaBlock", existingNames)

  const tag = toPascalCase(el.tag === "div" ? "block" : el.tag)
  return dedup(tag, existingNames)
}

// ─── Main entry point ────────────────────────────────────────────────────

function buildPropValues(el: ExtractedElement, props: InferredProp[]): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {}
  const texts = collectTexts(el)
  const images = collectImages(el)
  const hrefs = collectHrefs(el)

  for (const prop of props) {
    if (prop.type === "string") {
      const idx = prop.name === "title" ? 0 : prop.name === "description" ? 1 : parseInt(prop.name.replace(/\D/g, "")) - 1
      values[prop.name] = texts[idx]
    } else if (prop.type === "image") {
      const idx = prop.name === "imageSrc" ? 0 : parseInt(prop.name.replace(/\D/g, "")) - 1
      values[prop.name] = images[idx]
    } else if (prop.type === "href") {
      const idx = prop.name === "href" ? 0 : parseInt(prop.name.replace(/\D/g, "")) - 1
      values[prop.name] = hrefs[idx]
    }
  }

  return values
}

function markCovered(el: ExtractedElement, set: Set<ExtractedElement>) {
  set.add(el)
  if (el.children) {
    for (const c of el.children) markCovered(c, set)
  }
}

/** Detect reusable component patterns. Deterministic — same input, same output. */
export function detectPatterns(page: ExtractedPage): ComponentCatalog {
  const allEntries = collectAllFingerprints(page)
  const groups = new Map<string, FingerprintEntry[]>()
  for (const entry of allEntries) {
    const existing = groups.get(entry.fingerprint)
    if (existing) existing.push(entry)
    else groups.set(entry.fingerprint, [entry])
  }

  const candidates = filterCandidates(groups)
  const clusters = clusterVariants(candidates)

  const usedNames = new Set<string>()
  const patterns: ComponentPattern[] = []

  for (const cluster of clusters) {
    const name = generatePatternName(cluster.entries, usedNames)
    usedNames.add(name)

    const elements = cluster.entries.map((e) => e.element)
    const props = inferProps(elements)

    const instances: PatternInstance[] = cluster.entries.map((entry, i) => ({
      elementIndex: i,
      element: entry.element,
      propValues: buildPropValues(entry.element, props),
    }))

    patterns.push({
      name,
      fingerprint: cluster.fingerprints[0],
      instanceCount: cluster.entries.length,
      props,
      instances,
      templateElement: cluster.entries[0].element,
      structuralSimilarity: cluster.similarity,
    })
  }

  patterns.sort(
    (a, b) =>
      b.instanceCount * countElements(b.templateElement as ExtractedElement) -
      a.instanceCount * countElements(a.templateElement as ExtractedElement),
  )
  const finalPatterns = patterns.slice(0, MAX_PATTERNS)

  const coveredElements = new Set<ExtractedElement>()
  for (const p of finalPatterns) {
    for (const inst of p.instances) {
      markCovered(inst.element as ExtractedElement, coveredElements)
    }
  }

  const totalElements = allEntries.length

  return {
    patterns: finalPatterns,
    totalElements,
    coveredElements: coveredElements.size,
  }
}
