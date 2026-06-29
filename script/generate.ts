#!/usr/bin/env bun

import { $ } from "bun"
import { GENERATED_ARTIFACT_PATHS } from "./generated-artifacts"

await $`bun ./packages/sdk/js/script/build.ts`

await $`bun ./packages/opencorvus/script/docs/render-api-md.ts`

const prettier = Bun.spawn(["bun", "run", "prettier", "--ignore-unknown", "--write", ...GENERATED_ARTIFACT_PATHS], {
  stdout: "inherit",
  stderr: "inherit",
})
const code = await prettier.exited
if (code !== 0) throw new Error(`prettier failed with exit code ${code}`)
