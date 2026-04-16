#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

const openapi = path.join(dir, "openapi.json")
const rootOpenapi = path.join(dir, "..", "openapi.json")

import { createClient } from "@hey-api/openapi-ts"

const defaultsPath = path.resolve(dir, "..", "..", "opencorvus", "server-defaults.json")
const serverDefaults = (await Bun.file(defaultsPath).json()) as { host: string; port: number }
const defaultBaseUrl = `http://${serverDefaults.host}:${serverDefaults.port}`

await Bun.write(
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
await Bun.write(path.join(dir, "src", "gen", "types.gen.ts"), "export {}\n")
await Bun.write(
  path.join(dir, "src", "gen", "sdk.gen.ts"),
  "export class OpencodeClient { constructor(_?: unknown) {} }\n",
)
await Bun.write(
  path.join(dir, "src", "gen", "client", "types.gen.ts"),
  "export interface Config {}\n",
)
await Bun.write(
  path.join(dir, "src", "gen", "client", "client.gen.ts"),
  "export function createClient(_?: unknown): unknown { throw new Error('SDK not yet generated') }\n",
)
await Bun.write(
  path.join(dir, "src", "gen", "client", "index.ts"),
  "export {}\n",
)

await $`bun dev generate > ${openapi}`.cwd(path.resolve(dir, "../../opencorvus"))
await Bun.write(rootOpenapi, await Bun.file(openapi).text())
await $`rm -rf src/gen dist`

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

await $`bun prettier --write src`
await $`bun tsc`
await $`rm openapi.json`
