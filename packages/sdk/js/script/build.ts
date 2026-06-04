#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import fs from "node:fs/promises"
import path from "path"

const openapi = path.join(dir, "openapi.json")
const rootOpenapi = path.join(dir, "..", "openapi.json")

import { createClient } from "@hey-api/openapi-ts"

const defaultsPath = path.resolve(dir, "..", "..", "opencorvus", "server-defaults.json")
const serverDefaults = (await Bun.file(defaultsPath).json()) as { host: string; port: number }
const defaultBaseUrl = `http://${serverDefaults.host}:${serverDefaults.port}`

async function rmWithinPackage(target: string, options: { recursive?: boolean } = {}) {
  const root = path.resolve(dir)
  const resolved = path.resolve(dir, target)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`refusing to delete path outside SDK package: ${resolved}`)
  }

  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      await fs.rm(resolved, { force: true, recursive: options.recursive ?? false })
      return
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : ""
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(code) || attempt === 20) throw error
      Bun.gc(true)
      await Bun.sleep(100 * attempt)
    }
  }
}

async function writeFileWithRetry(file: string, contents: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })

  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      await fs.writeFile(file, contents)
      return
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : ""
      if (!["EBUSY", "EUNKNOWN", "EPERM"].includes(code) || attempt === 20) throw error
      Bun.gc(true)
      await Bun.sleep(100 * attempt)
    }
  }
}

async function waitForGeneratedClient() {
  const checks = [
    {
      file: path.join(dir, "src", "gen", "client", "index.ts"),
      text: "ClientOptions",
    },
    {
      file: path.join(dir, "src", "gen", "client", "types.gen.ts"),
      text: "export interface Config",
    },
    {
      file: path.join(dir, "src", "gen", "sdk.gen.ts"),
      text: "export class OpencodeClient",
    },
  ]

  for (let attempt = 1; attempt <= 50; attempt++) {
    const ready = await Promise.all(
      checks.map(async (check) => {
        const content = await fs.readFile(check.file, "utf8").catch(() => "")
        return content.includes(check.text)
      }),
    )
    if (ready.every(Boolean)) return
    await Bun.sleep(100)
  }

  throw new Error("SDK generation did not materialize the expected client exports")
}

await writeFileWithRetry(
  path.join(dir, "src", "defaults.ts"),
  `// Auto-generated from packages/opencorvus/server-defaults.json by script/build.ts.\n` +
    `// Do not edit — regenerate via \`bun run build\`.\n\n` +
    `export const DEFAULT_SERVER_HOST = ${JSON.stringify(serverDefaults.host)}\n` +
    `export const DEFAULT_SERVER_PORT = ${serverDefaults.port}\n` +
    `export const DEFAULT_SERVER_URL = \`http://\${DEFAULT_SERVER_HOST}:\${DEFAULT_SERVER_PORT}\`\n`,
)

// Bootstrap: opencorvus's CLI loads commands that import "@opencorvus-ai/sdk",
// which in turn imports ./gen/*. After a clean (e.g. `rm -rf src/gen`) those
// modules are missing and `bun dev generate` fails to load. Write minimal
// stubs so the SDK module graph resolves; the real generation below replaces
// them. Stubs are not retained — the `rm -rf src/gen` after generate removes
// the entire dir and createClient writes fresh files.
await writeFileWithRetry(path.join(dir, "src", "gen", "types.gen.ts"), "export {}\n")
await writeFileWithRetry(
  path.join(dir, "src", "gen", "sdk.gen.ts"),
  "export class OpencodeClient { constructor(_?: unknown) {} }\n",
)
await writeFileWithRetry(
  path.join(dir, "src", "gen", "client", "types.gen.ts"),
  "export interface Config {}\n",
)
await writeFileWithRetry(
  path.join(dir, "src", "gen", "client", "client.gen.ts"),
  "export function createClient(_?: unknown): unknown { throw new Error('SDK not yet generated') }\n",
)
await writeFileWithRetry(
  path.join(dir, "src", "gen", "client", "index.ts"),
  "export {}\n",
)

await $`bun dev generate > ${openapi}`.cwd(path.resolve(dir, "../../opencorvus"))
await writeFileWithRetry(rootOpenapi, await Bun.file(openapi).text())
await rmWithinPackage("src/gen", { recursive: true })
await rmWithinPackage("dist", { recursive: true })

const generate = async (output: string) =>
  createClient({
    input: "./openapi.json",
    output: {
      path: output,
      tsConfigPath: path.join(dir, "tsconfig.json"),
      clean: true,
    },
    plugins: [
      {
        name: "@hey-api/typescript",
        exportFromIndex: false,
      },
      {
        name: "@hey-api/sdk",
        exportFromIndex: false,
        auth: false,
        paramsStructure: "flat",
        operations: {
          strategy: "single",
          containerName: "OpencodeClient",
          methods: "instance",
        },
      },
      {
        name: "@hey-api/client-fetch",
        exportFromIndex: false,
        baseUrl: defaultBaseUrl,
      },
    ],
  })

await generate("./src/gen")
await waitForGeneratedClient()

for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    await $`bun prettier --write src`
    break
  } catch (error) {
    if (attempt === 5) throw error
    Bun.gc(true)
    await Bun.sleep(500 * attempt)
  }
}
await $`bun tsc`
await rmWithinPackage("openapi.json")
