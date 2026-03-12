#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

const openapi = path.join(dir, "openapi.json")
const rootOpenapi = path.join(dir, "..", "openapi.json")

import { createClient } from "@hey-api/openapi-ts"

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
        baseUrl: "http://localhost:7878",
      },
    ],
  })

await generate("./src/v2/gen")

await $`bun prettier --write src/v2`
await $`bun tsc`
await $`rm openapi.json`
