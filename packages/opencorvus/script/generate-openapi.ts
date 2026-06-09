#!/usr/bin/env bun

import { generateOpenApiSpec } from "../src/cli/cmd/generate"

const json = JSON.stringify(await generateOpenApiSpec(), null, 2)

await new Promise<void>((resolve, reject) => {
  process.stdout.write(json, (error) => {
    if (error) reject(error)
    else resolve()
  })
})
