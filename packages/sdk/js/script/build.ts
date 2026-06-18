#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import fs from "node:fs/promises"
import path from "path"
import { replaceDirectoryAfterSuccessfulBuild } from "./generation-transaction"

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
      const code =
        error && typeof error === "object" && "code" in error ? String((error as NodeJS.ErrnoException).code) : ""
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
      const code =
        error && typeof error === "object" && "code" in error ? String((error as NodeJS.ErrnoException).code) : ""
      if (!["EBUSY", "EUNKNOWN", "EPERM"].includes(code) || attempt === 20) throw error
      Bun.gc(true)
      await Bun.sleep(100 * attempt)
    }
  }
}

async function waitForGeneratedClient(root = path.join(dir, "src", "gen")) {
  const checks = [
    {
      file: path.join(root, "client", "index.ts"),
      text: "ClientOptions",
    },
    {
      file: path.join(root, "client", "types.gen.ts"),
      text: "export interface Config",
    },
    {
      file: path.join(root, "sdk.gen.ts"),
      text: "export class OpenCorvusClient",
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

type OpenApiOperation = {
  operationId?: string
  requestBody?: {
    required?: boolean
    content?: Record<string, { schema?: { required?: unknown } }>
  }
}

type OpenApiSpec = {
  paths?: Record<string, Record<string, OpenApiOperation>>
}

function methodNameFromOperationID(operationID: string): string {
  const parts = operationID.split(".")
  return parts[parts.length - 1] || operationID
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function requireFlatSdkBodyFieldsFromOpenApi() {
  const spec = (await Bun.file(rootOpenapi).json()) as OpenApiSpec
  const sdkPath = path.join(dir, "src", "gen", "sdk.gen.ts")
  let source = await Bun.file(sdkPath).text()

  for (const [routePath, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const operation of Object.values(pathItem)) {
      const operationID = operation.operationId
      const schema = operation.requestBody?.content?.["application/json"]?.schema
      const requiredFields = Array.isArray(schema?.required)
        ? schema.required.filter((field): field is string => typeof field === "string")
        : []
      if (!operationID || operation.requestBody?.required !== true || requiredFields.length === 0) continue

      const methodName = methodNameFromOperationID(operationID)
      const methodPattern = new RegExp(`\\n  public ${escapeRegex(methodName)}<`, "g")
      let match: RegExpExecArray | null
      while ((match = methodPattern.exec(source))) {
        const start = match.index
        const rest = source.slice(start + 1)
        const nextMethod = rest.search(/\n  public \w+</)
        const nextClass = rest.search(/\n}\n\nexport class /)
        const endCandidates = [nextMethod, nextClass].filter((value) => value > 0)
        const end = endCandidates.length ? start + 1 + Math.min(...endCandidates) : source.length
        let block = source.slice(start, end)
        if (!block.includes(`url: "${routePath}"`)) continue

        let changed = false
        for (const field of requiredFields) {
          if (!block.includes(`{ in: "body", key: "${field}" }`)) continue
          const fieldPattern = new RegExp(`(\\n\\s*)(${escapeRegex(field)})(\\?:)`, "g")
          block = block.replace(fieldPattern, (_match, indent: string, key: string) => {
            changed = true
            return `${indent}${key}:`
          })
        }
        if (changed) {
          source = `${source.slice(0, start)}${block}${source.slice(end)}`
        }
        break
      }
    }
  }

  await writeFileWithRetry(sdkPath, source)
}

await writeFileWithRetry(
  path.join(dir, "src", "defaults.ts"),
  `// Auto-generated from packages/opencorvus/server-defaults.json by script/build.ts.\n` +
    `// Do not edit — regenerate via \`bun run build\`.\n\n` +
    `export const DEFAULT_SERVER_HOST = ${JSON.stringify(serverDefaults.host)}\n` +
    `export const DEFAULT_SERVER_PORT = ${serverDefaults.port}\n` +
    `export const DEFAULT_SERVER_URL = \`http://\${DEFAULT_SERVER_HOST}:\${DEFAULT_SERVER_PORT}\`\n`,
)

const generatedOpenapi = await $`bun ./script/generate-openapi.ts`.cwd(path.resolve(dir, "../../opencorvus")).text()
await writeFileWithRetry(openapi, generatedOpenapi)
await writeFileWithRetry(rootOpenapi, await Bun.file(openapi).text())
await rmWithinPackage("dist", { recursive: true })

const generate = async (output: string) =>
  createClient({
    input: openapi,
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
          containerName: "OpenCorvusClient",
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

await replaceDirectoryAfterSuccessfulBuild({
  packageRoot: dir,
  stagingRelative: ".tmp-sdk-gen",
  targetRelative: "src/gen",
  build: async (stagingDir) => {
    await generate(stagingDir)
    await waitForGeneratedClient(stagingDir)
  },
})

const prettierBin = await Bun.resolve("prettier/bin/prettier.cjs", dir)
for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    await $`bun ${prettierBin} --write src`
    break
  } catch (error) {
    if (attempt === 5) throw error
    Bun.gc(true)
    await Bun.sleep(500 * attempt)
  }
}
await requireFlatSdkBodyFieldsFromOpenApi()
await $`bun tsc`
await rmWithinPackage("openapi.json")
