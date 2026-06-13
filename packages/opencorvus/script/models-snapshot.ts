import { pathToFileURL } from "url"
import { ModelsDev } from "../src/provider/models"

type ModelsSnapshot = Record<string, ModelsDev.Provider>

function assertSnapshot(input: unknown): ModelsSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("models snapshot data must be a provider object")
  }
  return input as ModelsSnapshot
}

export async function readExistingModelsSnapshot(modelsSnapshotPath: string): Promise<ModelsSnapshot> {
  const moduleUrl = `${pathToFileURL(modelsSnapshotPath).href}?snapshot=${Date.now()}`
  const module = (await import(moduleUrl)) as { snapshot?: unknown }
  if (!module.snapshot) throw new Error(`Existing models snapshot is not parseable: ${modelsSnapshotPath}`)
  return assertSnapshot(module.snapshot)
}

export function withLocalHexinProvider(input: unknown): ModelsSnapshot {
  return ModelsDev.withLocalProviders(assertSnapshot(input))
}

export async function resolveModelsSnapshotData(input: {
  modelsSnapshotPath: string
  modelsUrl: string
}): Promise<string> {
  if (process.env.MODELS_DEV_API_JSON) {
    const raw = await Bun.file(process.env.MODELS_DEV_API_JSON).text()
    return JSON.stringify(withLocalHexinProvider(JSON.parse(raw)))
  }

  if (process.env.OPENCORVUS_DISABLE_MODELS_FETCH === "true") {
    return JSON.stringify(withLocalHexinProvider(await readExistingModelsSnapshot(input.modelsSnapshotPath)))
  }

  const response = await fetch(`${input.modelsUrl}/api.json`)
  if (!response.ok) {
    throw new Error(`models.dev snapshot fetch failed: ${response.status} ${response.statusText}`)
  }
  return JSON.stringify(withLocalHexinProvider(await response.json()))
}
