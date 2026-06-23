import fs from "node:fs"

export const OVERLAY_SIZE_CONTRACT_MARKER = "<!-- OPENCORVUS_OVERLAY_SIZE_CONTRACT -->"

export interface OverlaySizeContract {
  minWidth: number
  minHeight: number
}

function positiveInteger(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Overlay size contract ${name} must be a positive integer.`)
  }
  return value
}

export function overlaySizeContractFromTauriConfig(config: unknown): OverlaySizeContract {
  const windows = (config as { app?: { windows?: Array<{ label?: string; minWidth?: unknown; minHeight?: unknown }> } })
    .app?.windows
  if (!Array.isArray(windows)) throw new Error("Tauri config must define app.windows.")
  const mainWindow = windows.find((window) => window.label === "main")
  if (!mainWindow) throw new Error('Tauri config must define a "main" window.')
  return {
    minWidth: positiveInteger("minWidth", mainWindow.minWidth),
    minHeight: positiveInteger("minHeight", mainWindow.minHeight),
  }
}

export function readOverlaySizeContract(configPath: string): OverlaySizeContract {
  return overlaySizeContractFromTauriConfig(JSON.parse(fs.readFileSync(configPath, "utf8")))
}

export function renderOverlaySizeContractStyle(contract: OverlaySizeContract): string {
  const minWidth = positiveInteger("minWidth", contract.minWidth)
  const minHeight = positiveInteger("minHeight", contract.minHeight)
  return [
    '<style id="opencorvus-overlay-size-contract">',
    ":root {",
    `  --ui-overlay-min-width-units: ${minWidth};`,
    `  --ui-overlay-min-height-units: ${minHeight};`,
    "  --ui-overlay-min-width: calc(var(--ui-overlay-min-width-units) * 1px);",
    "  --ui-overlay-min-height: calc(var(--ui-overlay-min-height-units) * 1px);",
    "}",
    "</style>",
  ].join("\n")
}
