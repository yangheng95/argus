#!/usr/bin/env bun

import { $ } from "bun"
import { GENERATED_ARTIFACT_PATHS } from "./generated-artifacts"

// MDX means Markdown with JSX. API MDX files are byte-checked against the docs renderer output.
const API_MDX_ARTIFACT_PATHS = new Set([
  "packages/web/src/content/docs/reference/api.mdx",
  "packages/web/src/content/docs/zh-cn/reference/api.mdx",
])
const prettierArtifactPaths = GENERATED_ARTIFACT_PATHS.filter((artifact) => !API_MDX_ARTIFACT_PATHS.has(artifact))

await $`bun ./packages/sdk/js/script/build.ts`

await $`bun ./packages/opencorvus/script/docs/render-api-md.ts`

const prettier = Bun.spawn(["bun", "run", "prettier", "--ignore-unknown", "--write", ...prettierArtifactPaths], {
  stdout: "inherit",
  stderr: "inherit",
})
const code = await prettier.exited
if (code !== 0) throw new Error(`prettier failed with exit code ${code}`)
