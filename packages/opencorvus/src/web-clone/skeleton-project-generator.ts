import fs from "node:fs/promises"
import { readFileSync } from "node:fs"
import path from "node:path"
import { GENERATED_FRONTEND_PACKAGE_PROFILE } from "./frontend-package-profile"

export interface GenerateWebCloneSkeletonProjectInput {
  sourcePackageDir: string
  outputDir: string
  packageName?: string
  overwrite?: boolean
}

export interface GenerateWebCloneSkeletonProjectOutput {
  sourcePackageDir: string
  outputDir: string
  files: string[]
  stats: {
    htmlBytes: number
    cssBytes: number
    hydratedSvgPaths: number
    copiedAssets: number
    slotCount: number
    sourceHtml: "source-skeleton"
  }
  warnings: string[]
}

interface SlotRecord {
  id: string
  kind: string
  label: string
  source?: string
}

interface SourceDocument {
  title: string
  htmlAttributes: Record<string, string>
  bodyAttributes: Record<string, string>
  headStylesHtml: string
  bodyHtml: string
}

export async function generateWebCloneSkeletonProject(
  input: GenerateWebCloneSkeletonProjectInput,
): Promise<GenerateWebCloneSkeletonProjectOutput> {
  const sourcePackageDir = path.resolve(input.sourcePackageDir)
  const outputDir = path.resolve(input.outputDir)
  await assertSourcePackage(sourcePackageDir)
  await prepareOutputDir(outputDir, input.overwrite === true)

  const sourceHtmlKind = "source-skeleton" as const
  const sourceHtmlPath = path.join(sourcePackageDir, "source-skeleton", "index.html")
  const rawHtml = await fs.readFile(sourceHtmlPath, "utf8")
  const { html, hydratedSvgPaths, copiedAssets } = await hydrateHtmlAssets({
    html: rawHtml,
    sourcePackageDir,
    outputDir,
  })

  const criticalCss = await readOptionalText(path.join(sourcePackageDir, "source-skeleton", "critical.css"))
  const fullSourceCss = await readOptionalText(path.join(sourcePackageDir, "source-skeleton", "full-source.css"))
  const css = renderSkeletonCss({ criticalCss, fullSourceCss, sourceHtmlKind })
  const sourceHtml = renderSourceHtmlDocument({ html, css })
  const sourceDocument = extractSourceDocument(sourceHtml)
  const slots = await extractSlots(sourcePackageDir)
  const packageJson = renderPackageJson(input.packageName ?? `web-clone-skeleton-${path.basename(outputDir)}`)
  const warnings = buildWarnings(sourceHtmlKind, criticalCss, fullSourceCss)
  const readme = renderReadme({ sourcePackageDir, sourceHtmlKind, slots, warnings })

  const fileMap = new Map<string, string>([
    ["package.json", packageJson],
    ["index.html", renderIndexHtml(sourceDocument.title)],
    ["vite.config.js", renderViteConfig()],
    ["scripts/extract-source-html.mjs", renderExtractSourceHtmlScript()],
    ["public/source.html", sourceHtml],
    ["src/App.jsx", renderAppJsx()],
    ["src/main.jsx", renderMainJsx()],
    ["src/skeleton.css", css],
    ["src/slots.json", JSON.stringify({ version: 1, purpose: "web-clone-skeleton-slots", slots }, null, 2) + "\n"],
    ["src/generated/source-head-styles.html", sourceDocument.headStylesHtml],
    ["src/generated/source-body.html", sourceDocument.bodyHtml],
    [
      "src/generated/source-document.json",
      JSON.stringify(
        {
          title: sourceDocument.title,
          htmlAttributes: sourceDocument.htmlAttributes,
          bodyAttributes: sourceDocument.bodyAttributes,
        },
        null,
        2,
      ) + "\n",
    ],
    ["README.md", readme],
  ])

  for (const [relative, content] of fileMap) {
    await writeText(path.join(outputDir, relative), content)
  }

  const copiedReferenceFiles = await copyReferenceImage(sourcePackageDir, outputDir)

  return {
    sourcePackageDir,
    outputDir,
    files: [...fileMap.keys(), ...copiedReferenceFiles].map((file) => path.join(outputDir, file)),
    stats: {
      htmlBytes: sourceDocument.bodyHtml.length,
      cssBytes: sourceDocument.headStylesHtml.length,
      hydratedSvgPaths,
      copiedAssets,
      slotCount: slots.length,
      sourceHtml: sourceHtmlKind,
    },
    warnings,
  }
}

async function assertSourcePackage(sourcePackageDir: string): Promise<void> {
  const skeleton = path.join(sourcePackageDir, "source-skeleton", "index.html")
  try {
    const stat = await fs.stat(skeleton)
    if (!stat.isFile() || stat.size === 0) throw new Error("empty")
  } catch {
    throw new Error(`web-clone skeleton source is missing: ${skeleton}`)
  }
}

async function prepareOutputDir(outputDir: string, overwrite: boolean): Promise<void> {
  try {
    const entries = await fs.readdir(outputDir)
    if (entries.length > 0) {
      if (!overwrite) throw new Error(`outputDir already exists and is non-empty: ${outputDir}`)
      await fs.rm(outputDir, { recursive: true, force: true })
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }
  await fs.mkdir(outputDir, { recursive: true })
}

async function hydrateHtmlAssets(input: {
  html: string
  sourcePackageDir: string
  outputDir: string
}): Promise<{ html: string; hydratedSvgPaths: number; copiedAssets: number }> {
  let copiedAssets = 0
  let html = input.html.replace(/data-asset-d="([^"]+)"/g, (_match, relative: string) => {
    const assetPath = path.join(input.sourcePackageDir, relative.replace(/^(\.\.\/)+/, ""))
    return `data-asset-d="${escapeHtmlAttribute(relative)}" data-skeleton-asset="true" d="${escapeHtmlAttribute(readTextSyncBestEffort(assetPath))}"`
  })
  const hydratedSvgPaths = (html.match(/data-skeleton-asset="true"/g) ?? []).length

  html = await replaceAssetAttribute(html, "data-asset-src", "src", input, () => {
    copiedAssets += 1
  })
  html = await replaceAssetAttribute(html, "data-asset-href", "href", input, () => {
    copiedAssets += 1
  })
  return { html, hydratedSvgPaths, copiedAssets }
}

async function replaceAssetAttribute(
  html: string,
  sourceAttr: string,
  targetAttr: string,
  input: { sourcePackageDir: string; outputDir: string },
  onCopy: () => void,
): Promise<string> {
  const matches = [...html.matchAll(new RegExp(`${sourceAttr}="([^"]+)"`, "g"))]
  let output = html
  for (const match of matches) {
    const relative = match[1]
    if (!relative) continue
    const normalized = relative.replace(/^(\.\.\/)+/, "")
    const source = path.join(input.sourcePackageDir, normalized)
    try {
      const stat = await fs.stat(source)
      if (!stat.isFile()) continue
      const targetRelative = path.posix.join("assets", path.basename(source))
      await fs.mkdir(path.join(input.outputDir, "assets"), { recursive: true })
      await fs.copyFile(source, path.join(input.outputDir, targetRelative))
      output = output.replace(match[0], `${match[0]} ${targetAttr}="./${targetRelative}"`)
      onCopy()
    } catch {
      // Keep the source attribute as evidence when the sidecar is unavailable.
    }
  }
  return output
}

function readTextSyncBestEffort(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8").trim()
  } catch {
    return ""
  }
}

function renderSkeletonCss(input: {
  criticalCss: string
  fullSourceCss: string
  sourceHtmlKind: "source-skeleton"
}): string {
  return [
    "/* Web clone skeleton CSS.",
    `   sourceHtml=${input.sourceHtmlKind}. Keep this as the visual baseline before extracting components.`,
    "   Edit project-owned CSS above this comment; keep source CSS available for pixel checks. */",
    "",
    "html, body { margin: 0; min-height: 100%; }",
    "img, svg, canvas, video { max-width: 100%; }",
    "",
    "/* source-skeleton/critical.css */",
    input.criticalCss,
    "",
    "/* source-skeleton/full-source.css */",
    input.fullSourceCss,
    "",
  ].join("\n")
}

function renderSourceHtmlDocument(input: { html: string; css: string }): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Web Clone Skeleton</title>",
    "<style>",
    input.css,
    "</style>",
    "</head>",
    "<body>",
    input.html,
    "</body>",
    "</html>",
  ].join("\n")
}

function extractSourceDocument(sourceHtml: string): SourceDocument {
  const htmlMatch = sourceHtml.match(/<html\b([^>]*)>/i)
  const headMatch = sourceHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i)
  const bodyMatch = sourceHtml.match(/<body\b([^>]*)>([\s\S]*?)<\/body>/i)
  const headHtml = headMatch?.[1] ?? ""
  const bodyHtml = bodyMatch?.[2] ?? sourceHtml
  const titleMatch = headHtml.match(/<title>([\s\S]*?)<\/title>/i)
  return {
    title: titleMatch?.[1]?.trim() || "Web Clone Skeleton",
    htmlAttributes: parseAttributes(htmlMatch?.[1] ?? ""),
    bodyAttributes: parseAttributes(bodyMatch?.[1] ?? ""),
    headStylesHtml: extractStyleAndStylesheetTags(headHtml).trim(),
    bodyHtml: stripScriptTags(bodyHtml).trim(),
  }
}

function parseAttributes(attributeSource: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const attributePattern = /([^\s=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let match: RegExpExecArray | null
  while ((match = attributePattern.exec(attributeSource)) !== null) {
    const [, name, doubleQuoted, singleQuoted, bare] = match
    if (!name) continue
    attributes[name] = doubleQuoted ?? singleQuoted ?? bare ?? ""
  }
  return attributes
}

function extractStyleAndStylesheetTags(headHtml: string): string {
  const styles = headHtml.match(/<style\b[\s\S]*?<\/style>/gi) ?? []
  const links = (headHtml.match(/<link\b[^>]*>/gi) ?? []).filter((tag) =>
    /\brel=(?:"stylesheet"|'stylesheet'|stylesheet)\b/i.test(tag),
  )
  return [...links, ...styles].join("\n")
}

function stripScriptTags(html: string): string {
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, "")
}

function renderIndexHtml(title: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${escapeHtmlText(title)}</title>`,
    '    <script type="module" src="/src/main.jsx"></script>',
    "  </head>",
    "  <body></body>",
    "</html>",
    "",
  ].join("\n")
}

function renderViteConfig(): string {
  return [
    "import { defineConfig } from 'vite'",
    "import react from '@vitejs/plugin-react'",
    "",
    "export default defineConfig({",
    "  plugins: [react()],",
    "  server: {",
    "    host: '127.0.0.1',",
    "  },",
    "})",
    "",
  ].join("\n")
}

function renderMainJsx(): string {
  return [
    "import ReactDOM from 'react-dom/client'",
    "import App from './App'",
    "",
    "const container = document.createDocumentFragment()",
    "",
    "ReactDOM.createRoot(container).render(<App />)",
    "",
  ].join("\n")
}

function renderAppJsx(): string {
  return [
    "import { useLayoutEffect } from 'react'",
    "import bodyHtml from './generated/source-body.html?raw'",
    "import headStylesHtml from './generated/source-head-styles.html?raw'",
    "import documentMeta from './generated/source-document.json'",
    "",
    "function applyAttributes(element, nextAttributes) {",
    "  for (const name of element.getAttributeNames()) {",
    "    if (!(name in nextAttributes)) {",
    "      element.removeAttribute(name)",
    "    }",
    "  }",
    "",
    "  for (const [name, value] of Object.entries(nextAttributes)) {",
    "    element.setAttribute(name, value)",
    "  }",
    "}",
    "",
    "function cloneTemplateNodes(html) {",
    "  const template = document.createElement('template')",
    "  template.innerHTML = html",
    "  return Array.from(template.content.childNodes).map((node) => node.cloneNode(true))",
    "}",
    "",
    "export default function App() {",
    "  useLayoutEffect(() => {",
    "    const htmlElement = document.documentElement",
    "    const bodyElement = document.body",
    "",
    "    const previousHtmlAttributes = Object.fromEntries(",
    "      htmlElement.getAttributeNames().map((name) => [name, htmlElement.getAttribute(name) ?? '']),",
    "    )",
    "    const previousBodyAttributes = Object.fromEntries(",
    "      bodyElement.getAttributeNames().map((name) => [name, bodyElement.getAttribute(name) ?? '']),",
    "    )",
    "    const previousTitle = document.title",
    "",
    "    applyAttributes(htmlElement, documentMeta.htmlAttributes)",
    "    applyAttributes(bodyElement, documentMeta.bodyAttributes)",
    "    document.title = documentMeta.title",
    "",
    "    const headNodes = cloneTemplateNodes(headStylesHtml)",
    "    for (const node of headNodes) {",
    "      document.head.appendChild(node)",
    "    }",
    "",
    "    const bodyNodes = cloneTemplateNodes(bodyHtml)",
    "    for (const node of bodyNodes) {",
    "      bodyElement.appendChild(node)",
    "    }",
    "",
    "    return () => {",
    "      for (const node of bodyNodes) {",
    "        node.remove()",
    "      }",
    "      for (const node of headNodes) {",
    "        node.remove()",
    "      }",
    "      applyAttributes(htmlElement, previousHtmlAttributes)",
    "      applyAttributes(bodyElement, previousBodyAttributes)",
    "      document.title = previousTitle",
    "    }",
    "  }, [])",
    "",
    "  return null",
    "}",
    "",
  ].join("\n")
}

function renderExtractSourceHtmlScript(): string {
  return [
    "import fs from 'node:fs'",
    "",
    "const projectRoot = new URL('..', import.meta.url)",
    "const sourcePath = new URL('./public/source.html', projectRoot)",
    "const outputDir = new URL('./src/generated/', projectRoot)",
    "const sourceHtml = fs.readFileSync(sourcePath, 'utf8')",
    "",
    "const htmlMatch = sourceHtml.match(/<html\\b([^>]*)>/i)",
    "const headMatch = sourceHtml.match(/<head[^>]*>([\\s\\S]*?)<\\/head>/i)",
    "const bodyMatch = sourceHtml.match(/<body\\b([^>]*)>([\\s\\S]*?)<\\/body>/i)",
    "const headHtml = headMatch?.[1] ?? ''",
    "const bodyHtml = bodyMatch?.[2] ?? sourceHtml",
    "",
    "function parseAttributes(attributeSource) {",
    "  const attributes = {}",
    "  const attributePattern = /([^\\s=]+)(?:=(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+)))?/g",
    "  let match",
    "  while ((match = attributePattern.exec(attributeSource)) !== null) {",
    "    const [, name, doubleQuoted, singleQuoted, bare] = match",
    "    attributes[name] = doubleQuoted ?? singleQuoted ?? bare ?? ''",
    "  }",
    "  return attributes",
    "}",
    "",
    "function extractStyleAndStylesheetTags(html) {",
    "  const styles = html.match(/<style\\b[\\s\\S]*?<\\/style>/gi) ?? []",
    "  const links = (html.match(/<link\\b[^>]*>/gi) ?? []).filter((tag) => /\\brel=(?:\"stylesheet\"|'stylesheet'|stylesheet)\\b/i.test(tag))",
    "  return [...links, ...styles].join('\\n')",
    "}",
    "",
    "function stripScriptTags(html) {",
    "  return html.replace(/<script\\b[\\s\\S]*?<\\/script>/gi, '')",
    "}",
    "",
    "const titleMatch = headHtml.match(/<title>([\\s\\S]*?)<\\/title>/i)",
    "const meta = {",
    "  title: titleMatch?.[1]?.trim() || 'Web Clone Skeleton',",
    "  htmlAttributes: parseAttributes(htmlMatch?.[1] ?? ''),",
    "  bodyAttributes: parseAttributes(bodyMatch?.[1] ?? ''),",
    "}",
    "",
    "fs.mkdirSync(outputDir, { recursive: true })",
    "fs.writeFileSync(new URL('./source-head-styles.html', outputDir), extractStyleAndStylesheetTags(headHtml).trim())",
    "fs.writeFileSync(new URL('./source-body.html', outputDir), stripScriptTags(bodyHtml).trim())",
    "fs.writeFileSync(new URL('./source-document.json', outputDir), `${JSON.stringify(meta, null, 2)}\\n`)",
    "",
  ].join("\n")
}

async function extractSlots(sourcePackageDir: string): Promise<SlotRecord[]> {
  const contentModel = await readJsonOptional(path.join(sourcePackageDir, "source-ir", "content-model.json"))
  const slots: SlotRecord[] = []
  collectContentSlots(contentModel, slots)
  return slots.slice(0, 200)
}

function collectContentSlots(value: unknown, slots: SlotRecord[], prefix = "slot"): void {
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) {
    value.slice(0, 80).forEach((item, index) => collectContentSlots(item, slots, `${prefix}-${index + 1}`))
    return
  }
  const row = value as Record<string, unknown>
  const kind = typeof row.kind === "string" ? row.kind : typeof row.type === "string" ? row.type : ""
  const title = stringValue(row.title) ?? stringValue(row.label) ?? stringValue(row.textPreview)
  if (kind || title) {
    slots.push({
      id: `${prefix}-${slots.length + 1}`,
      kind: kind || "content",
      label: title ? title.slice(0, 160) : kind,
      source: stringValue(row.sourceNodeId) ?? stringValue(row.id),
    })
  }
  for (const [key, child] of Object.entries(row)) {
    if (key === "text" || key === "html" || key === "preview") continue
    collectContentSlots(child, slots, `${prefix}-${key}`)
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

async function copyReferenceImage(sourcePackageDir: string, outputDir: string): Promise<string[]> {
  const copied: string[] = []
  try {
    await fs.copyFile(path.join(sourcePackageDir, "reference.png"), path.join(outputDir, "reference.png"))
    copied.push("reference.png")
  } catch {
    // The generator can still emit a skeleton; audits will report missing visual truth.
  }
  try {
    await fs.copyFile(path.join(sourcePackageDir, "reference-mobile.png"), path.join(outputDir, "reference-mobile.png"))
    copied.push("reference-mobile.png")
  } catch {
    // The generator can still emit a skeleton; audits will report missing mobile visual truth.
  }
  return copied
}

function renderPackageJson(packageName: string): string {
  return `${JSON.stringify(
    {
      name: normalizePackageName(packageName),
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: {
        dev: `node scripts/extract-source-html.mjs && ${GENERATED_FRONTEND_PACKAGE_PROFILE.scripts.viteDev}`,
        build: `node scripts/extract-source-html.mjs && ${GENERATED_FRONTEND_PACKAGE_PROFILE.scripts.viteBuild}`,
        preview: GENERATED_FRONTEND_PACKAGE_PROFILE.scripts.vitePreview,
      },
      packageManager: GENERATED_FRONTEND_PACKAGE_PROFILE.packageManager,
      dependencies: {
        "@vitejs/plugin-react": "^4.3.4",
        react: "^18.3.1",
        "react-dom": "^18.3.1",
        vite: "^5.4.19",
      },
    },
    null,
    2,
  )}\n`
}

function renderReadme(input: {
  sourcePackageDir: string
  sourceHtmlKind: "source-skeleton"
  slots: SlotRecord[]
  warnings: string[]
}): string {
  return [
    "# Web Clone Visual Baseline",
    "",
    "This is a frontend-design visual baseline input, not the delivered maintainable project. It renders extracted source DOM and source CSS through React so downstream work starts from captured visual evidence. Downstream Build must adopt these entrypoints, baseline CSS, assets, slot metadata, and page wrapper into the root app as the temporary baseline before replacing regions with maintainable components.",
    "",
    `- Source package: ${input.sourcePackageDir}`,
    `- HTML source: ${input.sourceHtmlKind}`,
    "- Source HTML: `public/source.html`",
    "- React entry: `src/App.jsx`",
    "- Extracted DOM: `src/generated/source-body.html`",
    "- Extracted styles: `src/generated/source-head-styles.html`",
    "- Fillable slots: `src/slots.json`",
    "- Visual truth: `reference.png`",
    "- Mobile visual truth: `reference-mobile.png`",
    "",
    "Rules for downstream LLM work:",
    "- Do not present this raw extracted baseline as the final project.",
    "- Copy/adapt this baseline into the root app before semantic replacement so the implementation keeps captured-source structure and parity evidence.",
    "- Follow frontend_design `quality_project_contract` to create readable semantic source.",
    "- Continue from the captured source baseline and replace named regions in place.",
    "- Preserve this extracted DOM/CSS baseline until a replacement component passes webpage_evaluate screenshot comparison at the requested threshold.",
    "- Prefer existing project components first, mature maintained libraries second, and custom components only for page-specific surfaces.",
    "- Use reusable components or mature libraries for complex charts, maps, tables, menus, dialogs, forms, calendars, virtualized lists, or drag/drop behavior when they fit.",
    "- Replace content by slot/component boundaries with source-region traceability.",
    "- Do not use `public/source.html` as an iframe; it is the regeneration source for `src/generated/*`.",
    "",
    "Warnings:",
    ...(input.warnings.length > 0 ? input.warnings.map((item) => `- ${item}`) : ["- none"]),
    "",
    `Slot count: ${input.slots.length}`,
    "",
  ].join("\n")
}

function buildWarnings(
  sourceHtmlKind: "source-skeleton",
  criticalCss: string,
  fullSourceCss: string,
): string[] {
  const warnings: string[] = []
  const reachableRuleCount = (criticalCss.match(/\/\* Reachable original CSS rules\. \*\//g) ?? []).length
  if (reachableRuleCount === 0 && fullSourceCss.length < 20000) {
    warnings.push("Original CSS evidence appears sparse; source-skeleton CSS may need targeted region repair.")
  }
  return warnings
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

async function writeText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf8")
}

function normalizePackageName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 214) || "web-clone-skeleton"
  )
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function escapeHtmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}
