import fs from "node:fs"

export const OVERLAY_SIZE_CONTRACT_MARKER = "<!-- OPENCORVUS_OVERLAY_SIZE_CONTRACT -->"

export interface OverlaySizeContract {
  minWidth: number
  minHeight: number
  maxAspectWidth: number
  maxAspectHeight: number
}

function positiveInteger(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Overlay size contract ${name} must be a positive integer.`)
  }
  return value
}

export function overlaySizeContractFromTauriConfig(config: unknown): OverlaySizeContract {
  const windows = (
    config as {
      app?: { windows?: Array<{ label?: string; width?: unknown; height?: unknown; minWidth?: unknown; minHeight?: unknown }> }
    }
  ).app?.windows
  if (!Array.isArray(windows)) throw new Error("Tauri config must define app.windows.")
  const mainWindow = windows.find((window) => window.label === "main")
  if (!mainWindow) throw new Error('Tauri config must define a "main" window.')
  const width = positiveInteger("width", mainWindow.width)
  const height = positiveInteger("height", mainWindow.height)
  const minWidth = positiveInteger("minWidth", mainWindow.minWidth)
  const minHeight = positiveInteger("minHeight", mainWindow.minHeight)
  if (width < minWidth) throw new Error("Overlay size contract width must be greater than or equal to minWidth.")
  if (height < minHeight) throw new Error("Overlay size contract height must be greater than or equal to minHeight.")
  return {
    minWidth,
    minHeight,
    maxAspectWidth: width,
    maxAspectHeight: minHeight,
  }
}

export function readOverlaySizeContract(configPath: string): OverlaySizeContract {
  return overlaySizeContractFromTauriConfig(JSON.parse(fs.readFileSync(configPath, "utf8")))
}

export function renderOverlaySizeContractStyle(contract: OverlaySizeContract): string {
  const minWidth = positiveInteger("minWidth", contract.minWidth)
  const minHeight = positiveInteger("minHeight", contract.minHeight)
  const maxAspectWidth = positiveInteger("maxAspectWidth", contract.maxAspectWidth)
  const maxAspectHeight = positiveInteger("maxAspectHeight", contract.maxAspectHeight)
  if (maxAspectWidth / maxAspectHeight < minWidth / minHeight) {
    throw new Error("Overlay size contract maximum aspect ratio must be greater than or equal to the minimum aspect ratio.")
  }
  return [
    '<style id="opencorvus-overlay-size-contract">',
    ":root {",
    `  --ui-overlay-min-width-units: ${minWidth};`,
    `  --ui-overlay-min-height-units: ${minHeight};`,
    `  --ui-overlay-max-aspect-width-units: ${maxAspectWidth};`,
    `  --ui-overlay-max-aspect-height-units: ${maxAspectHeight};`,
    "  --ui-overlay-min-width: calc(var(--ui-overlay-min-width-units) * 1px);",
    "  --ui-overlay-min-height: calc(var(--ui-overlay-min-height-units) * 1px);",
    "  --ui-overlay-max-aspect-width: calc(var(--ui-overlay-max-aspect-width-units) * 1px);",
    "  --ui-overlay-max-aspect-height: calc(var(--ui-overlay-max-aspect-height-units) * 1px);",
    "  --ui-overlay-min-aspect-ratio: calc(var(--ui-overlay-min-width-units) / var(--ui-overlay-min-height-units));",
    "  --ui-overlay-max-aspect-ratio: calc(var(--ui-overlay-max-aspect-width-units) / var(--ui-overlay-max-aspect-height-units));",
    "}",
    "</style>",
  ].join("\n")
}
