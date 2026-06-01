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

interface SourceDomRenderProject {
  sourceDomPage: string
  regionFiles: Map<string, string>
  regionMetrics: SourceDomRegionMetric[]
  svgAssetGroups: Map<string, SourceSvgAssetGroupItem[]>
  faqGroups: Map<string, SourceFaqGroup>
}

interface SourceDomRegionMetric {
  componentName: string
  filePath: string
  sourceNodeId?: string
  sourceSegmentId?: string
  tag: string
  heading?: string
  textPreview: string
  elementCount: number
  bytes: number
  replacementPriority: "low" | "medium" | "high"
}

interface SourceDomReplacementPlanItem {
  regionComponentName: string
  regionFilePath: string
  priority: SourceDomRegionMetric["replacementPriority"]
  recommendedComponentName: string
  replacementKind:
    | "map_or_chart_asset_component"
    | "data_table_or_heatmap_component"
    | "card_collection_component"
    | "faq_disclosure_component"
    | "navigation_or_footer_component"
    | "event_or_news_list_component"
    | "baseline_defer"
  problem: string
  reusableSources: string[]
  dataSources: string[]
  assetSources: string[]
  firstReplacementStep: string
  parityGuard: string
}

interface SourceSvgAssetGroupItem {
  assetPath: string
  [attribute: string]: unknown
}

interface SourceFaqGroup {
  title: string
  titleId?: string
  classes: {
    container: string
    header: string
    headerWrapper: string
    titleAndHintWrapper: string
    titleContainer: string
    title: string
    content: string
    wrapper: string
    column: string
    item: string
    summary: string
    summaryLine: string
    background: string
    summaryText: string
    iconPresentation: string
    iconWrapper: string
    iconHorizontal: string
    iconVertical: string
    detailsWrapper: string
    details: string
  }
  dataAttributes: {
    containerName?: string
    widgetId?: string
    contentQaId?: string
  }
  columns: SourceFaqItem[][]
}

interface SourceFaqItem {
  question: string
  answerText: string
  links: Array<{ href: string; label: string }>
  order?: string
  itemClassName?: string
  summaryId?: string
  detailsId?: string
}

interface SourceDomRenderContext {
  previewImagePaths: string[]
  previewImageIndex: number
  nodeStyleFallbacks: Map<string, string>
  irChildrenByNodeId: Map<string, DomNode[]>
  regionFiles: Map<string, string>
  regionMetrics: SourceDomRegionMetric[]
  regionNameCounts: Map<string, number>
  svgAssetGroups: Map<string, SourceSvgAssetGroupItem[]>
  svgAssetGroupCount: number
  faqGroups: Map<string, SourceFaqGroup>
  faqGroupCount: number
  currentImports: Set<string>
  currentSvgAssetGroupNames: Set<string>
  currentImportPrefix: string
  extractRegions: boolean
  regionDepth: number
  maxRegionDepth: number
  maxRegionCount: number
}

const MAX_TEXT_SIGNALS = 160
const MAX_TABLES = 24
const MAX_TABLE_ROWS = 80
const MAX_LISTS = 24
const MAX_LIST_ITEMS = 80
const MAX_CARDS = 48
const MAX_REPEATED_GROUPS = 48
const MAX_ASSET_REFS = 240
const MIN_SVG_ASSET_GROUP_SIZE = 16

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
  const sourceDomProject = renderSourceDomProject(sourceSkeleton, previewImagePaths, nodeStyleFallbacks, irChildrenByNodeId)
  const replacementPlan = buildSourceDomReplacementPlan(sourceDomProject.regionMetrics, projectData)

  const packageName = normalizePackageName(input.packageName ?? `web-clone-${path.basename(outputDir)}`)
  const files = new Map<string, string>()
  files.set("package.json", renderPackageJson(packageName))
  files.set("tsconfig.json", renderTsconfigJson())
  files.set("index.html", renderIndexHtml(documentContext))
  files.set("README.md", renderReadme(mirrorDir))
  files.set("src/vite-env.d.ts", renderViteEnvDts())
  files.set("src/main.tsx", renderMainTsx())
  files.set("src/App.tsx", renderAppTsx())
  files.set("src/components/SourceClonePage.tsx", renderSourceClonePageTsx())
  files.set("src/components/SourceDomPage.tsx", sourceDomProject.sourceDomPage)
  for (const [relativePath, content] of sourceDomProject.regionFiles) files.set(relativePath, content)
  files.set("src/components/AssetPath.tsx", renderAssetPathTsx())
  files.set("src/components/SourceAssetPathGroup.tsx", renderSourceAssetPathGroupTsx())
  files.set("src/components/SourceFaqList.tsx", renderSourceFaqListTsx())
  files.set("src/components/ContentTable.tsx", renderContentTableTsx())
  files.set("src/data/sourceDomRegions.ts", renderSourceDomRegionsTs(sourceDomProject.regionMetrics))
  files.set("src/data/sourceDomReplacementPlan.ts", renderSourceDomReplacementPlanTs(replacementPlan))
  files.set("src/data/sourceSvgAssetGroups.ts", renderSourceSvgAssetGroupsTs(sourceDomProject.svgAssetGroups))
  files.set("src/data/sourceFaqGroups.ts", renderSourceFaqGroupsTs(sourceDomProject.faqGroups))
  files.set("src/data/svgPaths.ts", renderSvgPathsTs(svgPaths))
  files.set("src/data/sourceData.ts", renderSourceDataTs(projectData))
  files.set("src/styles.css", renderStylesCss({ hasCriticalCss: criticalCss.length > 0, hasFullCss: fullSourceCss.length > 0 }))
  if (criticalCss.length > 0) files.set("src/styles/source-critical.css", criticalCss)
  if (fullSourceCss.length > 0) files.set("src/styles/source-full.css", fullSourceCss)

  for (const [relativePath, content] of files) {
    await writeFile(path.join(outputDir, relativePath), content)
  }
  await copyPublicAssets(mirrorDir, outputDir, extractedAssets)
  const copiedReference = await copyReferenceImage(mirrorDir, outputDir)
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
    sourceDomRegions: {
      count: sourceDomProject.regionMetrics.length,
      largestBytes: Math.max(0, ...sourceDomProject.regionMetrics.map((region) => region.bytes)),
      highPriorityCount: sourceDomProject.regionMetrics.filter((region) => region.replacementPriority === "high").length,
      metricsModule: "src/data/sourceDomRegions.ts",
      replacementPlanModule: "src/data/sourceDomReplacementPlan.ts",
      replacementPlanCount: replacementPlan.length,
      svgAssetGroupModule: "src/data/sourceSvgAssetGroups.ts",
      svgAssetGroupCount: sourceDomProject.svgAssetGroups.size,
      faqGroupModule: "src/data/sourceFaqGroups.ts",
      faqGroupCount: sourceDomProject.faqGroups.size,
    },
    rules: [
      "Use sourceData.ts and framework components as the editable implementation surface.",
      "Do not render reference.png, screenshot files, base64 payloads, or hidden semantic coverage layers as the clone.",
      "Use reference.png only as visual validation evidence with webpage_evaluate or overlay comparison.",
    ],
  })

  const writtenFiles = [
    ...files.keys(),
    "src/data/sourceProjectManifest.json",
    ...(copiedReference ? ["reference.png"] : []),
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
      dev: "bunx vite --host 127.0.0.1",
      typecheck: "bunx tsc --noEmit",
      build: "bunx vite build",
      preview: "bunx vite preview --host 127.0.0.1 --strictPort",
    },
    packageManager: "bun@1.3.14",
    dependencies: {
      "@vitejs/plugin-react": "^5.0.0",
      typescript: "^5.8.0",
      vite: "^7.0.0",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
    },
    devDependencies: {
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
    },
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

function renderViteEnvDts(): string {
  return [
    '/// <reference types="vite/client" />',
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
    "  return (",
    "    <SourceDomPage",
    "      sourceComponentNames={sourceComponents.map((component) => component.name).join(\",\")}",
    "      tableCount={sourceTables.length}",
    "    />",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSourceDomProject(
  sourceSkeleton: string,
  previewImagePaths: string[],
  nodeStyleFallbacks: Map<string, string>,
  irChildrenByNodeId: Map<string, DomNode[]>,
): SourceDomRenderProject {
  const currentImports = new Set<string>()
  const currentSvgAssetGroupNames = new Set<string>()
  const context: SourceDomRenderContext = {
    previewImagePaths,
    previewImageIndex: 0,
    nodeStyleFallbacks,
    irChildrenByNodeId,
    regionFiles: new Map(),
    regionMetrics: [],
    regionNameCounts: new Map(),
    svgAssetGroups: new Map(),
    svgAssetGroupCount: 0,
    faqGroups: new Map(),
    faqGroupCount: 0,
    currentImports,
    currentSvgAssetGroupNames,
    currentImportPrefix: "./source-dom/",
    extractRegions: true,
    regionDepth: 0,
    maxRegionDepth: 6,
    maxRegionCount: 80,
  }
  const bodyLines = renderSkeletonBodyJsx(sourceSkeleton, 3, context)
  const imports = Array.from(currentImports).sort().map((componentName) =>
    `import { ${componentName} } from "./source-dom/${componentName}"`
  )
  const svgAssetGroupImports = currentSvgAssetGroupNames.size > 0
    ? [
        'import { SourceAssetPathGroup } from "./SourceAssetPathGroup"',
        'import { sourceSvgAssetGroups } from "../data/sourceSvgAssetGroups"',
      ]
    : []
  const sourceDomPage = [
    "// @ts-nocheck",
    'import { AssetPath } from "./AssetPath"',
    ...svgAssetGroupImports,
    ...imports,
    "",
    "export interface SourceDomPageProps {",
    "  sourceComponentNames: string",
    "  tableCount: number",
    "}",
    "",
    "export function SourceDomPage({ sourceComponentNames, tableCount }: SourceDomPageProps) {",
    "  return (",
    '    <div className="source-dom-page theme-light feature-no-touch" data-theme="light" data-source-component-names={sourceComponentNames} data-source-table-count={tableCount}>',
    ...bodyLines,
    "    </div>",
    "  )",
    "}",
    "",
  ].join("\n")
  context.regionMetrics.sort((a, b) => b.bytes - a.bytes || a.componentName.localeCompare(b.componentName))
  return {
    sourceDomPage,
    regionFiles: context.regionFiles,
    regionMetrics: context.regionMetrics,
    svgAssetGroups: context.svgAssetGroups,
    faqGroups: context.faqGroups,
  }
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

function renderSourceAssetPathGroupTsx(): string {
  return [
    'import { SVGProps } from "react"',
    'import { AssetPath } from "./AssetPath"',
    'import type { SourceSvgAssetGroupItem } from "../data/sourceSvgAssetGroups"',
    "",
    "export function SourceAssetPathGroup({ items }: { items: readonly SourceSvgAssetGroupItem[] }) {",
    "  return (",
    "    <>",
    "      {items.map((item, index) => (",
    "        <AssetPath",
    "          key={`${item.assetPath}-${typeof item.id === \"string\" ? item.id : index}`}",
    "          {...(item as SVGProps<SVGPathElement> & { assetPath: string })}",
    "        />",
    "      ))}",
    "    </>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSourceFaqListTsx(): string {
  return [
    'import type { CSSProperties } from "react"',
    'import type { SourceFaqGroup, SourceFaqItem } from "../data/sourceFaqGroups"',
    "",
    "export function SourceFaqList({ group }: { group: SourceFaqGroup }) {",
    "  return (",
    "    <div",
    "      data-base-widget=\"true\"",
    "      data-container-name={group.dataAttributes.containerName}",
    "      data-an-widget-id={group.dataAttributes.widgetId}",
    "      className={group.classes.container}",
    "    >",
    "      <div className={group.classes.header}>",
    "        <div className={group.classes.headerWrapper}>",
    "          <span className={group.classes.titleAndHintWrapper}>",
    "            <div className={group.classes.titleContainer}>",
    "              <h2 className={group.classes.title} id={group.titleId}>",
    "                {group.title}",
    "              </h2>",
    "            </div>",
    "          </span>",
    "        </div>",
    "      </div>",
    "      <div className={group.classes.content} data-qa-id={group.dataAttributes.contentQaId}>",
    "        <div className={group.classes.wrapper}>",
    "          {group.columns.map((column, columnIndex) => (",
    "            <div className={group.classes.column} key={`faq-column-${columnIndex}`}>",
    "              {column.map((item, itemIndex) => (",
    "                <SourceFaqItemView",
    "                  group={group}",
    "                  item={item}",
    "                  key={`${item.question}-${itemIndex}`}",
    "                />",
    "              ))}",
    "            </div>",
    "          ))}",
    "        </div>",
    "      </div>",
    "    </div>",
    "  )",
    "}",
    "",
    "function SourceFaqItemView({ group, item }: { group: SourceFaqGroup; item: SourceFaqItem }) {",
    "  const detailsId = item.detailsId ?? `${item.summaryId ?? item.question}-details`",
    "  const itemStyle: CSSProperties | undefined = item.order ? { order: item.order } : undefined",
    "  return (",
    "    <div className={item.itemClassName ?? group.classes.item} style={itemStyle}>",
    "      <button",
    "        className={group.classes.summary}",
    "        id={item.summaryId}",
    "        aria-expanded=\"false\"",
    "        aria-controls={detailsId}",
    "      >",
    "        <div className={group.classes.summaryLine}>",
    "          <span className={group.classes.background} />",
    "          <div className={group.classes.summaryText}>{item.question}</div>",
    "          <div className={group.classes.iconPresentation} role=\"presentation\">",
    "            <div className={group.classes.iconWrapper}>",
    "              <div className={group.classes.iconHorizontal} />",
    "              <div className={group.classes.iconVertical} />",
    "            </div>",
    "          </div>",
    "        </div>",
    "      </button>",
    "      <div className={group.classes.detailsWrapper} id={detailsId}>",
    "        <div className={group.classes.details}>",
    "          {item.answerText}",
    "          {item.links.map((link) => (",
    "            <a href={link.href} key={`${link.href}-${link.label}`}>{link.label}</a>",
    "          ))}",
    "        </div>",
    "      </div>",
    "    </div>",
    "  )",
    "}",
    "",
  ].join("\n")
}

function renderSkeletonBodyJsx(
  sourceSkeleton: string,
  indentLevel: number,
  context: SourceDomRenderContext,
): string[] {
  const document = parseDocument(sourceSkeleton, {
    lowerCaseAttributeNames: false,
    lowerCaseTags: false,
    recognizeSelfClosing: true,
  }) as DomNode
  const body = findFirstElement(document, "body")
  const children = body?.children ?? document.children ?? []
  const rendered = children.flatMap((child) => renderDomChildJsx(child, indentLevel, context, children))
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
  context: SourceDomRenderContext,
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
  let children = renderDomChildrenJsx(mergedChildren, indentLevel + 1, context)
  const previewImage = renderMissingPreviewImage({ ...node, children: mergedChildren }, indentLevel + 1, context)
  if (previewImage) children.unshift(previewImage)
  const attrText = renderJsxAttributes(tag, rewriteImagePlaceholderAttributes(tag, node.attribs ?? {}, context), context.nodeStyleFallbacks)
  const componentTag = toJsxTagName(tag, tag.toLowerCase() === "path" && Boolean(node.attribs?.["data-asset-d"]))
  const open = `${indent(indentLevel)}<${componentTag}${attrText ? ` ${attrText}` : ""}`
  if (VOID_TAGS.has(tag.toLowerCase()) || children.length === 0) return [`${open} />`]
  return [
    `${open}>`,
    ...children,
    `${indent(indentLevel)}</${componentTag}>`,
  ]
}

function renderDomChildrenJsx(
  children: DomNode[],
  indentLevel: number,
  context: SourceDomRenderContext,
): string[] {
  const rendered: string[] = []
  let assetPathRun: DomNode[] = []

  const flushAssetPathRun = () => {
    if (assetPathRun.length >= MIN_SVG_ASSET_GROUP_SIZE) {
      rendered.push(renderSourceSvgAssetGroupUse(assetPathRun, indentLevel, context))
    } else {
      for (const assetPathNode of assetPathRun) {
        rendered.push(...renderDomChildJsx(assetPathNode, indentLevel, context, children))
      }
    }
    assetPathRun = []
  }

  for (const child of children) {
    if (isSourceSvgAssetPathNode(child)) {
      assetPathRun.push(child)
      continue
    }
    flushAssetPathRun()
    rendered.push(...renderDomChildJsx(child, indentLevel, context, children))
  }
  flushAssetPathRun()
  return rendered
}

function renderSourceSvgAssetGroupUse(
  nodes: DomNode[],
  indentLevel: number,
  context: SourceDomRenderContext,
): string {
  const groupName = allocateSourceSvgAssetGroupName(context)
  context.svgAssetGroups.set(groupName, nodes.map((node) => sourceSvgAssetGroupItem(node, context.nodeStyleFallbacks)))
  context.currentSvgAssetGroupNames.add(groupName)
  return `${indent(indentLevel)}<SourceAssetPathGroup items={sourceSvgAssetGroups[${JSON.stringify(groupName)}]} />`
}

function renderDomChildJsx(
  node: DomNode,
  indentLevel: number,
  context: SourceDomRenderContext,
  siblings: DomNode[],
): string[] {
  if (shouldExtractSourceRegion(node, siblings, context)) {
    const componentName = renderExtractedSourceRegion(node, context)
    context.currentImports.add(componentName)
    return [`${indent(indentLevel)}<${componentName} />`]
  }
  return renderDomNodeJsx(node, indentLevel, context)
}

function renderExtractedSourceRegion(node: DomNode, context: SourceDomRenderContext): string {
  const componentName = allocateSourceRegionComponentName(node, context)
  const faqGroup = extractSourceFaqGroup(node, context)
  if (faqGroup) {
    const groupName = allocateSourceFaqGroupName(context)
    context.faqGroups.set(groupName, faqGroup)
    const content = [
      "// @ts-nocheck",
      'import { SourceFaqList } from "../SourceFaqList"',
      'import { sourceFaqGroups } from "../../data/sourceFaqGroups"',
      "",
      `export function ${componentName}() {`,
      "  return <SourceFaqList group={sourceFaqGroups[" + JSON.stringify(groupName) + "]} />",
      "}",
      "",
    ].join("\n")
    const filePath = `src/components/source-dom/${componentName}.tsx`
    const bytes = Buffer.byteLength(content, "utf8")
    const elementCount = countRenderableElements(node)
    context.regionFiles.set(filePath, content)
    context.regionMetrics.push({
      componentName,
      filePath,
      sourceNodeId: node.attribs?.["data-source-node-id"],
      sourceSegmentId: node.attribs?.["data-source-segment-id"],
      tag: node.name ?? "div",
      heading: findFirstHeadingText(node),
      textPreview: visibleText(node).slice(0, 180),
      elementCount,
      bytes,
      replacementPriority: sourceDomReplacementPriority(bytes, elementCount),
    })
    return componentName
  }
  const parentImports = context.currentImports
  const parentSvgAssetGroupNames = context.currentSvgAssetGroupNames
  const parentPrefix = context.currentImportPrefix
  const parentDepth = context.regionDepth
  const imports = new Set<string>()
  const svgAssetGroupNames = new Set<string>()
  context.currentImports = imports
  context.currentSvgAssetGroupNames = svgAssetGroupNames
  context.currentImportPrefix = "./"
  context.regionDepth = parentDepth + 1
  const body = renderDomNodeJsx(node, 2, context)
  context.regionDepth = parentDepth
  context.currentImportPrefix = parentPrefix
  context.currentSvgAssetGroupNames = parentSvgAssetGroupNames
  context.currentImports = parentImports

  const nestedImports = Array.from(imports).sort().map((name) => `import { ${name} } from "./${name}"`)
  const svgAssetGroupImports = svgAssetGroupNames.size > 0
    ? [
        'import { SourceAssetPathGroup } from "../SourceAssetPathGroup"',
        'import { sourceSvgAssetGroups } from "../../data/sourceSvgAssetGroups"',
      ]
    : []
  const content = [
    "// @ts-nocheck",
    'import { AssetPath } from "../AssetPath"',
    ...svgAssetGroupImports,
    ...nestedImports,
    "",
    `export function ${componentName}() {`,
    "  return (",
    ...body,
    "  )",
    "}",
    "",
  ].join("\n")
  const filePath = `src/components/source-dom/${componentName}.tsx`
  const bytes = Buffer.byteLength(content, "utf8")
  context.regionFiles.set(filePath, content)
  context.regionMetrics.push({
    componentName,
    filePath,
    sourceNodeId: node.attribs?.["data-source-node-id"],
    sourceSegmentId: node.attribs?.["data-source-segment-id"],
    tag: node.name ?? "div",
    heading: findFirstHeadingText(node),
    textPreview: visibleText(node).slice(0, 180),
    elementCount: countRenderableElements(node),
    bytes,
    replacementPriority: sourceDomReplacementPriority(bytes, countRenderableElements(node)),
  })
  return componentName
}

function isSourceSvgAssetPathNode(node: DomNode): boolean {
  return node.type === "tag" &&
    node.name?.toLowerCase() === "path" &&
    Boolean(node.attribs?.["data-asset-d"])
}

function allocateSourceSvgAssetGroupName(context: SourceDomRenderContext): string {
  context.svgAssetGroupCount += 1
  return `sourceSvgAssetGroup${String(context.svgAssetGroupCount).padStart(3, "0")}`
}

function sourceSvgAssetGroupItem(
  node: DomNode,
  nodeStyleFallbacks: Map<string, string>,
): SourceSvgAssetGroupItem {
  const attribs = node.attribs ?? {}
  const item: SourceSvgAssetGroupItem = { assetPath: normalizeAssetPath(attribs["data-asset-d"] ?? "") }
  const fallbackStyle = attribs["data-source-node-id"]
    ? nodeStyleFallbacks.get(attribs["data-source-node-id"])
    : undefined
  let hasStyle = false
  for (const [rawName, rawValue] of Object.entries(attribs)) {
    if (rawName === "data-asset-d") continue
    const name = toJsxAttributeName(rawName)
    if (!name) continue
    if (name === "style") {
      hasStyle = true
      const style = renderStyleRecord(fallbackStyle ? `${rawValue};${fallbackStyle}` : rawValue)
      if (style) item.style = style
      continue
    }
    const value = (name === "src" || name === "href" || name === "xlinkHref")
      ? normalizeReferencedAssetUrl(rawValue)
      : rawValue
    item[name] = value
  }
  if (fallbackStyle && !hasStyle) {
    const style = renderStyleRecord(fallbackStyle)
    if (style) item.style = style
  }
  return item
}

function allocateSourceFaqGroupName(context: SourceDomRenderContext): string {
  context.faqGroupCount += 1
  return `sourceFaqGroup${String(context.faqGroupCount).padStart(3, "0")}`
}

function extractSourceFaqGroup(node: DomNode, context: SourceDomRenderContext): SourceFaqGroup | undefined {
  const heading = findFirstHeadingText(node) ?? ""
  const label = `${heading} ${node.attribs?.["data-container-name"] ?? ""} ${node.attribs?.["data-an-widget-id"] ?? ""}`.toLowerCase()
  if (!/\bfaq\b|frequently asked/.test(label)) return undefined

  const columnNodes = findDescendantElements(node, (child) => hasClassMatching(child, /^column-/))
  const itemColumns = columnNodes
    .map((column) => findDescendantElements(column, isFaqItemElement).map((item) => sourceFaqItem(item)).filter((item): item is SourceFaqItem => Boolean(item)))
    .filter((column) => column.length > 0)
  const columns = itemColumns.length > 0
    ? itemColumns
    : [findDescendantElements(node, isFaqItemElement).map((item) => sourceFaqItem(item)).filter((item): item is SourceFaqItem => Boolean(item))]
  const itemCount = columns.reduce((sum, column) => sum + column.length, 0)
  if (itemCount < 4) return undefined

  const firstItem = findDescendantElements(node, isFaqItemElement)[0]
  const firstSummary = firstItem ? findDescendantElement(firstItem, (child) => child.name?.toLowerCase() === "button") : undefined
  const firstDetailsWrapper = firstItem ? findDescendantElement(firstItem, (child) => hasClassMatching(child, /^detailsWrapper-/)) : undefined
  const firstDetails = firstItem ? findDescendantElement(firstItem, (child) => hasClassMatching(child, /^details-/)) : undefined
  const header = findDescendantElement(node, (child) => hasClassMatching(child, /^header-/))
  const headerWrapper = header ? findDescendantElement(header, (child) => hasClassMatching(child, /^wrapper-/)) : undefined
  const titleAndHintWrapper = header ? findDescendantElement(header, (child) => hasClassMatching(child, /^titleAndHintWrapper-/)) : undefined
  const titleContainer = header ? findDescendantElement(header, (child) => hasClassMatching(child, /^container-/)) : undefined
  const titleNode = findDescendantElement(node, (child) => /^h[1-4]$/i.test(child.name ?? ""))
  const content = findDescendantElement(node, (child) => hasClassMatching(child, /^content-/))
  const wrapper = content ? findDescendantElement(content, (child) => hasClassMatching(child, /^wrapper-/)) : undefined
  const firstColumn = columnNodes[0]
  const firstSummaryLine = firstSummary ? findDescendantElement(firstSummary, (child) => hasClassMatching(child, /^summaryLine-/)) : undefined
  const firstBackground = firstSummary ? findDescendantElement(firstSummary, (child) => hasClassMatching(child, /^background-/)) : undefined
  const firstSummaryText = firstSummary ? findDescendantElement(firstSummary, (child) => hasClassMatching(child, /^summaryText-/)) : undefined
  const firstIconPresentation = firstSummary ? findDescendantElement(firstSummary, (child) => child.attribs?.role === "presentation") : undefined
  const firstIconWrapper = firstIconPresentation ? findDescendantElement(firstIconPresentation, (child) => hasClassMatching(child, /^wrapper-/)) : undefined
  const firstIconHorizontal = firstIconWrapper ? findDescendantElement(firstIconWrapper, (child) => hasClassMatching(child, /^horizontal-/)) : undefined
  const firstIconVertical = firstIconWrapper ? findDescendantElement(firstIconWrapper, (child) => hasClassMatching(child, /^vertical-/)) : undefined

  return {
    title: normalizeVisibleText(heading || "Frequently asked questions"),
    titleId: titleNode?.attribs?.id,
    classes: {
      container: node.attribs?.class ?? "",
      header: header?.attribs?.class ?? "",
      headerWrapper: headerWrapper?.attribs?.class ?? "",
      titleAndHintWrapper: titleAndHintWrapper?.attribs?.class ?? "",
      titleContainer: titleContainer?.attribs?.class ?? "",
      title: titleNode?.attribs?.class ?? "",
      content: content?.attribs?.class ?? "",
      wrapper: wrapper?.attribs?.class ?? "",
      column: firstColumn?.attribs?.class ?? "",
      item: firstItem?.attribs?.class ?? "",
      summary: firstSummary?.attribs?.class ?? "",
      summaryLine: firstSummaryLine?.attribs?.class ?? "",
      background: firstBackground?.attribs?.class ?? "",
      summaryText: firstSummaryText?.attribs?.class ?? "",
      iconPresentation: firstIconPresentation?.attribs?.class ?? "",
      iconWrapper: firstIconWrapper?.attribs?.class ?? "",
      iconHorizontal: firstIconHorizontal?.attribs?.class ?? "",
      iconVertical: firstIconVertical?.attribs?.class ?? "",
      detailsWrapper: firstDetailsWrapper?.attribs?.class ?? "",
      details: firstDetails?.attribs?.class ?? "",
    },
    dataAttributes: {
      containerName: node.attribs?.["data-container-name"],
      widgetId: node.attribs?.["data-an-widget-id"],
      contentQaId: content?.attribs?.["data-qa-id"],
    },
    columns,
  }
}

function isFaqItemElement(node: DomNode): boolean {
  return node.type === "tag" && hasClassMatching(node, /^item-/) && Boolean(findDescendantElement(node, (child) => child.name?.toLowerCase() === "button"))
}

function sourceFaqItem(node: DomNode): SourceFaqItem | undefined {
  const summary = findDescendantElement(node, (child) => child.name?.toLowerCase() === "button")
  const summaryText = summary ? findDescendantElement(summary, (child) => hasClassMatching(child, /^summaryText-/)) : undefined
  const question = normalizeVisibleText(summaryText ? visibleText(summaryText) : "")
  if (!question) return undefined
  const detailsWrapper = findDescendantElement(node, (child) => hasClassMatching(child, /^detailsWrapper-/))
  const details = findDescendantElement(node, (child) => hasClassMatching(child, /^details-/))
  return {
    question,
    answerText: normalizeVisibleText(details ? visibleText(details) : ""),
    links: details ? findDescendantElements(details, (child) => child.name?.toLowerCase() === "a")
      .map((link) => ({ href: link.attribs?.href ?? "", label: normalizeVisibleText(visibleText(link)) }))
      .filter((link) => link.href || link.label) : [],
    order: extractCssProperty(node.attribs?.style ?? "", "order"),
    itemClassName: node.attribs?.class,
    summaryId: summary?.attribs?.id,
    detailsId: detailsWrapper?.attribs?.id,
  }
}

function findDescendantElement(node: DomNode, predicate: (node: DomNode) => boolean): DomNode | undefined {
  if (node.type === "tag" && predicate(node)) return node
  for (const child of node.children ?? []) {
    const found = findDescendantElement(child, predicate)
    if (found) return found
  }
  return undefined
}

function findDescendantElements(node: DomNode, predicate: (node: DomNode) => boolean): DomNode[] {
  const results: DomNode[] = []
  function visit(current: DomNode): void {
    if (current.type === "tag" && predicate(current)) results.push(current)
    for (const child of current.children ?? []) visit(child)
  }
  visit(node)
  return results
}

function hasClassMatching(node: DomNode, pattern: RegExp): boolean {
  return (node.attribs?.class ?? "").split(/\s+/).some((className) => pattern.test(className))
}

function extractCssProperty(style: string, property: string): string | undefined {
  for (const part of style.split(";")) {
    const colon = part.indexOf(":")
    if (colon < 1) continue
    const key = part.slice(0, colon).trim().toLowerCase()
    const value = part.slice(colon + 1).trim()
    if (key === property.toLowerCase() && value) return value
  }
  return undefined
}

function normalizeVisibleText(value: string): string {
  return decodeEntities(value).replace(/\s+/g, " ").trim()
}

function sourceDomReplacementPriority(bytes: number, elementCount: number): SourceDomRegionMetric["replacementPriority"] {
  if (bytes >= 32_000 || elementCount >= 220) return "high"
  if (bytes >= 12_000 || elementCount >= 80) return "medium"
  return "low"
}

function buildSourceDomReplacementPlan(
  regions: SourceDomRegionMetric[],
  data: SourceProjectData,
): SourceDomReplacementPlanItem[] {
  return regions
    .filter((region) => region.replacementPriority !== "low")
    .map((region) => {
      const replacementKind = classifySourceDomReplacementKind(region)
      const recommendedComponentName = semanticReplacementComponentName(region, replacementKind)
      return {
        regionComponentName: region.componentName,
        regionFilePath: region.filePath,
        priority: region.replacementPriority,
        recommendedComponentName,
        replacementKind,
        problem: sourceDomReplacementProblem(region),
        reusableSources: sourceDomReusableSources(region, replacementKind),
        dataSources: sourceDomDataSources(data, replacementKind),
        assetSources: sourceDomAssetSources(data, replacementKind),
        firstReplacementStep: sourceDomFirstReplacementStep(region, recommendedComponentName, replacementKind),
        parityGuard: sourceDomParityGuard(region, replacementKind),
      }
    })
}

function classifySourceDomReplacementKind(region: SourceDomRegionMetric): SourceDomReplacementPlanItem["replacementKind"] {
  const componentWords = region.componentName.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  const haystack = `${componentWords} ${region.heading ?? ""} ${region.textPreview}`.toLowerCase()
  if (/\b(main content|page shell)\b/.test(haystack)) return "baseline_defer"
  if (/\b(faq|frequently asked|what is|formula)\b/.test(haystack)) return "faq_disclosure_component"
  if (/\b(footer|header|navigation|tools|subscriptions|social|community|market data provided)\b/.test(haystack)) return "navigation_or_footer_component"
  if (/\b(ideas?|stocks?|mortgage|savings)\b/.test(haystack)) return "card_collection_component"
  if (/\b(news|calendar|event|today|actual|forecast|prior)\b/.test(haystack)) return "event_or_news_list_component"
  if (/\b(heatmap|indicator|gdp|country|countries|rate|table)\b/.test(haystack)) return "data_table_or_heatmap_component"
  if (/\b(map|industrial|inflation)\b/.test(haystack)) return "map_or_chart_asset_component"
  return "baseline_defer"
}

function semanticReplacementComponentName(
  region: SourceDomRegionMetric,
  kind: SourceDomReplacementPlanItem["replacementKind"],
): string {
  const label = region.heading || region.componentName.replace(/Region\d*$/, "")
  const suffix = {
    map_or_chart_asset_component: "Surface",
    data_table_or_heatmap_component: "Table",
    card_collection_component: "Cards",
    faq_disclosure_component: "FAQ",
    navigation_or_footer_component: "Navigation",
    event_or_news_list_component: "List",
    baseline_defer: "Region",
  } satisfies Record<SourceDomReplacementPlanItem["replacementKind"], string>
  return `${toPascalIdentifier(label)}${suffix[kind]}`
}

function sourceDomReplacementProblem(region: SourceDomRegionMetric): string {
  return `Generated source-dom region is ${region.bytes} bytes with ${region.elementCount} DOM elements; keep it as visual evidence only until replaced by a semantic component with explicit data/assets.`
}

function sourceDomReusableSources(
  region: SourceDomRegionMetric,
  kind: SourceDomReplacementPlanItem["replacementKind"],
): string[] {
  const sources = [
    region.filePath,
    "src/data/sourceDomRegions.ts",
    "web-clone-source/reference.png",
    "web-clone-source/source-skeleton/critical.css",
  ]
  if (kind === "map_or_chart_asset_component") sources.push("src/data/svgPaths.ts", "src/data/sourceSvgAssetGroups.ts", "web-clone-source/assets/svg/")
  if (kind === "faq_disclosure_component") sources.push("src/data/sourceFaqGroups.ts")
  if (kind === "navigation_or_footer_component") sources.push("web-clone-source/source-ir/component-tree.json")
  return Array.from(new Set(sources))
}

function sourceDomDataSources(
  data: SourceProjectData,
  kind: SourceDomReplacementPlanItem["replacementKind"],
): string[] {
  const sources = ["src/data/sourceData.ts"]
  if (kind === "data_table_or_heatmap_component" && data.tables.length > 0) sources.push("sourceTables")
  if (kind === "card_collection_component" && (data.cards.length > 0 || data.lists.length > 0)) sources.push("sourceCards", "sourceLists")
  if (kind === "event_or_news_list_component" && (data.lists.length > 0 || data.repeatedGroups.length > 0)) sources.push("sourceLists", "sourceRepeatedGroups")
  if (kind === "faq_disclosure_component") sources.push("sourceTextSignals", "sourceFaqGroups")
  if (kind === "navigation_or_footer_component") sources.push("sourceComponents", "sourceTextSignals")
  return Array.from(new Set(sources))
}

function sourceDomAssetSources(
  data: SourceProjectData,
  kind: SourceDomReplacementPlanItem["replacementKind"],
): string[] {
  const sources: string[] = []
  if (kind === "map_or_chart_asset_component") sources.push("src/data/svgPaths.ts", "src/data/sourceSvgAssetGroups.ts", "public/assets/svg/")
  if (kind === "card_collection_component" || kind === "map_or_chart_asset_component") sources.push("public/assets/images/")
  if (data.assets.length > 0) sources.push("src/data/sourceData.ts:sourceAssets")
  return Array.from(new Set(sources))
}

function sourceDomFirstReplacementStep(
  region: SourceDomRegionMetric,
  recommendedComponentName: string,
  kind: SourceDomReplacementPlanItem["replacementKind"],
): string {
  if (kind === "map_or_chart_asset_component") {
    return `Create ${recommendedComponentName} beside the app components using sidecar SVG/image assets and explicit legend/scale data, then swap it for ${region.componentName} only after screenshot parity is preserved.`
  }
  if (kind === "data_table_or_heatmap_component") {
    return `Model rows/columns/colors as arrays in sourceData or a new data module, render ${recommendedComponentName} with loops, and keep table dimensions/colors matched to ${region.componentName}.`
  }
  if (kind === "card_collection_component") {
    return `Extract card data into arrays, render ${recommendedComponentName} as repeated card components, and preserve thumbnail assets plus card spacing before removing ${region.componentName}.`
  }
  if (kind === "faq_disclosure_component") {
    return `Extract question/answer pairs into data, render ${recommendedComponentName} with disclosure controls from the project/design system, and verify expanded/collapsed states do not shift the baseline unexpectedly.`
  }
  if (kind === "navigation_or_footer_component") {
    return `Extract link groups/social/language state into arrays, render ${recommendedComponentName} with existing navigation/footer primitives when available, and keep legal/source text intact.`
  }
  if (kind === "event_or_news_list_component") {
    return `Extract rows into news/event arrays, render ${recommendedComponentName} with list/card primitives, and preserve timestamps, source labels, and column density.`
  }
  return `Keep ${region.componentName} as extracted baseline until a narrower semantic component and data contract are identified.`
}

function sourceDomParityGuard(
  region: SourceDomRegionMetric,
  kind: SourceDomReplacementPlanItem["replacementKind"],
): string {
  const base = `Before deleting ${region.componentName}, compare the root app against web-clone-source/reference.png and keep unchanged clone surfaces above the requested visual threshold.`
  if (kind === "map_or_chart_asset_component") return `${base} Check map/chart fills, legend ticks, geographic/chart geometry, and extracted asset references.`
  if (kind === "data_table_or_heatmap_component") return `${base} Check row/column count, cell colors, typography, and numeric text coverage.`
  if (kind === "card_collection_component") return `${base} Check card count, thumbnail rendering, titles, author/time metadata, and carousel overflow.`
  return base
}

function shouldExtractSourceRegion(
  node: DomNode,
  siblings: DomNode[],
  context: SourceDomRenderContext,
): boolean {
  if (!context.extractRegions || context.regionDepth >= context.maxRegionDepth) return false
  if (context.regionFiles.size >= context.maxRegionCount) return false
  if (node.type !== "tag") return false
  const tag = node.name?.toLowerCase() ?? ""
  if (!tag || tag === "html" || tag === "body" || tag === "script" || tag === "style") return false
  if (VOID_TAGS.has(tag)) return false

  const elementCount = countRenderableElements(node)
  if (elementCount < 24) return false
  const siblingElementCount = siblings.filter((child) => child.type === "tag").length
  const className = node.attribs?.class ?? ""

  if (/\btv-header\b|\btv-footer\b|\btv-main\b/.test(className)) return elementCount > 24
  if (tag === "main" && elementCount > 120) return true
  const headingCount = countHeadings(node)
  if (headingCount > 1) return false
  if (findFirstHeadingText(node) && (siblingElementCount >= 3 || elementCount > 60)) return true
  if (context.regionDepth >= 2 && siblingElementCount >= 3 && elementCount > 16 && visibleText(node).length > 16) return true
  if (siblingElementCount >= 4 && elementCount > 80 && visibleText(node).length > 16) return true
  return false
}

function allocateSourceRegionComponentName(node: DomNode, context: SourceDomRenderContext): string {
  const tag = node.name?.toLowerCase() ?? "region"
  const className = node.attribs?.class ?? ""
  const explicitLabel = (/(\btv-header\b)/.test(className) ? "Header" : undefined) ??
    (/(\btv-footer\b)/.test(className) ? "Footer" : undefined) ??
    (/(\btv-main\b)/.test(className) ? "Page Shell" : undefined) ??
    (tag === "main" ? "Main Content" : undefined) ??
    findFirstHeadingText(node) ??
    visibleText(node).slice(0, 40)
  const base = `${toPascalIdentifier(explicitLabel || tag || "Source")}Region`
  const count = (context.regionNameCounts.get(base) ?? 0) + 1
  context.regionNameCounts.set(base, count)
  return count === 1 ? base : `${base}${count}`
}

function countRenderableElements(node: DomNode): number {
  if (node.type !== "tag") return 0
  const tag = node.name?.toLowerCase() ?? ""
  if (tag === "script" || tag === "style") return 0
  return 1 + (node.children ?? []).reduce((sum, child) => sum + countRenderableElements(child), 0)
}

function countHeadings(node: DomNode): number {
  if (node.type !== "tag") return 0
  const own = /^h[1-2]$/i.test(node.name ?? "") ? 1 : 0
  return own + (node.children ?? []).reduce((sum, child) => sum + countHeadings(child), 0)
}

function findFirstHeadingText(node: DomNode): string | undefined {
  if (node.type === "tag" && /^h[1-4]$/i.test(node.name ?? "")) {
    const text = visibleText(node)
    if (text) return text
  }
  for (const child of node.children ?? []) {
    const text = findFirstHeadingText(child)
    if (text) return text
  }
  return undefined
}

function visibleText(node: DomNode): string {
  if (node.type === "text") return decodeEntities(node.data ?? "").replace(/\s+/g, " ").trim()
  if (node.type !== "tag" && node.type !== "script" && node.type !== "style") return ""
  if (node.name?.toLowerCase() === "script" || node.name?.toLowerCase() === "style") return ""
  return (node.children ?? []).map(visibleText).filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
}

function toPascalIdentifier(value: string): string {
  const words = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
  const label = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("")
  return /^[A-Za-z]/.test(label) ? label : `Source${label || "Region"}`
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

function rewriteImagePlaceholderAttributes(
  tag: string,
  attribs: Record<string, string>,
  context: { previewImagePaths: string[]; previewImageIndex: number },
): Record<string, string> {
  if (tag.toLowerCase() !== "img") return attribs
  const src = attribs.src ?? ""
  if (!isPlaceholderDataImage(src)) return attribs
  const imagePath = context.previewImagePaths[context.previewImageIndex++]
  const next: Record<string, string> = { ...attribs, src: imagePath ?? "" }
  delete next.srcset
  delete next.sizes
  return next
}

function isPlaceholderDataImage(value: string): boolean {
  return /^data:image\//i.test(value) && /__WEB_CLONE_DATA_URI_ASSET__/.test(value)
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
  if (name === "srcset") return "srcSet"
  if (name === "tabindex") return "tabIndex"
  if (name === "http-equiv") return "httpEquiv"
  if (name === "xlink:href") return "xlinkHref"
  const mappedSvg = SVG_ATTRIBUTE_MAP[name]
  if (mappedSvg) return mappedSvg
  if (/^(data|aria)-[a-zA-Z0-9_.:-]+$/.test(name)) return name
  if (/^[A-Za-z_$][\w$]*$/.test(name)) return name
  return undefined
}

function renderStyleObject(style: string): string | undefined {
  const entries = new Map<string, string>()
  for (const rawPart of style.split(";")) {
    const part = rawPart.trim()
    if (!part) continue
    const colon = part.indexOf(":")
    if (colon < 1) continue
    const key = part.slice(0, colon).trim()
    const value = part.slice(colon + 1).trim().replace(/\s*!important\s*$/i, "")
    if (!key || !value) continue
    const styleKey = toStyleKey(key)
    entries.set(styleKey, `${JSON.stringify(styleKey)}: ${JSON.stringify(value)}`)
  }
  return entries.size > 0 ? `{ ${Array.from(entries.values()).join(", ")} }` : undefined
}

function renderStyleRecord(style: string): Record<string, string> | undefined {
  const entries: Record<string, string> = {}
  for (const rawPart of style.split(";")) {
    const part = rawPart.trim()
    if (!part) continue
    const colon = part.indexOf(":")
    if (colon < 1) continue
    const key = part.slice(0, colon).trim()
    const value = part.slice(colon + 1).trim().replace(/\s*!important\s*$/i, "")
    if (!key || !value) continue
    entries[toStyleKey(key)] = value
  }
  return Object.keys(entries).length > 0 ? entries : undefined
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

function renderSourceDomRegionsTs(regions: SourceDomRegionMetric[]): string {
  return [
    "export const sourceDomRegions = " + JSON.stringify(regions, null, 2) + " as const",
    "",
    "export const highPrioritySourceDomRegions = sourceDomRegions.filter((region) => region.replacementPriority === \"high\")",
    "",
  ].join("\n")
}

function renderSourceDomReplacementPlanTs(items: SourceDomReplacementPlanItem[]): string {
  return [
    "export const sourceDomReplacementPlan = " + JSON.stringify(items, null, 2) + " as const",
    "",
    "export const highPrioritySourceDomReplacementPlan = sourceDomReplacementPlan.filter((item) => item.priority === \"high\")",
    "",
  ].join("\n")
}

function renderSourceSvgAssetGroupsTs(groups: Map<string, SourceSvgAssetGroupItem[]>): string {
  return [
    "export interface SourceSvgAssetGroupItem {",
    "  assetPath: string",
    "  [attribute: string]: unknown",
    "}",
    "",
    "export const sourceSvgAssetGroups = " + JSON.stringify(Object.fromEntries(groups), null, 2) + " as const satisfies Record<string, readonly SourceSvgAssetGroupItem[]>",
    "",
  ].join("\n")
}

function renderSourceFaqGroupsTs(groups: Map<string, SourceFaqGroup>): string {
  return [
    "export interface SourceFaqGroup {",
    "  title: string",
    "  titleId?: string",
    "  classes: Record<string, string>",
    "  dataAttributes: Record<string, string | undefined>",
    "  columns: readonly (readonly SourceFaqItem[])[]",
    "}",
    "",
    "export interface SourceFaqItem {",
    "  question: string",
    "  answerText: string",
    "  links: readonly { href: string; label: string }[]",
    "  order?: string",
    "  itemClassName?: string",
    "  summaryId?: string",
    "  detailsId?: string",
    "}",
    "",
    "export const sourceFaqGroups = " + JSON.stringify(Object.fromEntries(groups), null, 2) + " as const satisfies Record<string, SourceFaqGroup>",
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
    "",
  ].filter(Boolean).join("\n")
}

function renderReadme(mirrorDir: string): string {
  return [
    "# Web Clone Source Project",
    "",
    "This project is generated from a web-clone-source handoff. It is the editable implementation seed for downstream React work, not a separate scoring artifact.",
    "",
    "Inputs consumed:",
    "- `source-skeleton/index.html` for visible text and DOM order hints",
    "- `source-skeleton/critical.css` and `source-skeleton/full-source.css` for CSS sidecars",
    "- `source-ir/content-model.json` for tables, lists, cards, and repeated groups",
    "- `source-ir/component-tree.json` for component boundary hints",
    "- `assets/manifest.json` for sidecar asset references",
    "- `src/data/sourceDomRegions.ts` for generated-region size, text preview, and replacement priority metrics",
    "- `src/data/sourceDomReplacementPlan.ts` for concrete semantic replacement steps, data sources, asset sources, and parity guards",
    "- `src/data/sourceSvgAssetGroups.ts` for large SVG path runs that are data-driven through `SourceAssetPathGroup` instead of hand-maintained TSX repetition",
    "- `src/data/sourceFaqGroups.ts` for FAQ/disclosure content that is data-driven through `SourceFaqList` instead of repeated generated accordion JSX",
    "",
    "Implementation guidance:",
    "- The default app entrypoint renders `src/components/SourceDomPage.tsx` through `src/components/SourceClonePage.tsx`; this is the high-fidelity visual baseline, not a placeholder scaffold.",
    "- `src/components/source-dom/*Region.tsx` splits the high-fidelity baseline into bounded source regions. Start semantic replacement from high-priority rows in `src/data/sourceDomReplacementPlan.ts` instead of editing a monolithic DOM file.",
    "- Keep `src/styles/source-critical.css`, `src/styles/source-full.css`, `src/data/svgPaths.ts`, `src/data/sourceSvgAssetGroups.ts`, `src/data/sourceFaqGroups.ts`, and `public/assets/` copied together with the React entrypoints; they are required for visual parity.",
    "- Use `src/data/sourceData.ts`, source IR, and component metadata as the maintainability/refactor material for replacing specific regions with semantic components or mature libraries.",
    "- Refine this baseline region by region while checking against `reference.png`.",
    "- Use `reference.png` only as visual validation evidence. Do not render it, replay screenshots, or add hidden semantic coverage layers.",
    "- Use `web_clone_source_audit` and overlay/visual comparison as diagnostics; fix the implementation when their findings describe a real user-visible or maintainability defect.",
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

async function copyReferenceImage(mirrorDir: string, outputDir: string): Promise<boolean> {
  const source = path.join(mirrorDir, "reference.png")
  if (!await exists(source)) return false
  await fs.copyFile(source, path.join(outputDir, "reference.png"))
  return true
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
