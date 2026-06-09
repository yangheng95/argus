#!/usr/bin/env bun

import { $ } from "bun"

await $`bun ./packages/sdk/js/script/build.ts`

await $`bun ./script/generate-openapi.ts > ../sdk/openapi.json`.cwd("packages/opencorvus")

await $`bun ./script/format.ts`
