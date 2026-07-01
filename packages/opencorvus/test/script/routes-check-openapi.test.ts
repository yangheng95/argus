import { describe, expect, test } from "bun:test"
import path from "node:path"
import fs from "node:fs"
import { collectInventoryViolations, compareOpenApiSpecs } from "../../script/check/routes"
import { generateOpenApiSpec } from "../../src/cli/cmd/generate"

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..", "..")

function readRepoFile(...parts: string[]) {
  return fs.readFileSync(path.join(repoRoot, ...parts), "utf8")
}

describe("api routes check OpenAPI drift", () => {
  function fixtureSpec() {
    return {
      openapi: "3.1.1",
      paths: {
        "/executor/{executorID}/model": {
          patch: {
            summary: "Set executor model",
            operationId: "executor.setModel",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      model: { type: "string" },
                    },
                    required: ["model"],
                  },
                },
              },
            },
            "x-codeSamples": [
              {
                lang: "js",
                source: "await client.executor.setModel({ ... })",
              },
            ],
          },
        },
      },
    }
  }

  test("detects schema drift on an existing method and path in the inventory checker", () => {
    const tracked = fixtureSpec()
    const generated = structuredClone(tracked) as any
    generated.paths["/executor/{executorID}/model"].patch.requestBody.content[
      "application/json"
    ].schema.properties.model.type = "number"

    const violations = collectInventoryViolations({
      runtime: new Set(["PATCH /executor/{executorID}/model"]),
      generated,
      tracked,
      sdk: new Set(["PATCH /executor/{executorID}/model"]),
    })

    expect(violations).toHaveLength(1)
    expect(violations[0].rule).toBe("generated-openapi-differs-tracked-openapi")
    expect(violations[0].entries[0]).toContain('"type": "string"')
    expect(violations[0].entries[0]).toContain('"type": "number"')
  })

  test("detects metadata drift and stable key order does not fail", () => {
    const tracked = fixtureSpec()
    const generated = structuredClone(tracked) as any
    generated.paths["/executor/{executorID}/model"].patch.summary = "Retitled model setter"
    delete generated.paths["/executor/{executorID}/model"].patch["x-codeSamples"]

    const metadataViolations = compareOpenApiSpecs(generated, tracked)

    expect(metadataViolations).toHaveLength(1)
    expect(metadataViolations[0].entries[0]).toContain("Set executor model")
    expect(metadataViolations[0].entries[0]).toContain("Retitled model setter")
    expect(metadataViolations[0].entries[0]).toContain("x-codeSamples")

    const reorderedTracked = {
      paths: tracked.paths,
      openapi: tracked.openapi,
    }
    const reorderedGenerated = {
      openapi: tracked.openapi,
      paths: tracked.paths,
    }

    expect(compareOpenApiSpecs(reorderedGenerated, reorderedTracked)).toEqual([])
  })

  test("helper reports schema drift on an existing method and path", () => {
    const tracked = fixtureSpec()
    const generated = structuredClone(tracked) as any
    generated.paths["/executor/{executorID}/model"].patch.requestBody.content[
      "application/json"
    ].schema.properties.model.type = "number"

    const violations = compareOpenApiSpecs(generated, tracked)

    expect(violations).toHaveLength(1)
    expect(violations[0].rule).toBe("generated-openapi-differs-tracked-openapi")
    expect(violations[0].entries[0]).toContain('"type": "string"')
    expect(violations[0].entries[0]).toContain('"type": "number"')
  })

  test("route and docs checks use the generated OpenAPI spec source", () => {
    const routeCheck = readRepoFile("packages", "opencorvus", "script", "check", "routes.ts")
    const docsRenderer = readRepoFile("packages", "opencorvus", "script", "docs", "render-api-md.ts")
    const generateScript = readRepoFile("script", "generate.ts")
    const generateWorkflow = readRepoFile(".github", "workflows", "generate.yml")

    expect(routeCheck).toContain('import { generateOpenApiSpec } from "../../src/cli/cmd/generate"')
    expect(routeCheck).toContain("const generated = await generateOpenApiSpec()")
    expect(routeCheck).toContain(
      "return collectInventoryViolations({ runtime, generated, tracked, sdk: generatedSdk })",
    )
    expect(routeCheck).toContain("...compareOpenApiSpecs(input.generated, input.tracked)")
    expect(routeCheck).not.toContain("const generated = await Server.openapi()")

    expect(docsRenderer).toContain('import { generateOpenApiSpec } from "../../src/cli/cmd/generate"')
    expect(docsRenderer).toContain("const spec = await generateOpenApiSpec()")
    expect(docsRenderer).toContain("API docs i18n missing route group")
    expect(docsRenderer).toContain("merges into missing group")
    expect(docsRenderer).toContain("is missing operationId")
    expect(docsRenderer).not.toContain("const spec = loadJson<any>(OPENAPI_PATH)")
    expect(docsRenderer).not.toContain("const spec = await Server.openapi()")
    expect(docsRenderer).not.toContain("order: 9999")
    expect(docsRenderer).not.toContain("capitalize(seg)")
    expect(docsRenderer).not.toContain("if (!op.operationId) continue")

    expect(generateWorkflow).toContain("run: ./script/generate.ts")
    expect(generateWorkflow).toContain("bun ./script/generated-artifacts.ts --print")
    expect(generateWorkflow).toContain("bun ./script/generated-artifacts.ts --check-worktree")
    expect(generateScript).toContain('import { GENERATED_ARTIFACT_PATHS } from "./generated-artifacts"')
    expect(generateScript).toContain("bun ./packages/sdk/js/script/build.ts")
    expect(generateScript).toContain("bun ./packages/opencorvus/script/docs/render-api-md.ts")
    expect(generateScript).toContain("API_MDX_ARTIFACT_PATHS")
    expect(generateScript).toContain("prettierArtifactPaths")
    expect(generateScript).toContain(
      'Bun.spawn(["bun", "run", "prettier", "--ignore-unknown", "--write", ...prettierArtifactPaths]',
    )
    expect(generateScript.indexOf("bun ./packages/opencorvus/script/docs/render-api-md.ts")).toBeLessThan(
      generateScript.indexOf('Bun.spawn(["bun", "run", "prettier", "--ignore-unknown", "--write"'),
    )
    expect(generateScript).not.toContain("bun ./script/format.ts")
    expect(generateScript).not.toContain("--write .")
    expect(generateScript).not.toContain("generate-openapi.ts >")
  })

  test("DB reset request requires the current database path in generated OpenAPI", async () => {
    const spec = await generateOpenApiSpec()
    const requestBody = spec.paths["/global/db/reset"].post.requestBody
    const schema = requestBody.content["application/json"].schema

    expect(requestBody.required).toBe(true)
    expect(schema).toMatchObject({
      type: "object",
      required: ["database"],
      properties: { database: { type: "string", minLength: 1 } },
      additionalProperties: false,
    })
  })
})
