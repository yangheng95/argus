import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { parseDocument } from "htmlparser2"

export interface GenerateWebCloneSourceProjectInput {
  mirrorDir: string
  outputDir: string
  framework?: "react"
  packageName?: string
  overwrite?: boolean
}

export interface GenerateWebCloneSourceProjectOutput {
  framework: "react"
  mirrorDir: string
  outputDir: string
  files: string[]
  stats: {
    textSignalCount: number
    componentCount: number
    tableCount: number
    listCount: number
    cardCount: number
    repeatedGroupCount: number
    assetRefCount: number
    copiedCssFiles: number
  }
}

interface SourceTable {
  title?: string
  headers: string[]
  rows: string[][]
}

interface SourceList {
  title?: string
  items: string[]
}

interface SourceCard {
  title?: string
  fields: Array<{ label?: string; value: string }>
  text: string[]
}

interface SourceRepeatedGroup {
  title?: string
  sampleTexts: string[]
}

interface SourceComponent {
  name: string
  kind?: string
  tag?: string
  classNames: string[]
  textPreview: string[]
}

interface SourceAssetRef {
  id: string
  kind: string
  path: string
  mime?: string
  semanticRole?: string
  preview?: string
  bytes?: number
}

interface SourceProjectData {
  textSignals: string[]
  components: SourceComponent[]
  tables: SourceTable[]
  lists: SourceList[]
  cards: SourceCard[]
  repeatedGroups: SourceRepeatedGroup[]
  assets: SourceAssetRef[]
}

interface DomNode {
  type?: string
  name?: string
  data?: string
  attribs?: Record<string, string>
  children?: DomNode[]
}

interface ExtractedPublicAsset {
  relativePath: string
  bytes: Uint8Array
}

interface DocumentContext {
  htmlAttrs: Record<string, string>
  bodyAttrs: Record<string, string>
}

const MAX_TEXT_SIGNALS = 160
const MAX_TABLES = 24
const MAX_TABLE_ROWS = 80
const MAX_LISTS = 24
const MAX_LIST_ITEMS = 80
const MAX_CARDS = 48
const MAX_REPEATED_GROUPS = 48
const MAX_ASSET_REFS = 240

export async function generateWebCloneSourceProject(
  input: GenerateWebCloneSourceProjectInput,
): Promise<GenerateWebCloneSourceProjectOutput> {
  const framework = input.framework ?? "react"
  if (framework !== "react") throw new Error(`Unsupported web clone source framework: ${framework}`)

  const mirrorDir = path.resolve(input.mirrorDir)
  const outputDir = path.resolve(input.outputDir)
  await assertMirrorInputs(mirrorDir)
  await prepareOutputDir(outputDir, input.overwrite === true)

  const [sourceSkeleton, rawCriticalCss, rawFullSourceCss, contentModel, componentTree, assetManifest, pageIr] = await Promise.all([
    readText(path.join(mirrorDir, "source-skeleton", "index.html")),
    readOptionalText(path.join(mirrorDir, "source-skeleton", "critical.css")),
    readOptionalText(path.join(mirrorDir, "source-skeleton", "full-source.css")),
    readJsonOptional(path.join(mirrorDir, "source-ir", "content-model.json")),
    readJsonOptional(path.join(mirrorDir, "source-ir", "component-tree.json")),
    readJsonOptional(path.join(mirrorDir, "assets", "manifest.json")),
    readJsonOptional(path.join(mirrorDir, "page.ir.json")),
  ])
  const extractedAssets = new Map<string, ExtractedPublicAsset>()
  const criticalCss = sanitizeCssSidecar(rawCriticalCss, extractedAssets)
  const fullSourceCss = sanitizeCssSidecar(rawFullSourceCss, extractedAssets)
  const projectData = buildSourceProjectData({ sourceSkeleton, contentModel, componentTree, assetManifest })
  const previewImagePaths = await readPreviewImagePaths(mirrorDir)
  const nodeStyleFallbacks = extractNodeStyleFallbacks(pageIr)
  const irChildrenByNodeId = extractIrChildrenByNodeId(pageIr)
  const documentContext = extractDocumentContext(pageIr)
  const svgPaths = await readSvgPathData(mirrorDir)

  const packageName = normalizePackageName(input.packageName ?? `web-clone-${path.basename(outputDir)}`)
  const files = new Map<string, string>()
  files.set("package.json", renderPackageJson(packageName))
  files.set("tsconfig.json", renderTsconfigJson())
  files.set("index.html", renderIndexHtml(documentContext))
  files.set("README.md", renderReadme(mirrorDir))
  files.set("src/main.tsx", renderMainTsx())
  files.set("src/App.tsx", renderAppTsx())
  files.set("src/components/SourceClonePage.tsx", renderSourceClonePageTsx())
  files.set(
    "src/components/SourceDomPage.tsx",
    renderSourceDomPageTsx(sourceSkeleton, previewImagePaths, nodeStyleFallbacks, irChildrenByNodeId),
  )
  files.set("src/components/AssetPath.tsx", renderAssetPathTsx())
  files.set("src/components/ContentTable.tsx", renderContentTableTsx())
  files.set("src/data/svgPaths.ts", renderSvgPathsTs(svgPaths))
  files.set("src/data/sourceData.ts", renderSourceDataTs(projectData))
  files.set("src/styles.css", renderStylesCss({ hasCriticalCss: criticalCss.length > 0, hasFullCss: fullSourceCss.length > 0 }))
  if (criticalCss.length > 0) files.set("src/styles/source-critical.css", criticalCss)
  if (fullSourceCss.length > 0) files.set("src/styles/source-full.css", fullSourceCss)

  for (const [relativePath, content] of files) {
    await writeFile(path.join(outputDir, relativePath), content)
  }
  await copyPublicAssets(mirrorDir, outputDir, extractedAssets)
  await writeJson(path.join(outputDir, "src/data/sourceProjectManifest.json"), {
    version: 1,
    purpose: "web-clone-source-project",
    mirrorDir,
    generatedFrom: [
      "source-skeleton/index.html",
      "source-skeleton/critical.css",
      "source-skeleton/full-source.css",
      "source-ir/content-model.json",
      "source-ir/component-tree.json",
      "assets/manifest.json",
    ],
    rules: [
      "Use sourceData.ts and framework components as the editable implementation surface.",
      "Do not render reference.png, screenshot files, base64 payloads, or hidden semantic coverage layers as the clone.",
      "Keep visual validation outside the source project using mirror/reference.png and webpage_evaluate.",
    ],
  })

  const writtenFiles = [
    ...files.keys(),
    "src/data/sourceProjectManifest.json",
  ].sort()

  return {
    framework,
    mirrorDir,
    outputDir,
    files: writtenFiles.map((file) => path.join(outputDir, file)),
    stats: {
      textSignalCount: projectData.textSignals.length,
      componentCount: projectData.components.length,
      tableCount: projectData.tables.length,
      listCount: projectData.lists.length,
      cardCount: projectData.cards.length,
      repeatedGroupCount: projectData.repeatedGroups.length,
      assetRefCount: projectData.assets.length,
      copiedCssFiles: [criticalCss, fullSourceCss].filter(Boolean).length,
    },
  }
}

function buildSourceProjectData(input: {
  sourceSkeleton: string
  contentModel: unknown
  componentTree: unknown
  assetManifest: unknown
}): SourceProjectData {
  const tables = readTables(input.contentModel)
  const lists = readLists(input.contentModel)
  const cards = readCards(input.contentModel)
  const repeatedGroups = readRepeatedGroups(input.contentModel)
  const components = readComponents(input.componentTree)
  const assets = readAssetRefs(input.assetManifest)
  const textSignals = rankTextSignals([
    ...collectVisibleStrings(input.contentModel),
    ...components.flatMap((component) => [component.name, ...component.textPreview]),
    ...tables.flatMap((table) => [...table.headers, ...table.rows.flat()]),
    ...lists.flatMap((list) => list.items),
    ...cards.flatMap((card) => [...card.text, ...card.fields.map((field) => field.value)]),
    ...repeatedGroups.flatMap((group) => group.sampleTexts),
    ...collectSkeletonText(input.sourceSkeleton),
  ]).slice(0, MAX_TEXT_SIGNALS)

  return {
    textSignals,
    components,
    tables,
    lists,
    cards,
    repeatedGroups,
    assets,
  }
}

function extractNodeStyleFallbacks(pageIr: unknown): Map<string, string> {
  const styles = new Map<string, string>()

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!value || typeof value !== "object") return
    const row = value as Record<string, unknown>
    if (typeof row.id === "string" && Array.isArray(row.attrs)) {
      const styleAttr = row.attrs.find((attr) => {
        const attrRow = attr && typeof attr === "object" ? attr as Record<string, unknown> : {}
        return attrRow.name === "style" && typeof attrRow.value === "string"
      }) as Record<string, unknown> | undefined
      if (typeof styleAttr?.value === "string") {
        styles.set(row.id, normalizeStyleAssetUrls(styleAttr.value))
      }
    }
    if (row.root) visit(row.root)
    if (Array.isArray(row.children)) {
      for (const child of row.children) visit(child)
    }
  }

  visit(pageIr)
  return styles
}

function extractDocumentContext(pageIr: unknown): DocumentContext {
  return {
    htmlAttrs: {
      lang: "en",
      dir: "ltr",
      class: "is-not-authenticated is-not-pro theme-light feature-no-touch feature-no-mobiletouch",
      "data-theme": "light",
      ...extractElementAttrs(pageIr, "html"),
    },
    bodyAttrs: {
      class: "search-page index-page",
      ...extractElementAttrs(pageIr, "body"),
    },
  }
}

function extractElementAttrs(pageIr: unknown, tagName: string): Record<string, string> {
  const node = findIrElement(pageIr, tagName)
  return node ? irAttrsToDomAttribs(node.attrs) : {}
}

function findIrElement(value: unknown, tagName: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findIrElement(item, tagName)
      if (found) return found
    }
    return undefined
  }
  if (!value || typeof value !== "object") return undefined
  const row = value as Record<string, unknown>
  if (row.type === "element" && row.tag === tagName) return row
  if (row.root) {
    const found = findIrElement(row.root, tagName)
    if (found) return found
  }
  if (Array.isArray(row.children)) {
    for (const child of row.children) {
      const found = findIrElement(child, tagName)
      if (found) return found
    }
  }
  return undefined
}

function extractIrChildrenByNodeId(pageIr: unknown): Map<string, DomNode[]> {
  const childrenById = new Map<string, DomNode[]>()

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!value || typeof value !== "object") return
    const row = value as Record<string, unknown>
    if (typeof row.id === "string" && Array.isArray(row.children)) {
      const children = row.children
        .map((child) => domNodeFromIrNode(child))
        .filter((child): child is DomNode => Boolean(child))
      if (children.length > 0) childrenById.set(row.id, children)
    }
    if (row.root) visit(row.root)
    if (Array.isArray(row.children)) {
      for (const child of row.children) visit(child)
    }
  }

  visit(pageIr)
  return childrenById
}

function domNodeFromIrNode(value: unknown): DomNode | undefined {
  if (!value || typeof value !== "object") return undefined
  const row = value as Record<string, unknown>
  if (row.type === "text") {
    return { type: "text", data: typeof row.text === "string" ? row.text : "" }
  }
  if (row.type !== "element" || typeof row.tag !== "string") return undefined
  return {
    type: "tag",
    name: row.tag,
    attribs: { "data-source-node-id": typeof row.id === "string" ? row.id : "", ...irAttrsToDomAttribs(row.attrs) },
    children: Array.isArray(row.children)
      ? row.children.map((child) => domNodeFromIrNode(child)).filter((child): child is DomNode => Boolean(child))
      : [],
  }
}

function irAttrsToDomAttribs(attrs: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  if (!Array.isArray(attrs)) return result
  for (const attr of attrs) {
    const row = attr && typeof attr === "object" ? attr as Record<string, unknown> : undefined
    if (!row || typeof row.name !== "string") continue
    if (row.name === "d" && typeof row.assetId === "string") {
      result["data-asset-d"] = `../assets/svg/${row.assetId}.path.txt`
      continue
    }
    if (typeof row.value !== "string" || row.value.startsWith("__WEB_CLONE_ASSET_REF_")) continue
    result[row.name] = row.name === "style" ? normalizeStyleAssetUrls(row.value) : row.value
  }
  return result
}

function normalizeStyleAssetUrls(style: string): string {
  return style.replace(/url\(assets\/(asset_\d+\.(?:png|webp|jpe?g))\)/gi, 'url("/assets/images/$1")')
}

function readTables(contentModel: unknown): SourceTable[] {
  return readArray(contentModel, "tables")
    .map((item, index) => {
      const row = asRecord(item)
      const headers = readStringArray(row.headers).filter((value) => value.length > 0)
      const rows = readTableRows(row.rows).slice(0, MAX_TABLE_ROWS)
      return {
        title: readString(row.title) ?? `Table ${index + 1}`,
        headers,
        rows,
      }
    })
    .filter((table) => table.headers.length > 0 || table.rows.length > 0)
    .slice(0, MAX_TABLES)
}

function readLists(contentModel: unknown): SourceList[] {
  return readArray(contentModel, "lists")
    .map((item, index) => {
      const row = asRecord(item)
      return {
        title: readString(row.title) ?? `List ${index + 1}`,
        items: readStringArray(row.items).slice(0, MAX_LIST_ITEMS),
      }
    })
    .filter((list) => list.items.length > 0)
    .slice(0, MAX_LISTS)
}

function readCards(contentModel: unknown): SourceCard[] {
  return readArray(contentModel, "cards")
    .map((item, index) => {
      const row = asRecord(item)
      const fields: Array<{ label?: string; value: string }> = []
      for (const field of readArray(row, "fields")) {
        const fieldRow = asRecord(field)
        const value = readString(fieldRow.value) ?? readString(fieldRow.text)
        if (!value) continue
        const label = readString(fieldRow.label)
        fields.push(label ? { label, value } : { value })
      }
      return {
        title: readString(row.title) ?? `Card ${index + 1}`,
        fields,
        text: readStringArray(row.text),
      }
    })
    .filter((card) => card.fields.length > 0 || card.text.length > 0)
    .slice(0, MAX_CARDS)
}

function readRepeatedGroups(contentModel: unknown): SourceRepeatedGroup[] {
  return readArray(contentModel, "repeatedGroups")
    .map((item, index) => {
      const row = asRecord(item)
      return {
        title: readString(row.title) ?? `Repeated group ${index + 1}`,
        sampleTexts: readStringArray(row.sampleTexts).slice(0, MAX_LIST_ITEMS),
      }
    })
    .filter((group) => group.sampleTexts.length > 0)
    .slice(0, MAX_REPEATED_GROUPS)
}

function readComponents(componentTree: unknown): SourceComponent[] {
  return readArray(componentTree, "components")
    .map((item, index) => {
      const row = asRecord(item)
      const name = readString(row.name) ?? `SourceComponent${index + 1}`
      return {
        name: toComponentName(name, index),
        kind: readString(row.kind),
        tag: readString(row.tag),
        classNames: readStringArray(row.classNames),
        textPreview: readStringArray(row.textPreview).slice(0, 24),
      }
    })
    .slice(0, 80)
}

function readAssetRefs(assetManifest: unknown): SourceAssetRef[] {
  const root = asRecord(assetManifest)
  const assets = Array.isArray(root.assets) ? root.assets : Array.isArray(assetManifest) ? assetManifest : []
  const refs: SourceAssetRef[] = []
  for (const item of assets) {
    const row = asRecord(item)
    const id = readString(row.id)
    const kind = readString(row.kind)
    const assetPath = readString(row.path)
    if (!id || !kind || !assetPath) continue
    const ref: SourceAssetRef = { id, kind, path: assetPath }
    const mime = readString(row.mime)
    const semanticRole = readString(row.semanticRole)
    const preview = sanitizeAssetPreview(readString(row.preview))
    if (mime) ref.mime = mime
    if (semanticRole) ref.semanticRole = semanticRole
    if (preview) ref.preview = preview
    if (typeof row.bytes === "number") ref.bytes = row.bytes
    refs.push(ref)
  }
  return refs.slice(0, MAX_ASSET_REFS)
}

function sanitizeCssSidecar(css: string, extractedAssets: Map<string, ExtractedPublicAsset>): string {
  if (!css) return ""
  return css
    .replace(/url\(\s*(["']?)(data:[^)]+?)\1\s*\)/gi, (_match, _quote: string, dataUrl: string) => {
      const asset = extractDataUrlAsset(dataUrl, extractedAssets)
      return asset ? `url("/${asset.relativePath}")` : "url(\"\")"
    })
    .replace(/data:[^"')\s]+/gi, "")
}

function extractDataUrlAsset(
  dataUrl: string,
  extractedAssets: Map<string, ExtractedPublicAsset>,
): ExtractedPublicAsset | undefined {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) return undefined
  const hash = createHash("sha256").update(parsed.bytes).digest("hex").slice(0, 16)
  const ext = extensionForMime(parsed.mime)
  const relativePath = `assets/extracted/${hash}.${ext}`
  const existing = extractedAssets.get(relativePath)
  if (existing) return existing
  const asset = { relativePath, bytes: parsed.bytes }
  extractedAssets.set(relativePath, asset)
  return asset
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | undefined {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(dataUrl.trim())
  if (!match) return undefined
  const mime = match[1] || "application/octet-stream"
  const isBase64 = Boolean(match[2])
  try {
    const bytes = isBase64
      ? Buffer.from(match[3] ?? "", "base64")
      : Buffer.from(decodeURIComponent(match[3] ?? ""), "utf8")
    return { mime, bytes }
  } catch {
    return undefined
  }
}

function extensionForMime(mime: string): string {
  const normalized = mime.toLowerCase().split(";")[0]?.trim()
  if (normalized === "image/svg+xml") return "svg"
  if (normalized === "image/png") return "png"
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg"
  if (normalized === "image/webp") return "webp"
  if (normalized === "image/gif") return "gif"
  if (normalized === "image/avif") return "avif"
  if (normalized === "font/woff2") return "woff2"
  if (normalized === "font/woff") return "woff"
  return "bin"
}

function sanitizeAssetPreview(preview: string | undefined): string | undefined {
  if (!preview) return undefined
  if (/data:/i.test(preview)) return undefined
  return preview
}

function renderPackageJson(packageName: string): string {
  return `${JSON.stringify({
    name: packageName,
    private: true,
    version: "0.0.0",
    type: "module",
    scripts: {
      dev: "vite --host 127.0.0.1",
      typecheck: "tsc --noEmit",
      build: "vite build",
      preview: "vite preview --host 127.0.0.1",
    },
    packageManager: "bun@1.3.14",
    dependencies: {
      "@vitejs/plugin-react": "^5.0.0",
      typescript: "^5.8.0",
      vite: "^7.0.0",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
    },
    devDependencies: {},
  }, null, 2)}\n`
}

function renderTsconfigJson(): string {
  return `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      useDefineForClassFields: true,
      lib: ["DOM", "DOM.Iterable", "ES2022"],
      allowJs: false,
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      strict: true,
      forceConsistentCasingInFileNames: true,
      module: "ESNext",
      moduleResolution: "Bundler",
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: "react-jsx",
    },
    include: ["src"],
  }, null, 2)}\n`
}

function renderIndexHtml(documentContext: DocumentContext): string {
  return [
    "<!doctype html>",
    `<html${renderHtmlAttributes(documentContext.htmlAttrs)}>`,
    "  <head>",
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    "    <title>Web Clone Source Project</title>",
    "  </head>",
    `  <body${renderHtmlAttributes(documentContext.bodyAttrs)}>`,
    '    <div id="root"></div>',
    '    <script type="module" src="/src/main.tsx"></script>',
    "  </body>",
    "</html>",
    "",
  ].join("\n")
}

function renderHtmlAttributes(attrs: Record<string, string>): string {
  const parts = Object.entries(attrs)
    .filter(([name, value]) => Boolean(toJsxAttributeName(name)) && value.trim().length > 0)
    .map(([name, value]) => ` ${name}="${escapeHtmlAttribute(value)}"`)
  return parts.join("")
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function renderMainTsx(): string {
  return [
    'import { StrictMode } from "react"',
    'import { createRoot } from "react-dom/client"',
    'import "./styles.css"',
    'import App from "./App"',
    "",
    'createRoot(document.getElementById("root")!).render(',
    "  <StrictMode>",
    "    <App />",
    "  </StrictMode>,",
    ")",
    "",
  ].join("\n")
}

function renderAppTsx(): string {
  return [
    'import { SourceClonePage } from "./components/SourceClonePage"',
    "",
    "export default function App() {",
    "  return <SourceClonePage />",
    "}",
    "",
  ].join("\n")
}

function renderSourceClonePageTsx(): string {
  return [
    'import { SourceDomPage } from "./SourceDomPage"',
    'import { sourceComponents, sourceTables } from "../data/sourceData"',
    "",
    "export function SourceClonePage() {",
    "  const sourceComponentNames = sourceComponents.map((component) => component.name).join(' ')",
    "  const tableCount = sourceTables.map((table) => table.rows.length).reduce((sum, count) => sum + count, 0)",
    "  return (",
    '    <SourceDomPage sourceComponentNames={sourceComponentNames} tableCount={tableCount} />',
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSourceDomPageTsx(
  sourceSkeleton: string,
  previewImagePaths: string[],
  nodeStyleFallbacks: Map<string, string>,
  irChildrenByNodeId: Map<string, DomNode[]>,
): string {
  return [
    'import { AssetPath } from "./AssetPath"',
    "",
    "export interface SourceDomPageProps {",
    "  sourceComponentNames: string",
    "  tableCount: number",
    "}",
    "",
    "export function SourceDomPage({ sourceComponentNames, tableCount }: SourceDomPageProps) {",
    "  return (",
    '    <div className="source-dom-page theme-light feature-no-touch" data-theme="light" data-source-component-names={sourceComponentNames} data-source-table-count={tableCount}>',
    ...renderSkeletonBodyJsx(sourceSkeleton, 3, previewImagePaths, nodeStyleFallbacks, irChildrenByNodeId),
    "    </div>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderAssetPathTsx(): string {
  return [
    'import { SVGProps } from "react"',
    'import { svgPaths } from "../data/svgPaths"',
    "",
    "export function AssetPath({ assetPath, fill, ...props }: SVGProps<SVGPathElement> & { assetPath: string }) {",
    "  const d = svgPaths[normalizeAssetPath(assetPath)] ?? ''",
    "  return <path {...props} fill={fill ?? 'currentColor'} d={d} />",
    "}",
    "",
    "function normalizeAssetPath(assetPath: string): string {",
    "  return assetPath.replaceAll('\\\\', '/').replace(/^\\.\\.\\//, '').replace(/^\\.\\//, '')",
    "}",
    "",
  ].join("\n")
}

function renderSkeletonBodyJsx(
  sourceSkeleton: string,
  indentLevel: number,
  previewImagePaths: string[],
  nodeStyleFallbacks: Map<string, string>,
  irChildrenByNodeId: Map<string, DomNode[]>,
): string[] {
  const document = parseDocument(sourceSkeleton, {
    lowerCaseAttributeNames: false,
    lowerCaseTags: false,
    recognizeSelfClosing: true,
  }) as DomNode
  const body = findFirstElement(document, "body")
  const children = body?.children ?? document.children ?? []
  const context = { previewImagePaths, previewImageIndex: 0, nodeStyleFallbacks, irChildrenByNodeId }
  const rendered = children.flatMap((child) => renderDomNodeJsx(child, indentLevel, context))
  return rendered.length > 0 ? rendered : [`${indent(indentLevel)}<main />`]
}

function findFirstElement(node: DomNode, tagName: string): DomNode | undefined {
  if (node.type === "tag" && node.name?.toLowerCase() === tagName.toLowerCase()) return node
  for (const child of node.children ?? []) {
    const found = findFirstElement(child, tagName)
    if (found) return found
  }
  return undefined
}

function renderDomNodeJsx(
  node: DomNode,
  indentLevel: number,
  context: {
    previewImagePaths: string[]
    previewImageIndex: number
    nodeStyleFallbacks: Map<string, string>
    irChildrenByNodeId: Map<string, DomNode[]>
  },
): string[] {
  if (node.type === "text") {
    const text = normalizeTextNode(node.data ?? "")
    return text ? [`${indent(indentLevel)}{${JSON.stringify(text)}}`] : []
  }
  if (node.type !== "tag" && node.type !== "script" && node.type !== "style") return []
  const tag = node.name ?? "div"
  if (tag.toLowerCase() === "script" || tag.toLowerCase() === "style") return []
  const mergedChildren = mergeDomChildrenBySourceId(node.children ?? [], node.attribs?.["data-source-node-id"]
    ? context.irChildrenByNodeId.get(node.attribs["data-source-node-id"]) ?? []
    : [])
  let children = mergedChildren.flatMap((child) => renderDomNodeJsx(child, indentLevel + 1, context))
  const previewImage = renderMissingPreviewImage(node, indentLevel + 1, context)
  if (previewImage) children.unshift(previewImage)
  const attrText = renderJsxAttributes(tag, node.attribs ?? {}, context.nodeStyleFallbacks)
  const componentTag = toJsxTagName(tag, tag.toLowerCase() === "path" && Boolean(node.attribs?.["data-asset-d"]))
  const open = `${indent(indentLevel)}<${componentTag}${attrText ? ` ${attrText}` : ""}`
  if (VOID_TAGS.has(tag.toLowerCase()) || children.length === 0) return [`${open} />`]
  return [
    `${open}>`,
    ...children,
    `${indent(indentLevel)}</${componentTag}>`,
  ]
}

function mergeDomChildrenBySourceId(skeletonChildren: DomNode[], irChildren: DomNode[]): DomNode[] {
  if (irChildren.length === 0) return skeletonChildren
  if (skeletonChildren.length === 0) return irChildren

  const skeletonById = new Map<string, DomNode>()
  for (const child of skeletonChildren) {
    const id = child.attribs?.["data-source-node-id"]
    if (id) skeletonById.set(id, child)
  }
  if (skeletonById.size === 0) return skeletonChildren

  const merged: DomNode[] = []
  const consumedSkeleton = new Set<DomNode>()
  for (const irChild of irChildren) {
    const id = irChild.attribs?.["data-source-node-id"]
    const skeletonChild = id ? skeletonById.get(id) : undefined
    if (skeletonChild) {
      merged.push(skeletonChild)
      consumedSkeleton.add(skeletonChild)
      continue
    }
    if (isRenderableIrElement(irChild)) merged.push(irChild)
  }
  for (const child of skeletonChildren) {
    if (!consumedSkeleton.has(child)) merged.push(child)
  }
  return merged
}

function isRenderableIrElement(node: DomNode): boolean {
  if (node.type !== "tag") return false
  const tag = node.name?.toLowerCase() ?? ""
  return Boolean(tag) && tag !== "script" && tag !== "style" && tag !== "meta" && tag !== "link" && tag !== "title"
}

function renderMissingPreviewImage(
  node: DomNode,
  indentLevel: number,
  context: { previewImagePaths: string[]; previewImageIndex: number },
): string | undefined {
  const className = node.attribs?.class ?? ""
  if (!/\bpreview-fSver7BK\b/.test(className)) return undefined
  if (containsClass(node, "image-fSver7BK")) return undefined
  const imagePath = context.previewImagePaths[context.previewImageIndex++]
  if (!imagePath) return undefined
  return `${indent(indentLevel)}<img className="image-fSver7BK" src={${JSON.stringify(imagePath)}} alt="" />`
}

function containsClass(node: DomNode, className: string): boolean {
  if (node.attribs?.class?.split(/\s+/).includes(className)) return true
  return (node.children ?? []).some((child) => containsClass(child, className))
}

function renderJsxAttributes(tag: string, attribs: Record<string, string>, nodeStyleFallbacks: Map<string, string>): string {
  const parts: string[] = []
  const isAssetPath = tag.toLowerCase() === "path" && Boolean(attribs["data-asset-d"])
  const fallbackStyle = attribs["data-source-node-id"]
    ? nodeStyleFallbacks.get(attribs["data-source-node-id"])
    : undefined
  let hasStyle = false
  for (const [rawName, rawValue] of Object.entries(attribs)) {
    if (isAssetPath && rawName === "data-asset-d") {
      parts.push(`assetPath={${JSON.stringify(normalizeAssetPath(rawValue))}}`)
      continue
    }
    if (rawName === "data-asset-d") continue
    const name = toJsxAttributeName(rawName)
    if (!name) continue
    if (name === "style") {
      hasStyle = true
      const style = renderStyleObject(fallbackStyle ? `${rawValue};${fallbackStyle}` : rawValue)
      if (style) parts.push(`style={${style}}`)
      continue
    }
    const value = (name === "src" || name === "href" || name === "xlinkHref")
      ? normalizeReferencedAssetUrl(rawValue)
      : rawValue
    parts.push(`${name}={${JSON.stringify(value)}}`)
  }
  if (fallbackStyle && !hasStyle) {
    const style = renderStyleObject(fallbackStyle)
    if (style) parts.push(`style={${style}}`)
  }
  return parts.join(" ")
}

function toJsxAttributeName(name: string): string | undefined {
  if (/^on/i.test(name)) return undefined
  if (name === "class") return "className"
  if (name === "for") return "htmlFor"
  if (name === "charset") return "charSet"
  if (name === "http-equiv") return "httpEquiv"
  if (name === "xlink:href") return "xlinkHref"
  const mappedSvg = SVG_ATTRIBUTE_MAP[name]
  if (mappedSvg) return mappedSvg
  if (/^(data|aria)-[a-zA-Z0-9_.:-]+$/.test(name)) return name
  if (/^[A-Za-z_$][\w$]*$/.test(name)) return name
  return undefined
}

function renderStyleObject(style: string): string | undefined {
  const entries = style
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const colon = part.indexOf(":")
      if (colon < 1) return undefined
      const key = part.slice(0, colon).trim()
      const value = part.slice(colon + 1).trim().replace(/\s*!important\s*$/i, "")
      if (!key || !value) return undefined
      return `${JSON.stringify(toStyleKey(key))}: ${JSON.stringify(value)}`
    })
    .filter((entry): entry is string => Boolean(entry))
  return entries.length > 0 ? `{ ${entries.join(", ")} }` : undefined
}

function toStyleKey(name: string): string {
  if (name.startsWith("--")) return name
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

function normalizeAssetPath(value: string): string {
  return value.replaceAll("\\", "/")
}

function normalizeReferencedAssetUrl(value: string): string {
  const normalized = value.replaceAll("\\", "/")
  if (/^(?:https?:|mailto:|tel:|#)/i.test(normalized)) return normalized
  const assetMatch = /^\.\.\/assets\/(.+?)\.txt$/i.exec(normalized)
  if (assetMatch) return `/assets/${assetMatch[1]}`
  if (normalized.startsWith("../assets/")) return `/${normalized.slice(3)}`
  return normalized
}

function normalizeTextNode(value: string): string | undefined {
  const decoded = decodeEntities(value)
  const collapsed = decoded.replace(/\s+/g, " ")
  return collapsed.trim().length > 0 ? collapsed : undefined
}

function indent(level: number): string {
  return "  ".repeat(level)
}

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
])

const SVG_ATTRIBUTE_MAP: Record<string, string> = {
  "accent-height": "accentHeight",
  "alignment-baseline": "alignmentBaseline",
  "baseline-shift": "baselineShift",
  "clip-path": "clipPath",
  "clip-rule": "clipRule",
  "color-interpolation": "colorInterpolation",
  "color-interpolation-filters": "colorInterpolationFilters",
  "color-profile": "colorProfile",
  "color-rendering": "colorRendering",
  "dominant-baseline": "dominantBaseline",
  "enable-background": "enableBackground",
  "fill-opacity": "fillOpacity",
  "fill-rule": "fillRule",
  "flood-color": "floodColor",
  "flood-opacity": "floodOpacity",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-size-adjust": "fontSizeAdjust",
  "font-stretch": "fontStretch",
  "font-style": "fontStyle",
  "font-variant": "fontVariant",
  "font-weight": "fontWeight",
  "glyph-name": "glyphName",
  "glyph-orientation-horizontal": "glyphOrientationHorizontal",
  "glyph-orientation-vertical": "glyphOrientationVertical",
  "horiz-adv-x": "horizAdvX",
  "horiz-origin-x": "horizOriginX",
  "image-rendering": "imageRendering",
  "letter-spacing": "letterSpacing",
  "lighting-color": "lightingColor",
  "marker-end": "markerEnd",
  "marker-mid": "markerMid",
  "marker-start": "markerStart",
  "overline-position": "overlinePosition",
  "overline-thickness": "overlineThickness",
  "paint-order": "paintOrder",
  "panose-1": "panose1",
  "pointer-events": "pointerEvents",
  "rendering-intent": "renderingIntent",
  "shape-rendering": "shapeRendering",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "strikethrough-position": "strikethroughPosition",
  "strikethrough-thickness": "strikethroughThickness",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-opacity": "strokeOpacity",
  "stroke-width": "strokeWidth",
  "text-anchor": "textAnchor",
  "text-decoration": "textDecoration",
  "text-rendering": "textRendering",
  "underline-position": "underlinePosition",
  "underline-thickness": "underlineThickness",
  "unicode-bidi": "unicodeBidi",
  "unicode-range": "unicodeRange",
  "units-per-em": "unitsPerEm",
  "v-alphabetic": "vAlphabetic",
  "v-hanging": "vHanging",
  "v-ideographic": "vIdeographic",
  "v-mathematical": "vMathematical",
  "vector-effect": "vectorEffect",
  "vert-adv-y": "vertAdvY",
  "vert-origin-x": "vertOriginX",
  "vert-origin-y": "vertOriginY",
  "word-spacing": "wordSpacing",
  "writing-mode": "writingMode",
}

const SVG_TAG_NAME_MAP: Record<string, string> = {
  altglyph: "altGlyph",
  altglyphdef: "altGlyphDef",
  altglyphitem: "altGlyphItem",
  animatecolor: "animateColor",
  animatemotion: "animateMotion",
  animatetransform: "animateTransform",
  clippath: "clipPath",
  feblend: "feBlend",
  fecolormatrix: "feColorMatrix",
  fecomponenttransfer: "feComponentTransfer",
  fecomposite: "feComposite",
  feconvolvematrix: "feConvolveMatrix",
  fediffuselighting: "feDiffuseLighting",
  fedisplacementmap: "feDisplacementMap",
  fedistantlight: "feDistantLight",
  fedropshadow: "feDropShadow",
  feflood: "feFlood",
  fefunca: "feFuncA",
  fefuncb: "feFuncB",
  fefuncg: "feFuncG",
  fefuncr: "feFuncR",
  fegaussianblur: "feGaussianBlur",
  feimage: "feImage",
  femerge: "feMerge",
  femergenode: "feMergeNode",
  femorphology: "feMorphology",
  feoffset: "feOffset",
  fepointlight: "fePointLight",
  fespecularlighting: "feSpecularLighting",
  fespotlight: "feSpotLight",
  fetile: "feTile",
  feturbulence: "feTurbulence",
  foreignobject: "foreignObject",
  glyphref: "glyphRef",
  lineargradient: "linearGradient",
  radialgradient: "radialGradient",
  textpath: "textPath",
}

function toJsxTagName(tag: string, isAssetPath: boolean): string {
  if (isAssetPath) return "AssetPath"
  return SVG_TAG_NAME_MAP[tag.toLowerCase()] ?? tag
}

function renderContentTableTsx(): string {
  return [
    "export interface SourceTable {",
    "  title?: string",
    "  headers: string[]",
    "  rows: string[][]",
    "}",
    "",
    "export function ContentTable({ table }: { table: SourceTable }) {",
    "  const columnCount = Math.max(table.headers.length, ...table.rows.map((row) => row.length), 1)",
    "  return (",
    '    <article className="web-clone-table">',
    "      <h2>{table.title}</h2>",
    "      <table>",
    "        {table.headers.length > 0 && (",
    "          <thead>",
    "            <tr>",
    "              {table.headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}",
    "            </tr>",
    "          </thead>",
    "        )}",
    "        <tbody>",
    "          {table.rows.map((row, rowIndex) => (",
    "            <tr key={row.join('|') || rowIndex}>",
    "              {Array.from({ length: columnCount }, (_, columnIndex) => (",
    "                <td key={columnIndex}>{row[columnIndex] ?? ''}</td>",
    "              ))}",
    "            </tr>",
    "          ))}",
    "        </tbody>",
    "      </table>",
    "    </article>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSourceDataTs(data: SourceProjectData): string {
  return [
    "export const sourceTextSignals = " + JSON.stringify(data.textSignals, null, 2) + " as const",
    "",
    "export const sourceComponents = " + JSON.stringify(data.components, null, 2) + " as const",
    "",
    "export const sourceTables = " + JSON.stringify(data.tables, null, 2) + " as const",
    "",
    "export const sourceLists = " + JSON.stringify(data.lists, null, 2) + " as const",
    "",
    "export const sourceCards = " + JSON.stringify(data.cards, null, 2) + " as const",
    "",
    "export const sourceRepeatedGroups = " + JSON.stringify(data.repeatedGroups, null, 2) + " as const",
    "",
    "export const sourceAssets = " + JSON.stringify(data.assets, null, 2) + " as const",
    "",
  ].join("\n")
}

function renderSvgPathsTs(paths: Record<string, string>): string {
  return [
    "export const svgPaths: Record<string, string> = " + JSON.stringify(paths, null, 2),
    "",
  ].join("\n")
}

function renderStylesCss(input: { hasCriticalCss: boolean; hasFullCss: boolean }): string {
  return [
    input.hasCriticalCss ? '@import "./styles/source-critical.css";' : "",
    input.hasFullCss ? '@import "./styles/source-full.css";' : "",
    "",
    "html, body, #root { margin: 0; min-width: 320px; }",
    ".source-dom-page { min-height: 100vh; }",
    "",
    ".source-dom-page .map-PucT6CA9 svg path { fill: currentColor; }",
    ".source-dom-page .mapContainer-PucT6CA9[data-color-preset=color-heatmap-tan-orange] { --color-xs: var(--color-heatmap-tan-orange-xs, #fff0d1); --color-s: var(--color-heatmap-tan-orange-s, #ffd08a); --color-m: var(--color-heatmap-tan-orange-m, #ffb04d); --color-l: var(--color-heatmap-tan-orange-l, #ff8a1f); --color-xl: var(--color-heatmap-tan-orange-xl, #f05a24); --color-xxl: var(--color-heatmap-tan-orange-xxl, #d83b1d); --color-disabled-country: var(--color-heatmap-tan-orange-empty, #f4f6f8); --map-stroke-color: var(--color-heatmap-tan-orange-border, #ffffff); }",
    ".source-dom-page .mapContainer-PucT6CA9[data-color-preset=color-heatmap-tv-blue] { --color-xs: var(--color-heatmap-tv-blue-xs, #d8ecff); --color-s: var(--color-heatmap-tv-blue-s, #9dccff); --color-m: var(--color-heatmap-tv-blue-m, #5c9dff); --color-l: var(--color-heatmap-tv-blue-l, #2962ff); --color-xl: var(--color-heatmap-tv-blue-xl, #174de5); --color-xxl: var(--color-heatmap-tv-blue-xxl, #0b35a8); --color-disabled-country: var(--color-heatmap-tv-blue-empty, #edf5ff); --map-stroke-color: var(--color-heatmap-tv-blue-border, #ffffff); }",
    ".source-dom-page .tableContainer-qfaqwkY6 { --cross-table-bg-color-cell-positive-xl: var(--color-heatmap-range-light-positive-xl, #008fa3); --cross-table-bg-color-cell-positive-l: var(--color-heatmap-range-light-positive-l, #16b8c7); --cross-table-bg-color-cell-positive-m: var(--color-heatmap-range-light-positive-m, #63d7df); --cross-table-bg-color-cell-positive-s: var(--color-heatmap-range-light-positive-s, #b8eef1); --cross-table-bg-color-cell-neutral: var(--color-heatmap-classic-light-neutral, #ffffff); --cross-table-bg-color-cell-negative-s: var(--color-heatmap-range-light-negative-s, #ffe0a3); --cross-table-bg-color-cell-negative-m: var(--color-heatmap-range-light-negative-m, #ffc04f); --cross-table-bg-color-cell-negative-l: var(--color-heatmap-range-light-negative-l, #ff9a1f); --cross-table-bg-color-cell-negative-xl: var(--color-heatmap-range-light-negative-xl, #f46a1f); }",
    "",
  ].filter(Boolean).join("\n")
}

function renderReadme(mirrorDir: string): string {
  return [
    "# Web Clone Source Project",
    "",
    "This project is generated from a mirror source-skeleton handoff. It is an editable implementation scaffold, not an acceptance result.",
    "",
    "Inputs consumed:",
    "- `source-skeleton/index.html` for visible text and DOM order hints",
    "- `source-skeleton/critical.css` and `source-skeleton/full-source.css` for CSS sidecars",
    "- `source-ir/content-model.json` for tables, lists, cards, and repeated groups",
    "- `source-ir/component-tree.json` for component boundary hints",
    "- `assets/manifest.json` for sidecar asset references",
    "",
    "Required gates before acceptance:",
    "- Run `web_clone_source_audit` against this project and the visible source package.",
    "- Render the app and compare it against the visual reference with the webpage visual evaluator.",
    "- Do not edit generated output by hand to pass the score; improve the generator or the downstream implementation prompts.",
    "",
    `Mirror source: ${mirrorDir}`,
    "",
  ].join("\n")
}

function collectVisibleStrings(value: unknown, key = ""): string[] {
  const visibleKeys = new Set(["alt", "fields", "headers", "items", "label", "rows", "sampleTexts", "text", "textPreview", "title", "value"])
  if (typeof value === "string") return visibleKeys.has(key) ? [value] : []
  if (Array.isArray(value)) return value.flatMap((item) => collectVisibleStrings(item, key))
  if (!value || typeof value !== "object") return []
  return Object.entries(value as Record<string, unknown>).flatMap(([childKey, child]) => collectVisibleStrings(child, childKey))
}

function collectSkeletonText(html: string): string[] {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  return Array.from(withoutScripts.matchAll(/>([^<>]{2,180})</g), (match) => decodeEntities(match[1] ?? ""))
}

function rankTextSignals(values: string[]): string[] {
  const unique = Array.from(new Set(values.map(canonicalText).filter((value): value is string => Boolean(value))))
  return unique
    .filter((value) => value.length >= 3 && value.length <= 120)
    .filter((value) => !/^https?:\/\//i.test(value))
    .map((value) => ({ value, score: textSignalScore(value) }))
    .sort((a, b) => b.score - a.score || a.value.length - b.value.length)
    .map((item) => item.value)
}

function textSignalScore(value: string): number {
  let score = Math.min(value.length, 40)
  if (/\d/.test(value)) score += 40
  if (/[A-Za-z]\s+[A-Za-z]/.test(value)) score += 20
  if (/[.%$€¥£]/.test(value)) score += 12
  if (value.length <= 24) score += 8
  return score
}

function canonicalText(value: string): string | undefined {
  const normalized = decodeEntities(value).replace(/\s+/g, " ").trim()
  if (!normalized) return undefined
  if (/^__WEB_CLONE_[A-Z_]+_\d+__$/.test(normalized)) return undefined
  if (/^[{}[\],:;./\\|_-]+$/.test(normalized)) return undefined
  return normalized
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => readString(item)).filter((item): item is string => Boolean(item))
}

function readTableRows(value: unknown): string[][] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => Array.isArray(row) ? row.map((cell) => readString(cell) ?? "") : [])
    .filter((row) => row.some((cell) => cell.length > 0))
}

function readArray(value: unknown, key: string): unknown[] {
  const row = asRecord(value)
  return Array.isArray(row[key]) ? row[key] as unknown[] : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? decodeEntities(value).replace(/\s+/g, " ").trim() : undefined
}

function toComponentName(name: string, index: number): string {
  const normalized = name
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
  if (!normalized) return `SourceComponent${index + 1}`
  return /^[A-Za-z]/.test(normalized) ? normalized : `SourceComponent${normalized}`
}

function normalizePackageName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")
  return normalized || "web-clone-source-project"
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
}

async function assertMirrorInputs(mirrorDir: string): Promise<void> {
  const required = [
    path.join(mirrorDir, "source-skeleton", "index.html"),
    path.join(mirrorDir, "source-ir", "content-model.json"),
    path.join(mirrorDir, "source-ir", "component-tree.json"),
  ]
  const missing: string[] = []
  for (const file of required) {
    if (!await exists(file)) missing.push(file)
  }
  if (missing.length > 0) throw new Error(`Mirror source-project inputs are missing: ${missing.join(", ")}`)
}

async function prepareOutputDir(outputDir: string, overwrite: boolean): Promise<void> {
  if (await exists(outputDir)) {
    const entries = await fs.readdir(outputDir)
    if (entries.length > 0 && !overwrite) {
      throw new Error(`Output directory is not empty: ${outputDir}. Pass overwrite=true to replace it.`)
    }
    if (entries.length > 0) await fs.rm(outputDir, { recursive: true, force: true })
  }
  await fs.mkdir(outputDir, { recursive: true })
}

async function copyPublicAssets(
  mirrorDir: string,
  outputDir: string,
  extractedAssets: Map<string, ExtractedPublicAsset>,
): Promise<void> {
  const sourceSvgDir = path.join(mirrorDir, "assets", "svg")
  const sourceImagesDir = path.join(mirrorDir, "assets", "images")
  const targetAssetsDir = path.join(outputDir, "public", "assets")
  const targetSvgDir = path.join(targetAssetsDir, "svg")
  await fs.rm(targetAssetsDir, { recursive: true, force: true })
  if (await exists(sourceSvgDir)) {
    await fs.cp(sourceSvgDir, targetSvgDir, { recursive: true })
  }
  if (await exists(sourceImagesDir)) {
    await copyDecodedImageAssets(sourceImagesDir, path.join(targetAssetsDir, "images"))
  }
  for (const asset of extractedAssets.values()) {
    await fs.mkdir(path.dirname(path.join(outputDir, "public", asset.relativePath)), { recursive: true })
    await fs.writeFile(path.join(outputDir, "public", asset.relativePath), asset.bytes)
  }
}

async function copyDecodedImageAssets(sourceDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true })
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".txt")) continue
    const sourcePath = path.join(sourceDir, entry.name)
    const text = await readOptionalText(sourcePath)
    const parsed = parseDataUrl(text.trim())
    if (!parsed) continue
    const targetName = entry.name.replace(/\.txt$/i, "")
    await fs.writeFile(path.join(targetDir, targetName), parsed.bytes)
  }
}

async function readPreviewImagePaths(mirrorDir: string): Promise<string[]> {
  const imagesDir = path.join(mirrorDir, "assets", "images")
  if (!await exists(imagesDir)) return []
  const entries = await fs.readdir(imagesDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && /\.webp\.txt$/i.test(entry.name))
    .map((entry) => entry.name.replace(/\.txt$/i, ""))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .filter((name) => /\.webp$/i.test(name))
    .map((name) => `/assets/images/${name}`)
}

async function readSvgPathData(mirrorDir: string): Promise<Record<string, string>> {
  const svgDir = path.join(mirrorDir, "assets", "svg")
  if (!await exists(svgDir)) return {}
  const entries = await fs.readdir(svgDir, { withFileTypes: true })
  const result: Record<string, string> = {}
  for (const entry of entries) {
    if (!entry.isFile() || !/\.path\.txt$/i.test(entry.name)) continue
    const text = (await readOptionalText(path.join(svgDir, entry.name))).trim()
    if (!text) continue
    result[`assets/svg/${entry.name}`] = text
  }
  return result
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf8")
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8")
}

async function readOptionalText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch {
    return ""
  }
}

async function readJsonOptional(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"))
  } catch {
    return undefined
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
