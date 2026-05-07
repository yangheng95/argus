#!/usr/bin/env bun
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "..", "..", "..")

process.env.OPENCORVUS_E2E_VISUAL = "1"
process.env.OPENCORVUS_E2E_VISUAL_DIR ??= path.join(repoRoot, "tmp", "vscode-extension-visual-e2e")
process.env.OPENCORVUS_E2E_VISUAL_SETTLE_MS ??= "1000"

await import("./e2e-vscode")
