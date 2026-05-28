/**
 * ProjectScaffold → semantic View artifact emitters.
 *
 *   - `generateTokensFile(scaffold) → GeneratedFile` — pre-built
 *     `design-tokens.ts` with COLORS / FONTS / SPACING / RADII / CSS_VARS.
 *   - `generateAppViewFile(scaffold) → GeneratedFile` — pre-built `App.tsx`
 *     composing semantic visual surfaces.
 *   - `buildSharedContext(scaffold, meta) → string` — compact prompt-ready
 *     token + pattern summary (2-5KB vs 50-200KB raw XML).
 *
 * Originally `mirror/url/pattern/scaffold.ts` — promoted to `shared/` when
 * image2code joined as a third source whose `analyze` step needs the same
 * helpers (rule 22 single source). The functions are pure on
 * `ProjectScaffold` and never reference URL-, Figma-, or image-specific
 * fields, which is why a single shared module is the right home.
 *
 * No cross-module imports inside `mirror/` — depends only on `ir/scaffold`.
 *
 * Zero LLM, deterministic.
 */

import type {
  ComponentCatalog as _ComponentCatalog,
  DesignTokenSystem as _DesignTokenSystem,
  FileContract,
  GeneratedFile,
  PlanFile,
  ProjectScaffold,
  TokenColor,
  VisualBindingComponent,
  VisualBindingManifest,
  VisualBindingSlot,
  VisualBindingSlotKind,
} from "../ir/scaffold"
import { VisualBindingManifestSchema } from "../ir/scaffold"
import { parseDocument } from "htmlparser2"

export interface ReactSourceLayout {
  sourceDir: string
  componentsDir: string
  sharedComponentsDir: string
  tokensFilePath: string
  appFilePath: string
}

export const DEFAULT_REACT_SOURCE_LAYOUT: ReactSourceLayout = Object.freeze({
  sourceDir: "src",
  componentsDir: "src/components",
  sharedComponentsDir: "src/components/ui",
  tokensFilePath: "src/design-tokens.ts",
  appFilePath: "src/App.tsx",
})

interface XmlNode {
  type?: string
  name?: string
  attribs?: Record<string, string>
  children?: XmlNode[]
  data?: string
}

interface VisualBindingArtifacts {
  files: GeneratedFile[]
  manifest: VisualBindingManifest
}

interface VisualRenderContext {
  slots: Map<string, VisualBindingSlot>
  nextSlotIndex: number
}

interface JsxExpression {
  __jsxExpression: string
}

// ─── Scaffold → PlanFile[] ───────────────────────────────────────────────

/**
 * Order: shared views → semantic surfaces (top-to-bottom) →
 * tokens + App.tsx **excluded** (they're pre-generated deterministically).
 */
export function scaffoldToPlan(scaffold: ProjectScaffold): PlanFile[] {
  const plan: PlanFile[] = []

  for (const fc of scaffold.sharedViews) {
    plan.push(fileContractToPlanFile(fc, "shared-view"))
  }

  for (const surface of scaffold.surfaces) {
    plan.push(fileContractToPlanFile(surface.view, `surface:${surface.name}`))
  }

  return plan
}

export function materializeScaffoldForReactSource(
  scaffold: ProjectScaffold,
  layout: ReactSourceLayout = DEFAULT_REACT_SOURCE_LAYOUT,
): ProjectScaffold {
  validateReactSourceLayout(layout)

  const tokensFile: FileContract = {
    ...scaffold.tokensFile,
    filePath: layout.tokensFilePath,
  }

  const sharedViews = scaffold.sharedViews.map((component) => ({
    ...component,
    filePath: `${layout.sharedComponentsDir}/${fileBaseName(component.filePath)}`,
  }))

  const surfaces = scaffold.surfaces.map((surface) => {
    const surfaceFilePath = `${layout.componentsDir}/${surface.id}.tsx`

    return {
      ...surface,
      view: {
        ...surface.view,
        filePath: surfaceFilePath,
        imports: {
          ...surface.view.imports,
          [relativeImportPath(surfaceFilePath, tokensFile.filePath)]: ["COLORS", "FONTS", "SPACING", "RADII"],
        },
      },
    }
  })

  const appFile: FileContract = {
    ...scaffold.appFile,
    filePath: layout.appFilePath,
    imports: Object.fromEntries(
      surfaces.map((surface) => [
        relativeImportPath(layout.appFilePath, visualViewPath(surface.view.filePath)),
        [`${surface.view.exportName}View`],
      ]),
    ),
  }

  const materialized: ProjectScaffold = {
    ...scaffold,
    tokensFile,
    sharedViews,
    surfaces,
    appFile,
  }
  assertUniqueGeneratedPaths(generateViewSourceFiles(materialized).map((file) => file.file_path))
  return materialized
}

function fileContractToPlanFile(fc: FileContract, source: string): PlanFile {
  const notesParts: string[] = []

  if (fc.surfaceIR) {
    notesParts.push("## 结构描述 (XML IR)\n\n" + fc.surfaceIR)
  }

  if (fc.propsInterface) {
    notesParts.push("## Props 接口\n\n```typescript\n" + fc.propsInterface + "\n```")
  }

  if (fc.patterns.length > 0) {
    notesParts.push("## 使用的共享组件\n\n" + fc.patterns.map((p) => `- ${p}`).join("\n"))
  }

  return {
    file_path: fc.filePath,
    file_info: `${fc.exportName} component (${source})`,
    notes: notesParts.join("\n\n"),
    contracts: {
      exports: [fc.exportName],
      types: fc.propsInterface || undefined,
      imports: Object.keys(fc.imports).length > 0 ? fc.imports : undefined,
    },
  }
}

// ─── Pre-generated deterministic files ───────────────────────────────────

function colorVarName(c: TokenColor): string {
  if (c.semantic) return c.semantic.replace(/-/g, "_")
  return c.value
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
}

/** `design-tokens.ts` as a `GeneratedFile` — emits COLORS/FONTS/SPACING/RADII/CSS_VARS consts. */
export function generateTokensFile(scaffold: ProjectScaffold): GeneratedFile {
  const tokens = scaffold.tokens
  const lines: string[] = [
    "// Design tokens extracted from the original page",
    "// Auto-generated by Mirror pattern extraction (deterministic, zero LLM)",
    "",
  ]

  if (tokens.colors.length > 0) {
    lines.push("export const COLORS = {")
    const usedColorNames = new Set<string>()
    for (const c of tokens.colors) {
      let name = colorVarName(c)
      if (usedColorNames.has(name)) {
        for (let i = 2; i < 100; i++) {
          const candidate = `${name}_${i}`
          if (!usedColorNames.has(candidate)) {
            name = candidate
            break
          }
        }
      }
      usedColorNames.add(name)
      const semantic = c.semantic ? ` // ${c.semantic}, freq: ${c.frequency}` : ` // freq: ${c.frequency}`
      lines.push(`  ${name}: "${c.value}",${semantic}`)
    }
    lines.push("} as const", "")
  }

  const ICON_FONT_PATTERNS =
    /^(c?iconfont|cos-icon|fontawesome|material[- ]?icons|glyphicons|ionicons|feather|remixicon|bootstrap-icons|anticon)/i
  const textFonts = tokens.fonts.filter((f) => !ICON_FONT_PATTERNS.test(f.family))
  if (textFonts.length > 0) {
    lines.push("export const FONTS = {")
    for (const f of textFonts) {
      const name = f.family
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .toLowerCase()
      lines.push(`  ${name}: "${f.family}",`)
    }
    lines.push("} as const", "")
  }

  if (tokens.spacing.length > 0) {
    lines.push("export const SPACING = {")
    for (const s of tokens.spacing) {
      const tw = s.tailwind ? ` // tw: ${s.tailwind}` : ""
      lines.push(`  sp${s.px}: ${s.px},${tw}`)
    }
    lines.push("} as const", "")
  }

  if (tokens.radii.length > 0) {
    lines.push("export const RADII = {")
    for (const r of tokens.radii) {
      const tw = r.tailwind ? ` // tw: rounded-${r.tailwind}` : ""
      lines.push(`  r${r.px}: ${r.px},${tw}`)
    }
    lines.push("} as const", "")
  }

  const NOISE_PREFIXES = [
    "--shiki",
    "--toastify",
    "--tw-",
    "--rt-",
    "--Colors-",
    "--Bg-",
    "--BgGp-",
    "--Labels-",
    "--Fills-",
    "--Separators-",
    "--MaskBg-",
    "--Always-",
    "--Others",
    "--Syntax-",
    "--UI-",
    "--markdown-",
  ]
  const customProps = Object.entries(tokens.customProperties).filter(
    ([key]) => !NOISE_PREFIXES.some((prefix) => key.startsWith(prefix)),
  )
  if (customProps.length > 0) {
    lines.push("export const CSS_VARS = {")
    for (const [key, value] of customProps) {
      let name = key.replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      if (/[^a-zA-Z0-9_$]/.test(name)) name = `"${name}"`
      const safeValue = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      lines.push(`  ${name}: "${safeValue}",`)
    }
    lines.push("} as const", "")
  }

  return {
    file_path: scaffold.tokensFile.filePath,
    code: lines.join("\n"),
  }
}

/** `App.tsx` as a `GeneratedFile` — imports and composes semantic surface views. */
export function generateAppViewFile(scaffold: ProjectScaffold): GeneratedFile {
  const imports: string[] = ['import React from "react"']
  const components: string[] = []

  for (const surface of scaffold.surfaces) {
    const viewExportName = `${surface.view.exportName}View`
    const importPath = relativeImportPath(scaffold.appFile.filePath, visualViewPath(surface.view.filePath))
    imports.push(`import { ${viewExportName} } from "${importPath}"`)
    components.push(`      <${viewExportName} />`)
  }

  const code = `${imports.join("\n")}

export function App() {
  return (
    <div className="min-h-screen">
${components.join("\n")}
    </div>
  )
}
`

  return {
    file_path: scaffold.appFile.filePath,
    code,
  }
}

export function generateViewSourceFiles(scaffold: ProjectScaffold): GeneratedFile[] {
  const files: GeneratedFile[] = [generateTokensFile(scaffold)]

  for (const component of scaffold.sharedViews) {
    files.push(generateVisualComponentFile(component).file)
  }

  for (const surface of scaffold.surfaces) {
    files.push(generateVisualComponentFile(surface.view).file)
  }

  files.push(generateAppViewFile(scaffold))
  assertUniqueGeneratedPaths(files.map((file) => file.file_path))
  return files
}

export function generateVisualBindingArtifacts(scaffold: ProjectScaffold): VisualBindingArtifacts {
  const files: GeneratedFile[] = [generateTokensFile(scaffold)]
  const components: VisualBindingComponent[] = []

  for (const component of scaffold.sharedViews) {
    const artifact = generateVisualComponentFile(component)
    files.push(artifact.file)
    components.push(artifact.component)
  }

  for (const surface of scaffold.surfaces) {
    const artifact = generateVisualComponentFile(surface.view)
    files.push(artifact.file)
    components.push(artifact.component)
  }

  assertUniqueGeneratedPaths(files.map((file) => file.file_path))
  return {
    files,
    manifest: VisualBindingManifestSchema.parse({
      version: 1,
      purpose: "visual-presentational-bindings",
      components,
    }),
  }
}

function generateComponentFile(file: FileContract, role: "surface" | "shared-view"): GeneratedFile {
  const propsInterface = file.propsInterface.trim()
  const propsName = propsInterface.match(/^interface\s+([A-Za-z_$][\w$]*)/m)?.[1]
  const propsParam = propsName ? `props: ${propsName}` : ""
  const propsReference = propsName ? "\n  void props" : ""
  const body = file.surfaceIR?.trim()
    ? renderIntermediateRepresentation(file.surfaceIR)
    : `    <section className="mirror-${role}" data-mirror-component="${jsxAttr(file.exportName)}" />`

  const code = [
    'import React from "react"',
    "",
    propsInterface,
    propsInterface ? "" : undefined,
    `export function ${file.exportName}(${propsParam}) {`,
    propsReference,
    "  return (",
    body,
    "  )",
    "}",
    "",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")

  return {
    file_path: file.filePath,
    code,
  }
}

function generateVisualComponentFile(file: FileContract): { file: GeneratedFile; component: VisualBindingComponent } {
  const viewExportName = `${file.exportName}View`
  const propsInterfaceName = `${viewExportName}Slots`
  const ctx: VisualRenderContext = { slots: new Map(), nextSlotIndex: 0 }
  const body = file.surfaceIR?.trim()
    ? renderVisualIntermediateRepresentation(file.surfaceIR, ctx)
    : `    <section className="mirror-view" data-mirror-component="${jsxAttr(viewExportName)}" />`
  const slots = Array.from(ctx.slots.values())
  const propsInterface = renderVisualSlotsInterface(propsInterfaceName, slots)

  const code = [
    'import React from "react"',
    "",
    propsInterface,
    "",
    `export function ${viewExportName}(props: { slots?: ${propsInterfaceName} } = {}) {`,
    "  const slots = props.slots ?? {}",
    "  return (",
    body,
    "  )",
    "}",
    "",
  ].join("\n")

  const filePath = visualViewPath(file.filePath)
  return {
    file: {
      file_path: filePath,
      code,
    },
    component: {
      sourceExportName: file.exportName,
      viewExportName,
      filePath,
      slots,
    },
  }
}

function renderVisualSlotsInterface(name: string, slots: VisualBindingSlot[]): string {
  if (slots.length === 0) return `export interface ${name} {}`

  const lines = [`export interface ${name} {`]
  for (const slot of slots) {
    const type = slot.kind === "text" ? "React.ReactNode" : "string"
    lines.push(`  ${slot.name}?: ${type}`)
  }
  lines.push("}")
  return lines.join("\n")
}

function renderVisualIntermediateRepresentation(sectionIR: string, ctx: VisualRenderContext): string {
  const document = parseDocument(sectionIR, {
    xmlMode: true,
    lowerCaseTags: false,
    lowerCaseAttributeNames: false,
    recognizeSelfClosing: true,
  })
  const children = renderVisualNodeList(document.children as XmlNode[], 2, ctx, "")
  return children.length > 0
    ? children.join("\n")
    : '    <section className="mirror-view" data-mirror-empty="true" />'
}

function renderVisualXmlNode(node: XmlNode, depth: number, ctx: VisualRenderContext, sourcePath: string): string {
  if (node.type === "text") {
    const text = (node.data ?? "").trim()
    return text ? `${indent(depth)}{${JSON.stringify(text)}}` : ""
  }
  if (node.type === "comment") return ""
  if (node.type !== "tag") return ""

  const tagName = node.name ?? ""
  if (tagName === "Text") return renderVisualTextNode(node, depth, ctx, sourcePath)
  if (tagName === "Image") return renderVisualImageNode(node, depth, ctx, sourcePath)
  if (tagName === "Inline") return renderVisualElementNode("span", node, depth, ctx, sourcePath)
  if (tagName === "Icon") return renderVisualElementNode("span", node, depth, ctx, sourcePath, { role: "img" })
  if (tagName === "Repeat") {
    return renderVisualElementNode("div", node, depth, ctx, sourcePath, { "data-mirror-repeat": node.attribs?.count ?? "" })
  }
  if (tagName === "Container") return renderVisualElementNode("div", node, depth, ctx, sourcePath)
  if (tagName === "Box") return renderVisualElementNode("div", node, depth, ctx, sourcePath)

  throw new Error(`Unsupported section IR tag: ${tagName}`)
}

function renderVisualTextNode(node: XmlNode, depth: number, ctx: VisualRenderContext, sourcePath: string): string {
  const attrs: Record<string, string | Record<string, string> | JsxExpression> = {
    ...dataAttrs(node.attribs),
    className: "mirror-text",
  }
  const text = collectNodeText(node)
  const slot = addVisualSlot(ctx, {
    name: namedSlot(node.attribs?.name, "text"),
    kind: "text",
    defaultValue: text,
    sourceName: node.attribs?.name,
    sourcePath,
  })
  const tag = node.attribs?.href ? "a" : "p"
  if (node.attribs?.href) {
    const hrefSlot = addVisualSlot(ctx, {
      name: `${namedSlot(node.attribs.name, "link")}Href`,
      kind: "href",
      defaultValue: node.attribs.href,
      sourceName: node.attribs.name,
      sourcePath,
    })
    attrs.href = jsxExpression(`slots.${hrefSlot.name} ?? ${JSON.stringify(node.attribs.href)}`)
  }

  const hasStructuredChildren = (node.children ?? []).some((child) => child.type === "tag")
  const defaultChildren = hasStructuredChildren ? renderVisualChildren(node, depth + 3, ctx, sourcePath) : []
  if (!hasStructuredChildren || defaultChildren.length === 0) {
    return `${indent(depth)}<${tag}${jsxAttrs(attrs)}>{slots.${slot.name} ?? ${JSON.stringify(text)}}</${tag}>`
  }

  return [
    `${indent(depth)}<${tag}${jsxAttrs(attrs)}>`,
    `${indent(depth + 1)}{slots.${slot.name} ?? (`,
    `${indent(depth + 2)}<>`,
    ...defaultChildren,
    `${indent(depth + 2)}</>`,
    `${indent(depth + 1)})}`,
    `${indent(depth)}</${tag}>`,
  ].join("\n")
}

function renderVisualImageNode(node: XmlNode, depth: number, ctx: VisualRenderContext, sourcePath: string): string {
  const attrs = node.attribs ?? {}
  const src = attrs.src ?? attrs["src-ref"]
  if (!src) throw new Error("Image node is missing src in section IR")

  const baseName = namedSlot(attrs.name, "image")
  const srcSlot = addVisualSlot(ctx, {
    name: `${baseName}Src`,
    kind: "image-src",
    defaultValue: src,
    sourceName: attrs.name,
    sourcePath,
  })
  const alt = attrs.alt ?? attrs.name ?? ""
  const altSlot = addVisualSlot(ctx, {
    name: `${baseName}Alt`,
    kind: "image-alt",
    defaultValue: alt,
    sourceName: attrs.name,
    sourcePath,
  })

  return `${indent(depth)}<img${jsxAttrs({
    ...dataAttrs(attrs),
    className: "mirror-image",
    src: jsxExpression(`slots.${srcSlot.name} ?? ${JSON.stringify(src)}`),
    alt: jsxExpression(`slots.${altSlot.name} ?? ${JSON.stringify(alt)}`),
    style: styleObject(attrs),
  })} />`
}

function renderVisualElementNode(
  tag: string,
  node: XmlNode,
  depth: number,
  ctx: VisualRenderContext,
  sourcePath: string,
  extraAttrs: Record<string, string> = {},
): string {
  const htmlTag = node.attribs?.href ? "a" : tag
  const attrs: Record<string, string | Record<string, string> | JsxExpression> = {
    ...dataAttrs(node.attribs),
    ...extraAttrs,
    className: `mirror-${node.name?.toLowerCase()}`,
    style: styleObject(node.attribs ?? {}),
  }
  if (node.attribs?.href) {
    const slot = addVisualSlot(ctx, {
      name: `${namedSlot(node.attribs.name, "link")}Href`,
      kind: "href",
      defaultValue: node.attribs.href,
      sourceName: node.attribs.name,
      sourcePath,
    })
    attrs.href = jsxExpression(`slots.${slot.name} ?? ${JSON.stringify(node.attribs.href)}`)
  }

  return renderElement(
    htmlTag,
    attrs,
    renderVisualChildren(node, depth + 1, ctx, sourcePath),
    depth,
  )
}

function renderVisualChildren(node: XmlNode, depth: number, ctx: VisualRenderContext, sourcePath: string): string[] {
  return renderVisualNodeList(node.children ?? [], depth, ctx, sourcePath)
}

function renderVisualNodeList(nodes: XmlNode[], depth: number, ctx: VisualRenderContext, sourcePath: string): string[] {
  const rendered: string[] = []
  let renderedIndex = 0
  for (const node of nodes) {
    const childSourcePath = sourcePath.length > 0 ? `${sourcePath}.${renderedIndex}` : `${renderedIndex}`
    const line = renderVisualXmlNode(node, depth, ctx, childSourcePath)
    if (line.trim().length === 0) continue
    rendered.push(line)
    renderedIndex++
  }
  return rendered
}

function addVisualSlot(ctx: VisualRenderContext, slot: VisualBindingSlot): VisualBindingSlot {
  const base = sanitizeIdentifier(slot.name)
  let name = base
  let i = ++ctx.nextSlotIndex
  while (ctx.slots.has(name)) {
    name = `${base}${i}`
    i++
  }

  const stored = { ...slot, name }
  ctx.slots.set(name, stored)
  return stored
}

function namedSlot(name: string | undefined, fallback: string): string {
  return sanitizeIdentifier(name && name.trim().length > 0 ? name : fallback)
}

function sanitizeIdentifier(value: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9_$]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9_$]/g, "")
    .replace(/^[0-9]+/, "")
  const candidate = cleaned.length > 0 ? cleaned : "slot"
  return candidate.charAt(0).toLowerCase() + candidate.slice(1)
}

function visualViewPath(filePath: string): string {
  const normalized = slashPath(filePath)
  if (normalized.endsWith(".tsx")) return normalized.replace(/\.tsx$/, ".view.tsx")
  if (normalized.endsWith(".ts")) return normalized.replace(/\.ts$/, ".view.tsx")
  return `${normalized}.view.tsx`
}

function renderIntermediateRepresentation(sectionIR: string): string {
  const document = parseDocument(sectionIR, {
    xmlMode: true,
    lowerCaseTags: false,
    lowerCaseAttributeNames: false,
    recognizeSelfClosing: true,
  })
  const children = (document.children as XmlNode[])
    .map((node) => renderXmlNode(node, 2))
    .filter((line) => line.trim().length > 0)
  return children.length > 0
    ? children.join("\n")
    : '    <section className="mirror-section" data-mirror-empty="true" />'
}

function renderXmlNode(node: XmlNode, depth: number): string {
  if (node.type === "text") {
    const text = (node.data ?? "").trim()
    return text ? `${indent(depth)}{${JSON.stringify(text)}}` : ""
  }
  if (node.type === "comment") return ""
  if (node.type !== "tag") return ""

  const tagName = node.name ?? ""
  if (tagName === "Text") return renderTextNode(node, depth)
  if (tagName === "Image") return renderImageNode(node, depth)
  if (tagName === "Inline") return renderElementNode("span", node, depth)
  if (tagName === "Icon") return renderElementNode("span", node, depth, { role: "img" })
  if (tagName === "Repeat") return renderElementNode("div", node, depth, { "data-mirror-repeat": node.attribs?.count ?? "" })
  if (tagName === "Container") return renderElementNode("div", node, depth)
  if (tagName === "Box") return renderElementNode("div", node, depth)

  throw new Error(`Unsupported section IR tag: ${tagName}`)
}

function renderTextNode(node: XmlNode, depth: number): string {
  const attrs = {
    ...dataAttrs(node.attribs),
    className: "mirror-text",
  }
  const text = collectNodeText(node)
  const renderedChildren = renderChildren(node, depth + 1)
  if (renderedChildren.length > 0) return renderElement("p", attrs, renderedChildren, depth)
  return `${indent(depth)}<p${jsxAttrs(attrs)}>{${JSON.stringify(text)}}</p>`
}

function renderImageNode(node: XmlNode, depth: number): string {
  const attrs = node.attribs ?? {}
  const src = attrs.src ?? attrs["src-ref"]
  if (!src) throw new Error(`Image node is missing src in section IR`)
  return `${indent(depth)}<img${jsxAttrs({
    ...dataAttrs(attrs),
    className: "mirror-image",
    src,
    alt: attrs.alt ?? attrs.name ?? "",
    style: styleObject(attrs),
  })} />`
}

function renderElementNode(
  tag: string,
  node: XmlNode,
  depth: number,
  extraAttrs: Record<string, string> = {},
): string {
  const htmlTag = node.attribs?.href ? "a" : tag
  return renderElement(
    htmlTag,
    {
      ...dataAttrs(node.attribs),
      ...extraAttrs,
      className: `mirror-${node.name?.toLowerCase()}`,
      style: styleObject(node.attribs ?? {}),
    },
    renderChildren(node, depth + 1),
    depth,
  )
}

function renderElement(
  tag: string,
  attrs: Record<string, string | Record<string, string> | JsxExpression>,
  children: string[],
  depth: number,
): string {
  if (children.length === 0) return `${indent(depth)}<${tag}${jsxAttrs(attrs)} />`
  return [
    `${indent(depth)}<${tag}${jsxAttrs(attrs)}>`,
    ...children,
    `${indent(depth)}</${tag}>`,
  ].join("\n")
}

function renderChildren(node: XmlNode, depth: number): string[] {
  return (node.children ?? [])
    .map((child) => renderXmlNode(child, depth))
    .filter((line) => line.trim().length > 0)
}

function collectNodeText(node: XmlNode): string {
  return (node.children ?? [])
    .map((child) => {
      if (child.type === "text") return child.data ?? ""
      return collectNodeText(child)
    })
    .join("")
    .trim()
}

function dataAttrs(attrs: Record<string, string> | undefined): Record<string, string> {
  if (!attrs) return {}
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "style") result["data-mirror-text-style"] = value
    else if (key === "name") result["data-mirror-name"] = value
    else if (key === "layout") result["data-mirror-layout"] = value
    else if (key === "href") result.href = value
  }
  return result
}

function styleObject(attrs: Record<string, string>): Record<string, string> {
  const entries: Record<string, string> = {}
  if (attrs.bg) entries.backgroundColor = attrs.bg
  if (attrs.border) entries.border = attrs.border
  if (attrs.radius) entries.borderRadius = attrs.radius
  if (attrs.shadow) entries.boxShadow = attrs.shadow
  if (attrs.opacity) entries.opacity = attrs.opacity
  if (attrs.padding) entries.padding = attrs.padding
  if (attrs.margin) entries.margin = attrs.margin
  if (attrs["max-w"]) entries.maxWidth = attrs["max-w"]
  if (attrs["min-w"]) entries.minWidth = attrs["min-w"]
  if (attrs["max-h"]) entries.maxHeight = attrs["max-h"]
  if (attrs["min-h"]) entries.minHeight = attrs["min-h"]
  if (attrs.size) {
    const [width, height] = attrs.size.split("x")
    if (width) entries.width = `${width}px`
    if (height) entries.minHeight = `${height}px`
  }
  if (attrs.layout?.includes("VERTICAL")) {
    entries.display = "flex"
    entries.flexDirection = "column"
  } else if (attrs.layout?.includes("HORIZONTAL")) {
    entries.display = "flex"
    entries.flexDirection = "row"
  } else if (attrs.layout?.includes("GRID")) {
    entries.display = "grid"
  }
  const gap = attrs.layout?.match(/gap:([^ ]+)/)?.[1]
  if (gap) entries.gap = gap
  return entries
}

function jsxAttrs(attrs: Record<string, string | Record<string, string> | JsxExpression>): string {
  const rendered = Object.entries(attrs)
    .filter(([, value]) => isJsxExpression(value) || typeof value !== "object" || Object.keys(value).length > 0)
    .map(([key, value]) => {
      if (isJsxExpression(value)) return ` ${key}={${value.__jsxExpression}}`
      if (typeof value === "object") return ` ${key}={${jsxObject(value)}}`
      return ` ${key}=${JSON.stringify(value)}`
    })
  return rendered.join("")
}

function jsxExpression(value: string): JsxExpression {
  return { __jsxExpression: value }
}

function isJsxExpression(value: unknown): value is JsxExpression {
  return typeof value === "object" && value !== null && "__jsxExpression" in value
}

function jsxObject(value: Record<string, string>): string {
  const entries = Object.entries(value).map(([key, val]) => `${key}: ${JSON.stringify(val)}`)
  return `{ ${entries.join(", ")} }`
}

function jsxAttr(value: string): string {
  return value.replace(/"/g, "&quot;")
}

function indent(depth: number): string {
  return "  ".repeat(depth)
}

function validateReactSourceLayout(layout: ReactSourceLayout): void {
  const values = [
    layout.sourceDir,
    layout.componentsDir,
    layout.sharedComponentsDir,
    layout.tokensFilePath,
    layout.appFilePath,
  ]
  for (const value of values) {
    if (value.length === 0) throw new Error("React source layout path cannot be empty")
    if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
      throw new Error(`React source layout path must be worktree-relative: ${value}`)
    }
    if (value.split(/[\\/]+/).includes("..")) {
      throw new Error(`React source layout path cannot escape the worktree: ${value}`)
    }
  }
}

function fileBaseName(filePath: string): string {
  const normalized = slashPath(filePath)
  return normalized.slice(normalized.lastIndexOf("/") + 1)
}

function relativeImportPath(fromFile: string, toFile: string): string {
  const fromDir = slashPath(fromFile).split("/").slice(0, -1)
  const toParts = slashPath(toFile).replace(/\.(tsx|ts)$/, "").split("/")
  while (fromDir.length > 0 && toParts.length > 0 && fromDir[0] === toParts[0]) {
    fromDir.shift()
    toParts.shift()
  }
  const prefix = fromDir.map(() => "..")
  const relative = [...prefix, ...toParts].join("/")
  return relative.startsWith(".") ? relative : `./${relative}`
}

function slashPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "")
}

function assertUniqueGeneratedPaths(paths: string[]): void {
  const seen = new Set<string>()
  for (const filePath of paths) {
    const normalized = slashPath(filePath)
    if (seen.has(normalized)) throw new Error(`Duplicate generated source path: ${filePath}`)
    seen.add(normalized)
  }
}

// ─── Shared context builder ──────────────────────────────────────────────

/** Source-agnostic page metadata for the shared-context preamble.
 *  `url` is optional because image2code clones have no upstream URL. */
export interface SharedContextMeta {
  url?: string
  title: string
  viewport: { width: number; height: number }
}

/**
 * Compact context string to inject into codegen prompts — includes page
 * metadata + token summary + detected-component summary. 2-5KB vs
 * 50-200KB for raw XML dump.
 */
export function buildSharedContext(
  scaffold: ProjectScaffold,
  meta: SharedContextMeta,
): string {
  const parts: string[] = []

  const headerBits: string[] = [`Page: ${meta.title}`]
  if (meta.url) headerBits.push(`URL: ${meta.url}`)
  headerBits.push(`Viewport: ${meta.viewport.width}x${meta.viewport.height}`)
  parts.push(`<!-- ${headerBits.join(" | ")} -->`)

  const t = scaffold.tokens
  if (t.colors.length > 0) {
    parts.push("\n## 设计 Token — 颜色")
    for (const c of t.colors.slice(0, 15)) {
      const sem = c.semantic ? ` (${c.semantic})` : ""
      parts.push(`- \`${c.value}\`${sem} — 使用 ${c.frequency} 次`)
    }
  }
  if (t.fonts.length > 0) {
    parts.push("\n## 设计 Token — 字体")
    for (const f of t.fonts) {
      parts.push(`- ${f.family}: weights [${f.weights.join(", ")}], sizes [${f.sizes.join(", ")}px]`)
    }
  }
  if (t.spacing.length > 0) {
    parts.push("\n## 设计 Token — 间距")
    const topSpacing = t.spacing.slice(0, 8)
    parts.push(
      `常用间距: ${topSpacing.map((s) => `${s.px}px${s.tailwind ? `(tw:${s.tailwind})` : ""}`).join(", ")}`,
    )
  }

  const catalog = scaffold.catalog
  if (catalog.patterns.length > 0) {
    parts.push("\n## 检测到的可复用组件模式")
    for (const p of catalog.patterns) {
      const propsDesc =
        p.props.length > 0
          ? ` — props: ${p.props.map((pr) => `${pr.name}: ${pr.type}`).join(", ")}`
          : ""
      parts.push(
        `- **${p.name}** (${p.instanceCount} 个实例, 相似度 ${(p.structuralSimilarity * 100).toFixed(0)}%)${propsDesc}`,
      )
    }
    parts.push(
      `\n覆盖率: ${catalog.coveredElements}/${catalog.totalElements} 元素 (${((catalog.coveredElements / Math.max(catalog.totalElements, 1)) * 100).toFixed(0)}%)`,
    )
  }

  return parts.join("\n")
}
