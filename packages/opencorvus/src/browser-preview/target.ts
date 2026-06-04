import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { latestBrowserPreviewEvidenceID, findLatestBrowserPreviewTarget } from "./persist"
import { BROWSER_PREVIEW_VIEWPORTS, BrowserPreviewViewport } from "./viewport"

type PreviewPackage = {
  scripts?: Record<string, string>
  packageManager?: string
  opencorvus?: {
    browserPreview?: {
      /**
       * URL means Uniform Resource Locator. It is the single explicit browser
       * address the overlay may embed; no port or server kind is inferred.
       */
      url?: string
      command?: string
    }
  }
}

type PreviewPackageRead =
  | { kind: "found"; pkg: PreviewPackage }
  | { kind: "missing" }
  | { kind: "failed"; diagnostics: string[] }

export const BrowserPreviewTarget = z.object({
  id: z.string().optional(),
  taskID: z.string().optional(),
  latestEvidenceID: z.string().optional(),
  kind: z.enum(["task-url", "explicit-url", "manifest-url", "manifest-command", "missing", "failed"]),
  status: z.enum(["ready", "configured", "missing", "failed"]),
  projectRoot: z.string(),
  url: z.string().optional(),
  command: z.string().optional(),
  packageManager: z.string().optional(),
  viewports: BrowserPreviewViewport.array(),
  diagnostics: z.string().array(),
  source: z.enum(["task-artifact", "explicit", "package-json", "none"]),
})

export type BrowserPreviewTarget = z.infer<typeof BrowserPreviewTarget>

export async function resolveBrowserPreviewTarget(input: {
  projectRoot: string
  taskID?: string
  explicitUrl?: string
}): Promise<BrowserPreviewTarget> {
  const projectRoot = path.resolve(input.projectRoot)
  const taskID = input.taskID?.trim()
  if (taskID) {
    const persisted = findLatestBrowserPreviewTarget(taskID)
    if (persisted) {
      return {
        id: persisted.id,
        taskID,
        latestEvidenceID: latestBrowserPreviewEvidenceID({ taskID, targetID: persisted.id }),
        kind: "task-url",
        status: "ready",
        projectRoot,
        url: persisted.url,
        viewports: [...BROWSER_PREVIEW_VIEWPORTS],
        diagnostics: [`Using task browser preview target ${persisted.id}.`],
        source: "task-artifact",
      }
    }
  }

  const explicitUrl = input.explicitUrl?.trim()
  if (explicitUrl) {
    const url = normalizeBrowserPreviewUrl(explicitUrl)
    if (!url) {
      return {
        kind: "failed",
        status: "failed",
        projectRoot,
        taskID,
        viewports: [...BROWSER_PREVIEW_VIEWPORTS],
        diagnostics: [`Invalid preview URL: ${explicitUrl}`],
        source: "explicit",
      }
    }
    return {
      kind: "explicit-url",
      status: "ready",
      projectRoot,
      taskID,
      url,
      viewports: [...BROWSER_PREVIEW_VIEWPORTS],
      diagnostics: [`Using explicit preview URL: ${url}`],
      source: "explicit",
    }
  }

  const packageRead = await readPreviewPackage(projectRoot)
  if (packageRead.kind === "failed") {
    return {
      kind: "failed",
      status: "failed",
      projectRoot,
      taskID,
      viewports: [...BROWSER_PREVIEW_VIEWPORTS],
      diagnostics: packageRead.diagnostics,
      source: "package-json",
    }
  }
  if (packageRead.kind === "missing") {
    return {
      kind: "missing",
      status: "missing",
      projectRoot,
      taskID,
      viewports: [...BROWSER_PREVIEW_VIEWPORTS],
      diagnostics: ["No package.json found in the active project directory."],
      source: "none",
    }
  }
  const pkg = packageRead.pkg

  const manifestConfig = pkg.opencorvus?.browserPreview
  if (manifestConfig && Object.prototype.hasOwnProperty.call(manifestConfig, "url")) {
    const manifestUrlInput = manifestConfig.url
    const manifestUrl = normalizeBrowserPreviewUrl(manifestUrlInput)
    if (!manifestUrl) {
      return {
        kind: "failed",
        status: "failed",
        projectRoot,
        taskID,
        packageManager: pkg.packageManager,
        viewports: [...BROWSER_PREVIEW_VIEWPORTS],
        diagnostics: [`Invalid package.json opencorvus.browserPreview.url: ${String(manifestUrlInput)}`],
        source: "package-json",
      }
    }
    return {
      kind: "manifest-url",
      status: "ready",
      projectRoot,
      taskID,
      url: manifestUrl,
      command: explicitManifestCommand(pkg),
      packageManager: pkg.packageManager,
      viewports: [...BROWSER_PREVIEW_VIEWPORTS],
      diagnostics: ["Using package.json opencorvus.browserPreview.url."],
      source: "package-json",
    }
  }

  const command = explicitManifestCommand(pkg)
  if (command) {
    return {
      kind: "manifest-command",
      status: "configured",
      projectRoot,
      taskID,
      command,
      packageManager: pkg.packageManager,
      viewports: [...BROWSER_PREVIEW_VIEWPORTS],
      diagnostics: [
        "Project declares a preview command but no opencorvus.browserPreview.url.",
        "Start the command or configure the explicit URL before embedding the page.",
      ],
      source: "package-json",
    }
  }

  return {
    kind: "missing",
    status: "missing",
    projectRoot,
    taskID,
    packageManager: pkg.packageManager,
    viewports: [...BROWSER_PREVIEW_VIEWPORTS],
    diagnostics: ["package.json does not declare opencorvus.browserPreview.url or opencorvus.browserPreview.command."],
    source: "package-json",
  }
}

export function normalizeBrowserPreviewUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const text = value.trim()
  if (!text) return undefined
  try {
    const url = new URL(text)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

async function readPreviewPackage(projectRoot: string): Promise<PreviewPackageRead> {
  const file = path.join(projectRoot, "package.json")
  try {
    return { kind: "found", pkg: JSON.parse(await fs.readFile(file, "utf8")) as PreviewPackage }
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined
    if (code === "ENOENT") return { kind: "missing" }
    const message = error instanceof Error ? error.message : String(error)
    return { kind: "failed", diagnostics: [`Failed to read package.json: ${message}`] }
  }
}

function explicitManifestCommand(pkg: PreviewPackage): string | undefined {
  const command = pkg.opencorvus?.browserPreview?.command?.trim()
  return command || undefined
}
