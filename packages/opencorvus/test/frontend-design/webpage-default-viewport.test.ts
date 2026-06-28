import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

import {
  DEFAULT_WEBPAGE_EVIDENCE_VIEWPORT,
  describeDefaultWebpageEvidenceViewport,
} from "../../src/browser/webpage/default-viewport"

describe("frontend-design webpage evidence default viewport", () => {
  test("uses a common 2K desktop viewport", () => {
    expect(DEFAULT_WEBPAGE_EVIDENCE_VIEWPORT).toEqual({ width: 2560, height: 1440 })
    expect(describeDefaultWebpageEvidenceViewport()).toBe("2560x1440")
  })

  test("critical capture callpoints consume the shared default instead of local 1440x900 defaults", async () => {
    const files = [
      "src/browser/webpage/extract.ts",
      "src/frontend-design/capture-gate.ts",
      "src/frontend-design/tools/webpage-extract.ts",
      "src/frontend-design/tools/webpage-runtime-state.ts",
      "src/frontend-design/url-screenshot-tool.ts",
      "src/orchestrator/webpage-evidence.ts",
    ]
    const forbidden = [
      "?? 1440",
      "?? 900",
      "viewport_width: 1440",
      "viewport_height: 900",
      "viewport = { width: 1440",
      "viewport: { width: 1440, height: 900 }",
    ]

    for (const file of files) {
      const source = await fs.readFile(path.join(import.meta.dir, "../..", file), "utf8")
      expect(source).toMatch(/WEBPAGE_EVIDENCE_VIEWPORT|defaultWebpageEvidenceViewport/)
      for (const pattern of forbidden) {
        expect(source).not.toContain(pattern)
      }
    }
  })
})
