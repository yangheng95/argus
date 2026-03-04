import { Automation } from "./engine"
import { PlaywrightDriver } from "./adapters/playwright"
import { AppiumDriver } from "./adapters/appium"

export type DriverKind = "auto" | "desktop" | "playwright" | "appium"

export interface DriverInput {
  kind?: DriverKind
  desktop?: Automation.Driver
  playwright?: PlaywrightDriver.Opt
  appium?: AppiumDriver.Opt
}

export interface DriverResult {
  kind: Exclude<DriverKind, "auto">
  driver: Automation.Driver
}

function valid(value: string | undefined): DriverKind | null {
  if (!value) return null
  const next = value.trim().toLowerCase()
  if (next === "auto") return "auto"
  if (next === "desktop") return "desktop"
  if (next === "playwright") return "playwright"
  if (next === "appium") return "appium"
  return null
}

function create(input: DriverInput, kind: Exclude<DriverKind, "auto">) {
  if (kind === "desktop") {
    if (!input.desktop) return null
    return { kind, driver: input.desktop } satisfies DriverResult
  }
  if (kind === "playwright") {
    if (!input.playwright) return null
    return { kind, driver: PlaywrightDriver.create(input.playwright) } satisfies DriverResult
  }
  if (kind === "appium") {
    if (!input.appium) return null
    return { kind, driver: AppiumDriver.create(input.appium) } satisfies DriverResult
  }
  return null
}

export function selectDriver(input: DriverInput): DriverResult {
  const wanted = input.kind ?? valid(process.env.OPENCORVUS_AUTOMATION_DRIVER) ?? "auto"
  if (wanted !== "auto") {
    const chosen = create(input, wanted)
    if (chosen) return chosen
    throw new Error(`Requested automation driver is unavailable (requested=${wanted})`)
  }

  const order: Array<Exclude<DriverKind, "auto">> = ["playwright", "appium", "desktop"]
  const auto = order
    .map((kind) => create(input, kind))
    .find((value) => !!value)
  if (auto) return auto

  throw new Error(`No automation driver available (requested=${wanted})`)
}
