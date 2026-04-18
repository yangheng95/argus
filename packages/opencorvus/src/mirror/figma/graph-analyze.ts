/**
 * Figma graph-structure analysis (zero LLM, deterministic).
 *
 * Detects three naming conventions specific to the mirror team's Figma files:
 *   - Connection groups (`连接线组-N/…`): Tab → content navigation edges
 *   - Annotation groups (`基础标注组-N/…`, `源标注组-N/…`): interaction specs
 *   - `@reuse@library/component:variant` references: external component refs
 *
 * Produces a cleaned `CompressedDesign` (graph markers removed, annotations
 * injected into target nodes) plus a `PageGraph` describing the structure.
 * Inputs without graph markers pass through unchanged, `hasGraphStructure:false`.
 *
 * Ported from `mirror/src/service/figma-graph-analyze.ts`. This module is
 * atomic — it consumes and produces `CompressedDesign`; it does not call
 * `figma/fetch-tree` or any other mirror module.
 */

import { Log } from "@/util/log"

import type {
  CompressedDesign,
  CompressedNode,
  ConnectionEdge,
  AnnotationEntry,
  ReuseReference,
  GraphPage,
  PageGraph,
} from "../ir/compressed-design"

const log = Log.create({ service: "mirror.figma.graph-analyze" })

// ─── Naming-convention regexes ───────────────────────────────────────────

export const CONNECTION_RE = /^连接线组-(\d+)\/(.+?)\/([0-9:]+)\s*->\s*(.+?)\/([0-9:]+)$/
export const ANNOTATION_RE = /^(基础标注组|源标注组)-(\d+)\/(.+?)\/([0-9:]+)$/
export const REUSE_RE = /@reuse@([^/]+)\/([^:]+):?(.*)/

// ─── Boundary types ──────────────────────────────────────────────────────

export interface AnalyzeGraphResult {
  design: CompressedDesign
  pageGraph: PageGraph
}

// ─── Helpers ─────────────────────────────────────────────────────────────

export function collectTextSpecs(node: CompressedNode): string[] {
  const specs: string[] = []
  if (node.text?.content) {
    const trimmed = node.text.content.trim()
    if (trimmed) specs.push(trimmed)
  }
  if (node.children) {
    for (const child of node.children) {
      specs.push(...collectTextSpecs(child))
    }
  }
  return specs
}

export function collectReuseRefs(node: CompressedNode): ReuseReference[] {
  const refs: ReuseReference[] = []
  const match = REUSE_RE.exec(node.name)
  if (match) {
    refs.push({
      raw: node.name,
      library: match[1],
      component: match[2],
      variant: match[3] || "",
      nodeId: node.id,
    })
  }
  if (node.children) {
    for (const child of node.children) {
      refs.push(...collectReuseRefs(child))
    }
  }
  return refs
}

function findNodeById(nodes: CompressedNode[], nodeId: string): CompressedNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node
    if (node.children) {
      const found = findNodeById(node.children, nodeId)
      if (found) return found
    }
  }
  return undefined
}

export function toSlug(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-|-$/g, "") || "page"
  )
}

export function toStubName(library: string, component: string): string {
  const parts = [library, component]
  return (
    parts
      .map((part) =>
        part
          .replace(/[^a-zA-Z0-9]+/g, " ")
          .trim()
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(""),
      )
      .join("") || "ExternalComponent"
  )
}

function cloneDesign(design: CompressedDesign): CompressedDesign {
  return JSON.parse(JSON.stringify(design))
}

function injectAnnotation(node: CompressedNode, annotation: string): void {
  if (!node.annotations) node.annotations = []
  if (!node.annotations.includes(annotation)) node.annotations.push(annotation)
}

function isGraphNode(name: string, graphNodeNames: Set<string>): boolean {
  if (graphNodeNames.has(name)) return true
  return CONNECTION_RE.test(name) || ANNOTATION_RE.test(name)
}

function findContentNode(design: CompressedDesign, nodeId: string): CompressedNode | undefined {
  for (const page of design.pages) {
    for (const frame of page.frames) {
      if (frame.id === nodeId) return frame
      const found = findNodeById(frame.children ?? [], nodeId)
      if (found) return found
    }
  }
  return undefined
}

function nodeContainsId(node: CompressedNode, nodeId: string): boolean {
  if (node.id === nodeId) return true
  if (node.children) {
    for (const child of node.children) {
      if (nodeContainsId(child, nodeId)) return true
    }
  }
  return false
}

// ─── Core algorithm ──────────────────────────────────────────────────────

function scanForPatterns(
  node: CompressedNode,
  connections: ConnectionEdge[],
  annotations: AnnotationEntry[],
  graphNodeNames: Set<string>,
): void {
  const connMatch = CONNECTION_RE.exec(node.name)
  if (connMatch) {
    connections.push({
      groupId: parseInt(connMatch[1], 10),
      source: { name: connMatch[2], nodeId: connMatch[3] },
      target: { name: connMatch[4], nodeId: connMatch[5] },
    })
    graphNodeNames.add(node.name)
    return
  }

  const annMatch = ANNOTATION_RE.exec(node.name)
  if (annMatch) {
    const kind = annMatch[1] === "源标注组" ? "source" : "basic"
    annotations.push({
      groupId: parseInt(annMatch[2], 10),
      kind: kind as "basic" | "source",
      targetName: annMatch[3],
      targetNodeId: annMatch[4],
      specs: collectTextSpecs(node),
    })
    graphNodeNames.add(node.name)
    return
  }

  if (node.children) {
    for (const child of node.children) {
      scanForPatterns(child, connections, annotations, graphNodeNames)
    }
  }
}

function collectSharedNodes(
  node: CompressedNode,
  targetNodeIds: Set<string>,
  graphNodeNames: Set<string>,
  shared: CompressedNode[],
): void {
  if (isGraphNode(node.name, graphNodeNames)) return
  if (targetNodeIds.has(node.id)) return

  const containsTarget = Array.from(targetNodeIds).some((tid) => nodeContainsId(node, tid))
  if (containsTarget) {
    if (node.children) {
      for (const child of node.children) {
        collectSharedNodes(child, targetNodeIds, graphNodeNames, shared)
      }
    }
  } else {
    shared.push(node)
  }
}

function cleanChildren(node: CompressedNode, graphNodeNames: Set<string>): void {
  if (!node.children) return
  node.children = node.children.filter((child) => !isGraphNode(child.name, graphNodeNames))
  for (const child of node.children) {
    cleanChildren(child, graphNodeNames)
  }
}

function cleanDesign(
  design: CompressedDesign,
  graphNodeNames: Set<string>,
  annotations: AnnotationEntry[],
  reuseRefs: ReuseReference[],
): CompressedDesign {
  const cleaned = cloneDesign(design)

  for (const page of cleaned.pages) {
    page.frames = page.frames.filter((frame) => !isGraphNode(frame.name, graphNodeNames))
    for (const frame of page.frames) {
      cleanChildren(frame, graphNodeNames)
    }
  }

  for (const ann of annotations) {
    const targetNode = findContentNode(cleaned, ann.targetNodeId)
    if (targetNode) {
      const specText = ann.specs.join("; ")
      injectAnnotation(targetNode, `[interaction: ${specText}]`)
    }
  }

  for (const ref of reuseRefs) {
    const node = findContentNode(cleaned, ref.nodeId)
    if (node) {
      const safeComponent = ref.component.replace(/[\u4e00-\u9fff]+/g, "").trim() || ref.component
      injectAnnotation(
        node,
        `[external-component: ${ref.library}/${safeComponent}${ref.variant ? `:${ref.variant}` : ""}]`,
      )
      if (REUSE_RE.test(node.name)) {
        node.name = `@reuse@${ref.library}/${safeComponent}${ref.variant ? `:${ref.variant}` : ""}`
      }
    }
  }

  return cleaned
}

// ─── Public API ──────────────────────────────────────────────────────────

export interface AnalyzeGraphStructureCtx {
  emit?: (event: { detail: string }) => void
}

/**
 * Analyse a `CompressedDesign` for tab/annotation/@reuse@ naming conventions.
 *
 * Returns a pair: the cleaned design (graph markers stripped, annotations
 * inlined as `[interaction: …]` / `[external-component: …]` notes) and a
 * `PageGraph` describing the detected structure. When no markers are
 * present, `pageGraph.hasGraphStructure` is false and `design` is the
 * input passed through unchanged.
 */
export function analyzeGraphStructure(
  design: CompressedDesign,
  ctx?: AnalyzeGraphStructureCtx,
): AnalyzeGraphResult {
  const connections: ConnectionEdge[] = []
  const annotations: AnnotationEntry[] = []
  const graphNodeNames = new Set<string>()

  for (const page of design.pages) {
    for (const frame of page.frames) {
      scanForPatterns(frame, connections, annotations, graphNodeNames)
    }
  }

  const allReuseRefs: ReuseReference[] = []
  for (const page of design.pages) {
    for (const frame of page.frames) {
      if (!isGraphNode(frame.name, graphNodeNames)) {
        allReuseRefs.push(...collectReuseRefs(frame))
      }
    }
  }

  if (connections.length === 0 && annotations.length === 0 && allReuseRefs.length === 0) {
    return {
      design,
      pageGraph: {
        hasGraphStructure: false,
        connections: [],
        annotations: [],
        reuseRefs: [],
        pages: [],
        sharedNodes: [],
        externalComponents: [],
      },
    }
  }

  const targetNodeIds = new Set(connections.map((c) => c.target.nodeId))
  const pages: GraphPage[] = []
  const sharedNodes: CompressedNode[] = []

  const minGroupId = connections.length > 0 ? Math.min(...connections.map((c) => c.groupId)) : -1

  const seenTargetIds = new Set<string>()
  const usedSlugs = new Set<string>()

  for (const conn of connections) {
    if (seenTargetIds.has(conn.target.nodeId)) continue
    seenTargetIds.add(conn.target.nodeId)

    const targetNode = findContentNode(design, conn.target.nodeId)
    if (!targetNode) {
      log.warn("connection target not found — skipping", {
        targetName: conn.target.name,
        targetNodeId: conn.target.nodeId,
      })
      continue
    }

    const sourceNode = findContentNode(design, conn.source.nodeId)
    const sourceTexts = sourceNode ? collectTextSpecs(sourceNode) : []
    const displayLabel = sourceTexts[0] || conn.source.name

    let slug = toSlug(displayLabel)
    if (usedSlugs.has(slug)) {
      slug = `${slug}-${conn.groupId}`
    }
    usedSlugs.add(slug)

    const pageAnnotations = annotations.filter((a) => nodeContainsId(targetNode, a.targetNodeId))
    const pageReuseRefs = allReuseRefs.filter((r) => nodeContainsId(targetNode, r.nodeId))

    pages.push({
      id: slug,
      label: displayLabel,
      contentNodes: [targetNode],
      annotations: pageAnnotations,
      reuseRefs: pageReuseRefs,
      isDefault: conn.groupId === minGroupId,
    })
  }

  for (const page of design.pages) {
    for (const frame of page.frames) {
      collectSharedNodes(frame, targetNodeIds, graphNodeNames, sharedNodes)
    }
  }

  const componentMap = new Map<string, { library: string; component: string; variants: Set<string> }>()
  for (const ref of allReuseRefs) {
    const key = `${ref.library}/${ref.component}`
    const existing = componentMap.get(key)
    if (existing) {
      if (ref.variant) existing.variants.add(ref.variant)
    } else {
      componentMap.set(key, {
        library: ref.library,
        component: ref.component,
        variants: new Set(ref.variant ? [ref.variant] : []),
      })
    }
  }

  const externalComponents = Array.from(componentMap.entries()).map(([, info]) => ({
    library: info.library,
    component: info.component,
    variants: Array.from(info.variants),
    stubName: toStubName(info.library, info.component),
  }))

  const pageGraph: PageGraph = {
    hasGraphStructure: connections.length > 0,
    connections,
    annotations,
    reuseRefs: allReuseRefs,
    pages,
    sharedNodes,
    externalComponents,
  }

  const cleanedDesign = cleanDesign(design, graphNodeNames, annotations, allReuseRefs)
  cleanedDesign.pageGraph = pageGraph

  ctx?.emit?.({
    detail: pageGraph.hasGraphStructure
      ? `found ${pageGraph.connections.length} connections, ${pageGraph.annotations.length} annotations, ${pageGraph.reuseRefs.length} @reuse@ refs → ${pageGraph.pages.length} pages`
      : "no graph structure detected — passthrough",
  })

  return { design: cleanedDesign, pageGraph }
}

// ─── createSubDesign — standalone helper (skill-invoked) ─────────────────

function countNodes(nodes: CompressedNode[]): number {
  let count = 0
  for (const node of nodes) {
    count += 1
    if (node.children) count += countNodes(node.children)
  }
  return count
}

function sanitizeReuseName(raw: string): string {
  const match = REUSE_RE.exec(raw)
  if (!match) return raw
  const safeName = match[2].replace(/[\u4e00-\u9fff]+/g, "").trim() || match[2]
  return safeName
}

function stripReuseMetadata(nodes: CompressedNode[]): void {
  for (const node of nodes) {
    if (REUSE_RE.test(node.name)) {
      node.name = sanitizeReuseName(node.name)
    }
    if (node.componentName && REUSE_RE.test(node.componentName)) {
      node.componentName = sanitizeReuseName(node.componentName)
    }
    if (node.annotations) {
      node.annotations = node.annotations.filter((a) => !a.includes("[external-component:"))
    }
    if (node.children) stripReuseMetadata(node.children)
  }
}

function stripReuseFromComponents(design: CompressedDesign): void {
  if (design.components) {
    for (const comp of Object.values(design.components)) {
      if (comp.name && REUSE_RE.test(comp.name)) {
        comp.name = sanitizeReuseName(comp.name)
      }
    }
  }
  if (design.componentSets) {
    for (const cs of Object.values(design.componentSets)) {
      if (cs.name && REUSE_RE.test(cs.name)) {
        cs.name = sanitizeReuseName(cs.name)
      }
    }
  }
}

/**
 * Build an independent `CompressedDesign` from a subset of nodes — useful for
 * per-frame or per-page decomposition in skill-orchestrated flows.
 *
 * `@reuse@` metadata is stripped from node names, `componentName`, and the
 * `components`/`componentSets` dictionaries so downstream codegen produces
 * ASCII-clean identifiers.
 */
export function createSubDesign(
  source: CompressedDesign,
  nodes: CompressedNode[],
  pageName?: string,
): CompressedDesign {
  const cleanedNodes: CompressedNode[] = JSON.parse(JSON.stringify(nodes))
  stripReuseMetadata(cleanedNodes)

  const components = JSON.parse(JSON.stringify(source.components ?? {}))
  const componentSets = JSON.parse(JSON.stringify(source.componentSets ?? {}))

  const subDesign: CompressedDesign = {
    fileName: source.fileName,
    lastModified: source.lastModified,
    figmaUrl: source.figmaUrl,
    pages: [{ name: pageName ?? "Page", frames: cleanedNodes }],
    components,
    componentSets,
    tokens: source.tokens,
    images: source.images ?? {},
    comments: [],
    stats: {
      totalNodes: countNodes(cleanedNodes),
      compressedNodes: countNodes(cleanedNodes),
      imageCount: 0,
      compressionRatio: "1",
    },
  }

  stripReuseFromComponents(subDesign)

  return subDesign
}
