import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const repo = resolve(import.meta.dir, "../../../..")

function readRepo(relativePath: string): string {
  return readFileSync(resolve(repo, relativePath), "utf8")
}

function sdkMethodBlock(source: string, input: { methodName: string; url: string; httpCall: string }): string {
  const methodMarker = `  public ${input.methodName}<`
  let index = -1
  while ((index = source.indexOf(methodMarker, index + 1)) >= 0) {
    const nextMethod = source.indexOf("\n  public ", index + 1)
    const end = nextMethod > 0 ? nextMethod : source.length
    const block = source.slice(index, end)
    if (block.includes(`url: "${input.url}"`) && block.includes(`.${input.httpCall}<`)) return block
  }
  throw new Error(`SDK method block not found: ${input.methodName} ${input.httpCall} ${input.url}`)
}

function generatedTypeBlock(source: string, typeName: string): string {
  const start = source.indexOf(`export type ${typeName} =`)
  if (start < 0) throw new Error(`Generated type not found: ${typeName}`)
  const next = source.indexOf("\nexport type ", start + 1)
  return source.slice(start, next > 0 ? next : source.length)
}

type SdkClassSurface = {
  methods: Set<string>
  getters: Map<string, string>
}

function parseSdkSurface(source: string): Map<string, SdkClassSurface> {
  const classes = new Map<string, SdkClassSurface>()
  const classPattern = /export class ([A-Za-z_$][\w$]*) extends HeyApiClient \{/g
  const starts: Array<{ name: string; index: number }> = []
  let classMatch: RegExpExecArray | null
  while ((classMatch = classPattern.exec(source))) {
    starts.push({ name: classMatch[1], index: classMatch.index })
  }
  for (let index = 0; index < starts.length; index += 1) {
    const current = starts[index]
    const next = starts[index + 1]
    const block = source.slice(current.index, next?.index ?? source.length)
    const methods = new Set<string>()
    const getters = new Map<string, string>()
    let methodMatch: RegExpExecArray | null
    const methodPattern = /\n  public ([A-Za-z_$][\w$]*)</g
    while ((methodMatch = methodPattern.exec(block))) methods.add(methodMatch[1])
    let getterMatch: RegExpExecArray | null
    const getterPattern = /\n  get ([A-Za-z_$][\w$]*)\(\): ([A-Za-z_$][\w$]*) \{/g
    while ((getterMatch = getterPattern.exec(block))) getters.set(getterMatch[1], getterMatch[2])
    classes.set(current.name, { methods, getters })
  }
  return classes
}

function javascriptSampleAccessor(source: string): string {
  const match = source.match(/await client\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(\{/)
  if (!match) throw new Error(`JavaScript sample is missing an SDK call:\n${source}`)
  return match[1]
}

function assertSdkAccessorExists(classes: Map<string, SdkClassSurface>, accessor: string): void {
  const segments = accessor.split(".")
  let className = "OpenCorvusClient"
  for (const segment of segments.slice(0, -1)) {
    const surface = classes.get(className)
    if (!surface) throw new Error(`SDK class not found while resolving ${accessor}: ${className}`)
    const nextClass = surface.getters.get(segment)
    if (!nextClass) {
      throw new Error(`SDK getter not found while resolving ${accessor}: ${className}.${segment}`)
    }
    className = nextClass
  }
  const method = segments[segments.length - 1]
  const surface = classes.get(className)
  if (!surface) throw new Error(`SDK class not found while resolving ${accessor}: ${className}`)
  if (!surface.methods.has(method))
    throw new Error(`SDK method not found while resolving ${accessor}: ${className}.${method}`)
}

function openApiSampleAccessors(openapi: any): Array<{ operationID: string; accessor: string }> {
  const samples: Array<{ operationID: string; accessor: string }> = []
  for (const [path, item] of Object.entries(openapi.paths ?? {}) as Array<[string, any]>) {
    for (const method of ["get", "post", "put", "delete", "patch"]) {
      const operation = item?.[method]
      if (!operation || typeof operation !== "object") continue
      if (!operation.operationId) {
        throw new Error(`OpenAPI operation ${method.toUpperCase()} ${path} is missing operationId`)
      }
      const jsSample = operation["x-codeSamples"]?.find((sample: any) => sample?.lang === "js")
      if (!jsSample?.source)
        throw new Error(`OpenAPI operation ${operation.operationId} is missing a JavaScript sample`)
      samples.push({
        operationID: operation.operationId,
        accessor: javascriptSampleAccessor(jsSample.source),
      })
    }
  }
  return samples
}

describe("SDK build format contract", () => {
  test("SDK build resolves the repository Prettier binary instead of invoking a package script", () => {
    const source = readRepo("packages/sdk/js/script/build.ts")

    expect(source).toContain('Bun.resolve("prettier/bin/prettier.cjs"')
    expect(source).toContain("bun ${prettierBin} --write ${transactionSrc}")
    expect(source).not.toContain("bun prettier --write src")
    expect(source).not.toContain("bun run prettier")
  })

  test("typecheck workflow diffs the generated artifact authority", () => {
    const workflow = readRepo(".github/workflows/typecheck.yml")
    const build = readRepo("packages/sdk/js/script/build.ts")
    const generatedArtifacts = readRepo("script/generated-artifacts.ts")

    expect(build).toContain("replaceGeneratedArtifactsAfterSuccessfulBuild({")
    expect(build).toContain('stagingRelative: "js/.tmp-sdk-artifacts"')
    expect(build).toContain('targetRelative: "js/src/gen"')
    expect(build).not.toContain('rmWithinPackage("src/gen"')
    expect(build).not.toContain('writeFileWithRetry(path.join(dir, "src", "gen"')
    expect(generatedArtifacts).toContain("GENERATED_ARTIFACT_PATHS")
    expect(generatedArtifacts).toContain('"packages/sdk/js/src/gen"')
    expect(generatedArtifacts).toContain('"packages/sdk/js/src/route-policy.ts"')
    expect(generatedArtifacts).toContain('"packages/opencorvus/src/provider/models-snapshot.ts"')
    expect(generatedArtifacts).toContain('"packages/opencorvus/src/expert-squad/payload.ts"')
    expect(readRepo("script/generate.ts")).toContain("CANONICAL_TEXT_ARTIFACT_PATHS")
    expect(readRepo("script/generate.ts")).toContain('"packages/sdk/openapi.json"')
    expect(readRepo("script/generate.ts")).toContain("OPENCORVUS_BUILD_ARTIFACT_PATHS")
    expect(readRepo("script/generate.ts")).toContain('"packages/opencorvus/src/expert-squad/payload.ts"')
    expect(readRepo("script/generate.ts")).toContain('"packages/opencorvus/src/provider/models-snapshot.ts"')
    expect(workflow).toContain("./script/generate.ts")
    expect(workflow).toContain("bun ./script/generated-artifacts.ts --check-clean-worktree")
    expect(workflow).not.toContain("mapfile -t GENERATED_ARTIFACTS")
    expect(workflow).not.toContain('git diff --exit-code -- "${GENERATED_ARTIFACTS[@]}"')
    expect(generatedArtifacts).toContain("Generated artifact drift:")
    expect(generatedArtifacts).toContain("--check-clean-worktree")
    expect(workflow).not.toContain("packages/sdk/js/src/gen packages/sdk/js/src/defaults.ts packages/sdk/openapi.json")
    expect(workflow).not.toContain("bun ./packages/sdk/js/script/build.ts")
    expect(workflow).not.toContain("packages/sdk/js/src/v2/gen")
  })

  test("SDK build materializes the package dist surface declared by package.json", () => {
    const build = readRepo("packages/sdk/js/script/build.ts")
    const publish = readRepo("packages/sdk/js/script/publish.ts")
    const npmrc = readRepo(".npmrc")
    const packageJson = JSON.parse(readRepo("packages/sdk/js/package.json")) as {
      exports: Record<string, Record<string, string>>
      files: string[]
      publishConfig?: Record<string, unknown>
      scripts: Record<string, string>
    }

    expect(packageJson.files).toEqual(["dist"])
    expect(packageJson.publishConfig).toBeUndefined()
    expect(npmrc).toContain("tag=alpha")
    expect(packageJson.scripts.prepack).toBe("bun run build")
    expect(packageJson.scripts.prepublishOnly).toBe("bun run build")
    for (const exported of Object.values(packageJson.exports)) {
      expect(exported.types).toMatch(/^\.\/dist\/.+\.d\.ts$/)
      for (const target of Object.values(exported)) {
        expect(target).toMatch(/^\.\/dist\/.+\.(?:js|d\.ts)$/)
        expect(target).not.toContain("./src/")
      }
    }

    expect(build).toContain('const transactionDist = path.join(transactionRoot, "dist")')
    expect(build).toContain('stagingRelative: "js/.tmp-sdk-artifacts"')
    expect(build).toContain('targetRelative: "js/dist"')
    expect(build).toContain('await fs.cp(transactionDist, path.join(stagingRoot, "dist")')
    expect(build).not.toContain('await rmWithinPackage("dist"')

    expect(publish.indexOf("await $`bun run build`")).toBeLessThan(
      publish.indexOf("await $`bun pm pack --ignore-scripts --destination ${packDirectory} --filename ${packFilename}`"),
    )
    expect(publish).toContain("buildPublishPackageJson(pkg as SdkPackageJson)")
    expect(publish).not.toContain('await Bun.write("package.json"')
  })

  test("SDK publish manifest validates dist conditional exports", async () => {
    const publish = readRepo("packages/sdk/js/script/publish.ts")
    const build = readRepo("packages/sdk/js/script/build.ts")
    const client = readRepo("packages/sdk/js/src/client.ts")
    const routePolicy = readRepo("packages/sdk/js/src/route-policy.ts")
    const protocol = readRepo("packages/transport-protocol/src/index.ts")
    const { buildPublishPackageJson } = (await import(
      pathToFileURL(resolve(repo, "packages/sdk/js/script/publish-manifest.ts")).href
    )) as typeof import("../../../../packages/sdk/js/script/publish-manifest")
    const packageJson = JSON.parse(readRepo("packages/sdk/js/package.json"))
    const published = buildPublishPackageJson(packageJson)

    expect(publish).toContain("buildPublishPackageJson")
    expect(publish).not.toContain("function transformExports")
    expect(build).toContain("generatedRoutePolicySource")
    expect(build).toContain(
      'const routePolicySourcePath = path.resolve(dir, "..", "..", "transport-protocol", "src", "index.ts")',
    )
    expect(build).toContain('const transactionRoutePolicy = path.join(transactionSrc, "route-policy.ts")')
    expect(build).toContain('await writeFileWithRetry(path.join(stagingRoot, "route-policy.ts"), generatedRoutePolicy)')
    expect(build).toContain('targetRelative: "js/src/route-policy.ts"')
    expect(client).toContain('from "./route-policy.js"')
    expect(client).not.toContain("@opencorvus-ai/transport-protocol")
    expect(routePolicy).toContain("Auto-generated from packages/transport-protocol/src/index.ts")
    expect(routePolicy).toContain("export function routeRequiresProjectDirectory")
    expect(protocol).toContain(routePolicy.split("\n").slice(3).join("\n").trim())
    expect(JSON.stringify(packageJson.dependencies ?? {})).not.toContain("workspace:")
    expect(JSON.stringify(published.dependencies ?? {})).not.toContain("workspace:")
    expect(published.dependencies ?? {}).not.toHaveProperty("@opencorvus-ai/transport-protocol")
    expect(published.exports).toEqual(packageJson.exports)

    for (const [subpath, conditions] of Object.entries(published.exports as Record<string, Record<string, unknown>>)) {
      expect(conditions && typeof conditions === "object" && !Array.isArray(conditions)).toBe(true)
      for (const [condition, target] of Object.entries(conditions)) {
        expect(typeof target).toBe("string")
        expect(target).toContain("./dist/")
        if (condition === "types") {
          expect(target).toMatch(/\.d\.ts$/)
          expect(target).not.toContain(".d.d.ts")
        } else if (condition === "import" || condition === "default") {
          expect(target).toMatch(/\.js$/)
          expect(target).not.toMatch(/\.d\.js$/)
        } else {
          throw new Error(`unexpected SDK publish export condition ${subpath}.${condition}`)
        }
      }
    }

    expect(() =>
      buildPublishPackageJson({
        exports: {
          ".": {
            types: "./dist/index.d.ts",
            import: "./src/index.ts",
            default: "./dist/index.js",
          },
        },
      }),
    ).toThrow("generated dist module")
  })

  test("SDK publish targets the current tarball instead of a directory glob", () => {
    const publish = readRepo("packages/sdk/js/script/publish.ts")

    expect(publish).toContain('const packDirectory = path.join(dir, ".tmp-sdk-pack")')
    expect(publish).toContain("const packFilename =")
    expect(publish).toContain("await rm(packDirectory, { recursive: true, force: true })")
    expect(publish).toContain("await $`bun pm pack --ignore-scripts --destination ${packDirectory} --filename ${packFilename}`")
    expect(publish).toContain("await $`npm publish ${packPath} --access public`")
    expect(publish).not.toContain("Script.channel")
    expect(publish).not.toContain("--tag")
    expect(publish).not.toContain("npm publish *.tgz")
    expect(publish).not.toContain("bun pm pack`")
    expect(publish).not.toContain("publishConfig")
  })

  test("SDK build uses the registered root OpenAPI artifact as its only OpenAPI output", () => {
    const build = readRepo("packages/sdk/js/script/build.ts")

    expect(build).toContain('const sdkRoot = path.resolve(dir, "..")')
    expect(build).toContain('const transactionOpenapi = path.join(transactionRoot, "openapi.json")')
    expect(build).toContain('targetRelative: "openapi.json"')
    expect(build).toContain('await writeFileWithRetry(path.join(stagingRoot, "openapi.json"), generatedOpenapi)')
    expect(build).toContain("await generate(transactionOpenapi, transactionGen)")
    expect(build).not.toContain('path.join(dir, "openapi.json")')
    expect(build).not.toContain('rmWithinPackage("openapi.json")')
  })

  test("SDK build validates staged generated artifacts before committing all real outputs together", () => {
    const build = readRepo("packages/sdk/js/script/build.ts")
    const typecheckIndex = build.indexOf("await $`bun tsc --project ${transactionTsconfig}`")
    const transactionCommitIndex = build.indexOf("await replaceGeneratedArtifactsAfterSuccessfulBuild({")

    expect(build).toContain('const transactionRelative = ".tmp-sdk-build"')
    expect(build).toContain("await writeFileWithRetry(transactionDefaults, generatedDefaults)")
    expect(build).toContain("await writeFileWithRetry(transactionOpenapi, generatedOpenapi)")
    expect(build).toContain("await requireFlatSdkBodyFieldsFromOpenApi({")
    expect(build).toContain('targetRelative: "js/dist"')
    expect(build).toContain('targetRelative: "js/src/gen"')
    expect(build).toContain('targetRelative: "js/src/defaults.ts"')
    expect(build).toContain('targetRelative: "js/src/route-policy.ts"')
    expect(build).toContain('targetRelative: "openapi.json"')
    expect(build).not.toContain('writeFileWithRetry(path.join(dir, "src", "defaults.ts")')
    expect(build).not.toContain('writeFileWithRetry(path.join(dir, "src", "route-policy.ts")')
    expect(typecheckIndex).toBeGreaterThan(0)
    expect(transactionCommitIndex).toBeGreaterThan(typecheckIndex)
  })

  test("SDK build writes generated files through an atomic temp-file rename retry", () => {
    const build = readRepo("packages/sdk/js/script/build.ts")

    expect(build).toContain("const tempFile = path.join(directory")
    expect(build).toContain("await fs.writeFile(tempFile, contents)")
    expect(build).toContain("await fs.rename(tempFile, file)")
    expect(build).not.toContain("await fs.writeFile(file, contents)")
  })

  test("OpenAPI generation does not import the SDK client before SDK generation", () => {
    const plugin = readRepo("packages/opencorvus/src/plugin/index.ts")

    expect(plugin).not.toContain('import { createOpenCorvusClient } from "@opencorvus-ai/sdk"')
    expect(plugin).toContain('await import("@opencorvus-ai/sdk")')
  })

  test("file item OpenAPI and SDK expose route error contracts", () => {
    const openapi = JSON.parse(readRepo("packages/sdk/openapi.json"))
    const item = openapi.paths["/file/item"]
    const copyItem = openapi.paths["/file/item/copy"]
    const upload = openapi.paths["/file/upload"]

    expect(Object.keys(item.post.responses).sort()).toEqual(["200", "400", "404", "409"])
    expect(Object.keys(copyItem.post.responses).sort()).toEqual(["200", "400", "404", "409"])
    expect(Object.keys(item.patch.responses).sort()).toEqual(["200", "400", "404", "409"])
    expect(Object.keys(item.delete.responses).sort()).toEqual(["200", "400", "404"])
    expect(Object.keys(upload.post.responses).sort()).toEqual(["200", "400", "409"])

    const types = readRepo("packages/sdk/js/src/gen/types.gen.ts")
    expect(types).toContain("export type FileCreateErrors")
    expect(types).toContain("export type FileCopyErrors")
    expect(types).toContain("export type FileMoveErrors")
    expect(types).toContain("export type FileDeleteErrors")
    expect(types).toContain("export type FileUploadErrors")
  })

  test("coding and experimental schedule OpenAPI expose route error contracts", () => {
    const openapi = JSON.parse(readRepo("packages/sdk/openapi.json"))

    expect(Object.keys(openapi.paths["/coding/cli/profiles"].get.responses).sort()).toEqual(["200", "400"])
    expect(Object.keys(openapi.paths["/coding/cli/open"].post.responses).sort()).toEqual(["200", "400"])
    expect(Object.keys(openapi.paths["/coding/sessions"].get.responses).sort()).toEqual(["200", "400"])
    expect(Object.keys(openapi.paths["/coding/session/{sessionID}"].get.responses).sort()).toEqual(["200", "404"])
    expect(Object.keys(openapi.paths["/coding/session/{sessionID}"].patch.responses).sort()).toEqual(["200", "404"])
    expect(Object.keys(openapi.paths["/coding/session/{sessionID}"].delete.responses).sort()).toEqual(["200", "404"])
    expect(Object.keys(openapi.paths["/coding/session/{sessionID}/selection"].patch.responses).sort()).toEqual([
      "200",
      "404",
    ])
    expect(Object.keys(openapi.paths["/experimental/schedule/{id}"].delete.responses).sort()).toEqual([
      "200",
      "400",
      "404",
    ])
    expect(Object.keys(openapi.paths["/experimental/event-schedule/{id}"].delete.responses).sort()).toEqual([
      "200",
      "400",
      "404",
    ])

    const types = readRepo("packages/sdk/js/src/gen/types.gen.ts")
    for (const typeName of [
      "CodingCliProfilesErrors",
      "CodingCliOpenErrors",
      "CodingSessionsListErrors",
      "CodingSessionGetErrors",
      "CodingSessionUpdateErrors",
      "CodingSessionDeleteErrors",
      "CodingSessionSelectionUpdateErrors",
      "ExperimentalScheduleDeleteErrors",
      "ExperimentalEventscheduleDeleteErrors",
    ]) {
      expect(types).toContain(`export type ${typeName}`)
    }
  })

  test("file read, global session, and MCP OpenAPI expose fail-fast contracts", () => {
    const openapi = JSON.parse(readRepo("packages/sdk/openapi.json"))

    expect(Object.keys(openapi.paths["/file/content"].get.responses).sort()).toEqual(["200", "404", "500"])
    expect(JSON.stringify(openapi.paths["/file/content"].get.responses["404"])).toContain("FileNotFoundError")
    expect(JSON.stringify(openapi.paths["/file/content"].get.responses["500"])).toContain("UnknownError")

    const sessionGlobal = openapi.paths["/session/global"].get
    expect(Object.keys(sessionGlobal.responses).sort()).toEqual(["200", "400"])
    expect(Object.keys(sessionGlobal.responses["200"].headers).sort()).toEqual([
      "x-next-cursor-session-id",
      "x-next-cursor-updated",
    ])
    const sessionGlobalParameters = new Set(sessionGlobal.parameters.map((parameter: any) => parameter.name))
    expect(sessionGlobalParameters.has("cursor")).toBe(false)
    expect(sessionGlobalParameters.has("cursorUpdated")).toBe(true)
    expect(sessionGlobalParameters.has("cursorSessionID")).toBe(true)

    expect(Object.keys(openapi.paths["/mcp/{name}/connect"].post.responses).sort()).toEqual(["200", "404", "500"])
    expect(JSON.stringify(openapi.paths["/mcp/{name}/connect"].post.responses["500"])).toContain("UnknownError")
    expect(Object.keys(openapi.paths["/mcp/{name}/disconnect"].post.responses).sort()).toEqual(["200", "404"])
    expect(Object.keys(openapi.paths["/mcp/{name}/auth"].post.responses).sort()).toEqual(["200", "400", "404", "500"])
    expect(JSON.stringify(openapi.paths["/mcp/{name}/auth"].post.responses["500"])).toContain("UnknownError")
    expect(Object.keys(openapi.paths["/mcp/{name}/auth"].delete.responses).sort()).toEqual(["200", "404", "500"])
    expect(JSON.stringify(openapi.paths["/mcp/{name}/auth"].delete.responses["500"])).toContain("UnknownError")
    expect(Object.keys(openapi.paths["/mcp/{name}/auth/callback"].post.responses).sort()).toEqual([
      "200",
      "400",
      "404",
      "500",
    ])
    const mcpAuthCallbackRequestSchema =
      openapi.paths["/mcp/{name}/auth/callback"].post.requestBody.content["application/json"].schema
    expect(mcpAuthCallbackRequestSchema.required.sort()).toEqual(["code", "state"])
    expect(Object.keys(mcpAuthCallbackRequestSchema.properties).sort()).toEqual(["code", "state"])
    const mcpAuthCallback400 = JSON.stringify(openapi.paths["/mcp/{name}/auth/callback"].post.responses["400"])
    expect(mcpAuthCallback400).toContain('"$ref":"#/components/schemas/BadRequestError"')
    expect(mcpAuthCallback400).toContain("MCPOAuthStateError")
    expect(mcpAuthCallback400).not.toContain('"const":"BadRequestError"')
    const badRequestSchema = JSON.stringify(openapi.components.schemas.BadRequestError)
    expect(badRequestSchema).toContain('"error"')
    expect(badRequestSchema).not.toContain('"errors"')
    expect(Object.keys(openapi.paths["/mcp/{name}/auth/authenticate"].post.responses).sort()).toEqual([
      "200",
      "400",
      "404",
      "500",
    ])
    expect(JSON.stringify(openapi.paths["/mcp/{name}/auth/callback"].post.responses["500"])).toContain("UnknownError")
    expect(JSON.stringify(openapi.paths["/mcp/{name}/auth/authenticate"].post.responses["400"])).toContain(
      "BadRequestError",
    )
    expect(Object.keys(openapi.paths["/experimental/resource"].get.responses).sort()).toEqual(["200", "500"])
    expect(JSON.stringify(openapi.paths["/experimental/resource"].get.responses["500"])).toContain("UnknownError")
    expect(Object.keys(openapi.paths["/command"].get.responses).sort()).toEqual(["200", "500"])
    expect(JSON.stringify(openapi.paths["/command"].get.responses["500"])).toContain("UnknownError")

    const types = readRepo("packages/sdk/js/src/gen/types.gen.ts")
    const fileReadErrorsBlock = generatedTypeBlock(types, "FileReadErrors")
    expect(fileReadErrorsBlock).toContain('name: "FileNotFoundError"')
    expect(fileReadErrorsBlock).toContain('name: "UnknownError"')
    const mcpConnectErrorsBlock = generatedTypeBlock(types, "McpConnectErrors")
    expect(mcpConnectErrorsBlock).toContain('name: "NotFoundError"')
    expect(mcpConnectErrorsBlock).toContain('name: "UnknownError"')
    const mcpAuthStartErrorsBlock = generatedTypeBlock(types, "McpAuthStartErrors")
    expect(mcpAuthStartErrorsBlock).toContain("BadRequestError")
    expect(mcpAuthStartErrorsBlock).toContain('name: "UnknownError"')
    const badRequestErrorBlock = generatedTypeBlock(types, "BadRequestError")
    expect(badRequestErrorBlock).toContain("error: Array")
    expect(badRequestErrorBlock).not.toContain("errors: Array")
    const mcpAuthCallbackErrorsBlock = generatedTypeBlock(types, "McpAuthCallbackErrors")
    expect(mcpAuthCallbackErrorsBlock).toContain("BadRequestError")
    expect(mcpAuthCallbackErrorsBlock).toContain("MCPOAuthStateError")
    expect(mcpAuthCallbackErrorsBlock).toContain('name: "UnknownError"')
    expect(mcpAuthCallbackErrorsBlock).not.toContain('name: "BadRequestError"')
    const mcpAuthCallbackDataBlock = generatedTypeBlock(types, "McpAuthCallbackData")
    expect(mcpAuthCallbackDataBlock).toContain("code: string")
    expect(mcpAuthCallbackDataBlock).toContain("state: string")
    const mcpAuthRemoveErrorsBlock = generatedTypeBlock(types, "McpAuthRemoveErrors")
    expect(mcpAuthRemoveErrorsBlock).toContain("500: UnknownError")
    const experimentalResourceListErrorsBlock = generatedTypeBlock(types, "ExperimentalResourceListErrors")
    expect(experimentalResourceListErrorsBlock).toContain('name: "UnknownError"')
    const commandListErrorsBlock = generatedTypeBlock(types, "CommandListErrors")
    expect(commandListErrorsBlock).toContain('name: "UnknownError"')
    const missionWakeErrorsBlock = generatedTypeBlock(types, "MissionWakeErrors")
    expect(missionWakeErrorsBlock).toContain("BadRequestError")
    for (const typeName of [
      "FileReadErrors",
      "SessionListGlobalErrors",
      "McpConnectErrors",
      "McpDisconnectErrors",
      "McpAuthStartErrors",
      "McpAuthRemoveErrors",
      "McpAuthCallbackErrors",
      "McpAuthAuthenticateErrors",
      "ExperimentalResourceListErrors",
      "CommandListErrors",
    ]) {
      expect(types).toContain(`export type ${typeName}`)
    }
  })

  test("task message response exposes persisted user message order keys", () => {
    const openapi = JSON.parse(readRepo("packages/sdk/openapi.json"))
    const taskMessageSchema =
      openapi.paths["/task/{taskID}/message"].post.responses["200"].content["application/json"].schema
    const userMessageSchema = taskMessageSchema.properties.user_message
    const serializedUserMessage = JSON.stringify([
      userMessageSchema,
      openapi.components.schemas.TaskMessageUserInfo,
      openapi.components.schemas.TaskMessageUserPart,
    ])

    expect(serializedUserMessage).toContain("orderKey")
    expect(serializedUserMessage).not.toContain('"info":{}')
    expect(serializedUserMessage).not.toContain('"items":{}')

    const types = readRepo("packages/sdk/js/src/gen/types.gen.ts")
    const responseBlock = generatedTypeBlock(types, "TaskMessageResponses")
    expect(responseBlock).not.toContain("info: unknown")
    expect(responseBlock).not.toContain("Array<unknown>")
    expect(types).toContain("export type TaskMessageUserInfo")
    expect(types).toContain("export type TaskMessageUserPart")
    expect(generatedTypeBlock(types, "TaskMessageUserInfo")).toContain("orderKey: string")
    expect(generatedTypeBlock(types, "TaskMessageUserPart")).toContain("orderKey: string")
  })

  test("SDK methods with required bodies require the top-level parameters object", () => {
    const sdk = readRepo("packages/sdk/js/src/gen/sdk.gen.ts")
    const requiredBodyMethods = [
      { methodName: "write", url: "/file/content", httpCall: "patch" },
      { methodName: "create", url: "/file/item", httpCall: "post" },
      { methodName: "copy", url: "/file/item/copy", httpCall: "post" },
      { methodName: "move", url: "/file/item", httpCall: "patch" },
      { methodName: "promptAsync", url: "/session/{sessionID}/prompt_async", httpCall: "post" },
      { methodName: "reorder", url: "/task-queue/reorder", httpCall: "patch" },
    ]

    for (const method of requiredBodyMethods) {
      const block = sdkMethodBlock(sdk, method)
      expect(block).toContain("parameters: {")
      expect(block).not.toContain("parameters?: {")
    }

    const promptAsync = sdkMethodBlock(sdk, {
      methodName: "promptAsync",
      url: "/session/{sessionID}/prompt_async",
      httpCall: "post",
    })
    expect(promptAsync).toContain("\n      parts:")
    expect(promptAsync).not.toContain("\n      parts?:")

    const reorder = sdkMethodBlock(sdk, {
      methodName: "reorder",
      url: "/task-queue/reorder",
      httpCall: "patch",
    })
    expect(reorder).toContain("\n      body_directory:")
    expect(reorder).not.toContain("\n      body_directory?:")
  })

  test("OpenAPI JavaScript samples use generated SDK method names", () => {
    const openapi = JSON.parse(readRepo("packages/sdk/openapi.json"))
    const sdk = readRepo("packages/sdk/js/src/gen/sdk.gen.ts")
    const classes = parseSdkSurface(sdk)
    const accessors = openApiSampleAccessors(openapi)
    const accessorByOperation = new Map(accessors.map((entry) => [entry.operationID, entry.accessor]))

    expect(accessorByOperation.get("session.prompt_async")).toBe("session.promptAsync")
    expect(accessorByOperation.get("project.current.delete")).toBe("project.current2.delete")
    expect(accessorByOperation.get("project.current.worktrees.delete")).toBe("project.current2.worktrees2.delete")
    expect(accessorByOperation.get("channel.runtime.restart")).toBe("channel.runtime2.restart")
    expect(accessorByOperation.get("provider.auth.prompts")).toBe("provider.auth2.prompts")
    expect(accessorByOperation.get("task.conversation.history")).toBe("task.conversation2.history")

    for (const { accessor } of accessors) assertSdkAccessorExists(classes, accessor)
  })
})
