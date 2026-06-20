import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const PACKAGES_ROOT = path.join(import.meta.dir, "..", "..", "..")
const OPENAPI_PATH = path.join(PACKAGES_ROOT, "sdk", "openapi.json")
const SDK_TYPES_PATH = path.join(PACKAGES_ROOT, "sdk", "js", "src", "gen", "types.gen.ts")

test("browser preview evidence SDK contract requires operationKind without a preview-capture default", () => {
  const openapi = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"))
  const schema =
    openapi.paths["/task/{taskID}/browser-preview/evidence/{evidenceID}"].get.responses["200"].content[
      "application/json"
    ].schema

  expect(schema.required).toContain("operationKind")
  expect(schema.properties.operationKind.default).toBeUndefined()

  const sdkTypes = fs.readFileSync(SDK_TYPES_PATH, "utf8")
  expect(sdkTypes).toContain('operationKind: "preview-capture" | "reference-comparison" | "source-binding"')
  expect(sdkTypes).not.toContain('operationKind?: "preview-capture"')
})
