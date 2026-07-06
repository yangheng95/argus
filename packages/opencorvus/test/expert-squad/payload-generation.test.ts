import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  renderExpertSquadPayloadModule,
  resolveExpertSquadPayloadModulePath,
} from "../../script/generate-expert-squad-payload"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")

describe("expert squad payload generation", () => {
  test("checked-in payload module is generated from repository expert-squad packages", async () => {
    const modulePath = resolveExpertSquadPayloadModulePath(repoRoot)
    expect(await fs.readFile(modulePath, "utf8")).toBe(await renderExpertSquadPayloadModule(repoRoot))
  })
})
