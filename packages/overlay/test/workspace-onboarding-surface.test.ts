import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")
const source = readFileSync(join(OVERLAY_ROOT, "src/styles/surfaces/workspace-onboarding.css"), "utf8")

test("workspace onboarding surface stays flat and non-semantic", () => {
  expect(source).not.toMatch(/linear-gradient/i)
  expect(source).not.toMatch(/var\(--good\)/)
  expect(source).toMatch(/\.workspace-onboarding-recent\s*\{[\s\S]*border:/)
  expect(source).toMatch(/\.workspace-onboarding-action\[data-busy="true"\]\s*\{/)
})
