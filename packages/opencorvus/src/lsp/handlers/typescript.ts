import { spawn, BunProc, Instance, NearestRoot, log } from "../shared"
import type { Info } from "../shared"

export const Typescript: Info = {
  id: "typescript",
  root: NearestRoot(
    ["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"],
    ["deno.json", "deno.jsonc"],
  ),
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
  async spawn(root) {
    const tsserver = await Bun.resolve("typescript/lib/tsserver.js", Instance.directory).catch(() => {})
    log.info("typescript server", { tsserver })
    if (!tsserver) return
    const proc = spawn(BunProc.which(), ["x", "typescript-language-server", "--stdio"], {
      cwd: root,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    })
    return {
      process: proc,
      initialization: {
        tsserver: {
          path: tsserver,
        },
      },
    }
  },
}
