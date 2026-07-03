import { afterEach, describe, expect, mock, test } from "bun:test"
import { Server } from "../../src/server/server"
import { clearServerShutdownHandler, registerServerShutdownHandler } from "../../src/server/shutdown"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"

Log.init({ print: false })

describe("app routes", () => {
  afterEach(async () => {
    mock.restore()
    clearServerShutdownHandler()
    await resetDatabase()
  })

  test("GET /ui/ serves the overlay shell", async () => {
    const app = Server.App()
    const response = await app.request("/ui/")

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(await response.text()).toContain('data-page="overlay"')
  })

  test("Server.openapi includes project routes mounted through routeInventoryApp", async () => {
    const spec = await Server.openapi()
    const paths = spec.paths ?? {}

    expect(paths["/global/health"]?.get).toBeDefined()
    expect(paths["/project/current"]?.get).toBeDefined()
    expect(paths["/project/current"]?.patch).toBeDefined()
    expect(paths["/project/current"]?.delete).toBeDefined()
    expect(paths["/goal-run/{goalRunID}/acceptance"]?.get).toBeDefined()
    expect(paths["/goal-run/{goalRunID}/diff"]?.get).toBeDefined()
    expect(paths["/run/{runID}/diff"]?.get).toBeDefined()
    expect(paths["/task/{taskID}/project-archive"]?.get?.responses?.[200]?.content?.["application/zip"]).toBeDefined()
    expect(
      paths["/mission/{missionID}/project-archive"]?.get?.responses?.[200]?.content?.["application/zip"],
    ).toBeDefined()
  })

  test("Server.openapi includes goal report in the advertised SSE event payload schema", async () => {
    const spec = await Server.openapi()
    const schemas = spec.components?.schemas ?? {}

    expect(schemas["Event.goal.report"]).toBeDefined()
    expect(JSON.stringify(schemas.Event)).toContain("Event.goal.report")
  })

  test("Server.openapi documents task operator model context conflict errors", async () => {
    const spec = await Server.openapi()
    const response = spec.paths?.["/task/{taskID}/operator-model-context"]?.get?.responses?.[409]
    const schema = response?.content?.["application/json"]?.schema
    const schemas = schema?.anyOf ?? (schema ? [schema] : [])
    const names = schemas.map(
      (schema: { properties?: { name?: { const?: string } } }) => schema.properties?.name?.const,
    )

    expect(response?.description).toBe("Conflict")
    expect(names).toContain("ReplyTargetEnvelopeMissingError")
    expect(names).not.toContain("TaskCancelledMessageError")
  })

  test("Server.openapi documents experimental task memory not-found responses", async () => {
    const spec = await Server.openapi()
    const paths = spec.paths ?? {}
    const operations = [paths["/experimental/task-plan"]?.get, paths["/experimental/scratchpad"]?.get]

    for (const operation of operations) {
      const schema = operation?.responses?.[404]?.content?.["application/json"]?.schema
      expect(JSON.stringify(schema)).toContain("NotFoundError")
    }
  })

  test("Server.openapi documents direct reply attachment reference errors", async () => {
    const spec = await Server.openapi()
    const response = spec.paths?.["/task/{taskID}/session/{sessionID}/reply"]?.post?.responses?.[400]
    const schema = response?.content?.["application/json"]?.schema
    const schemas = schema?.anyOf ?? (schema ? [schema] : [])
    const names = schemas.map(
      (schema: { properties?: { name?: { const?: string } } }) => schema.properties?.name?.const,
    )

    expect(response?.description).toBe("Reply rejected before persistence")
    expect(names).toContain("AgentSessionAttachmentReferenceError")
  })

  test("Server.openapi documents shutdown restart and dispose failure responses", async () => {
    const spec = await Server.openapi()
    const paths = spec.paths ?? {}

    expect(paths["/shutdown"]?.post?.responses?.[503]?.content?.["application/json"]?.schema?.properties).toHaveProperty(
      "ok",
    )
    expect(paths["/restart"]?.post?.responses?.[503]?.content?.["application/json"]?.schema?.properties).toHaveProperty(
      "ok",
    )
    expect(
      paths["/instance/dispose"]?.post?.responses?.[409]?.content?.["application/json"]?.schema?.properties?.name
        ?.const,
    ).toBe("ActiveExecutorSessionsError")
    expect(
      paths["/global/dispose"]?.post?.responses?.[409]?.content?.["application/json"]?.schema?.properties?.name
        ?.const,
    ).toBe("ActiveExecutorSessionsError")
  })

  test("Server.openapi documents browser-preview and panel memory not-found responses", async () => {
    const spec = await Server.openapi()
    const paths = spec.paths ?? {}
    const operations = [
      paths["/task/{taskID}/browser-preview"]?.get,
      paths["/task/{taskID}/browser-preview/evidence/{evidenceID}"]?.get,
      paths["/task/{taskID}/browser-preview/evidence/{evidenceID}/capture.png"]?.get,
      paths["/task/{taskID}/browser-preview/evidence/{evidenceID}/artifact/{artifactName}"]?.get,
      paths["/task/{taskID}/browser-preview/target"]?.put,
      paths["/task/{taskID}/browser-preview/capture"]?.post,
      paths["/task/{taskID}/browser-preview/compare"]?.post,
      paths["/experimental/task-plan"]?.get,
      paths["/experimental/scratchpad"]?.get,
      paths["/panel/knowledge/memory/{id}"]?.get,
      paths["/panel/knowledge/memory/{id}"]?.delete,
    ]
    expect(paths["/task/{taskID}/browser-preview/live/snapshot"]).toBeUndefined()
    expect(paths["/task/{taskID}/browser-preview/live/input"]).toBeUndefined()

    for (const operation of operations) {
      expect(operation?.responses?.[404]?.content?.["application/json"]?.schema).toBeDefined()
    }
    const artifact500 =
      paths["/task/{taskID}/browser-preview/evidence/{evidenceID}/artifact/{artifactName}"]?.get?.responses?.[500]
        ?.content?.["application/json"]?.schema
    expect(JSON.stringify(artifact500)).toContain("BrowserPreviewEvidenceCorruptionError")
  })

  test("Server.openapi documents Mission detail not-found responses", async () => {
    const spec = await Server.openapi()
    const paths = spec.paths ?? {}
    const operations = [
      paths["/mission/{missionID}/status"]?.get,
      paths["/mission/{missionID}/project-archive"]?.get,
      paths["/mission/{missionID}/title"]?.patch,
      paths["/mission/{missionID}/abort"]?.post,
      paths["/mission/{missionID}"]?.delete,
    ]

    for (const operation of operations) {
      const schema = operation?.responses?.[404]?.content?.["application/json"]?.schema
      expect(JSON.stringify(schema)).toContain("NotFoundError")
    }
  })

  test("Server.openapi documents directory query for project-scoped routes only once", async () => {
    const spec = await Server.openapi()
    const paths = spec.paths ?? {}
    const queryParameterNames = (operation: { parameters?: Array<{ name?: string; in?: string }> } | undefined) =>
      (operation?.parameters ?? []).filter((parameter) => parameter.in === "query").map((parameter) => parameter.name)
    const directoryParameterNames = (operation: { parameters?: Array<{ name?: string; in?: string }> } | undefined) =>
      queryParameterNames(operation).filter((name) => name === "directory")

    expect(directoryParameterNames(paths["/project/current"]?.get)).toEqual(["directory"])
    expect(directoryParameterNames(paths["/project/current"]?.patch)).toEqual(["directory"])
    expect(directoryParameterNames(paths["/project/current"]?.delete)).toEqual(["directory"])
    expect(directoryParameterNames(paths["/task/{taskID}/browser-preview"]?.get)).toEqual(["directory"])
    expect(directoryParameterNames(paths["/task/{taskID}/browser-preview/evidence/{evidenceID}"]?.get)).toEqual([
      "directory",
    ])
    expect(directoryParameterNames(paths["/expert-squad/import-folder"]?.post)).toEqual(["directory"])
    expect(directoryParameterNames(paths["/expert-squad/import-file"]?.post)).toEqual(["directory"])
    expect(directoryParameterNames(paths["/expert-squad/export"]?.post)).toEqual(["directory"])
    expect(directoryParameterNames(paths["/session"]?.get)).toEqual(["directory"])
    expect(directoryParameterNames(paths["/global/health"]?.get)).toEqual([])
    expect(directoryParameterNames(paths["/log"]?.get)).toEqual([])
    expect(directoryParameterNames(paths["/log/files"]?.get)).toEqual([])
    expect(directoryParameterNames(paths["/log/tail"]?.get)).toEqual([])
    expect(queryParameterNames(paths["/task"]?.post)).toEqual(["directory", "init-git"])
    expect(queryParameterNames(paths["/tasks"]?.get)).toContain("directory")
    expect(queryParameterNames(paths["/tasks"]?.get)).not.toContain("init-git")
  })

  test("Server.openapi marks selected preview target request body required", async () => {
    const spec = await Server.openapi()
    const requestBody = spec.paths?.["/task/{taskID}/browser-preview/target"]?.put?.requestBody
    const schema = requestBody?.content?.["application/json"]?.schema

    expect(requestBody?.required).toBe(true)
    expect(schema?.properties?.targetID?.type).toBe("string")
    expect(schema?.required).toContain("targetID")
    expect(schema?.properties).not.toHaveProperty("url")
  })

  test("Server.openapi repeatedly documents provider list with published model statuses only", async () => {
    await Server.openapi()
    const spec = await Server.openapi()
    const responseSchema = spec.paths?.["/provider"]?.get?.responses?.[200]?.content?.["application/json"]?.schema
    const expanded = JSON.stringify(expandSchemaRefs(spec, responseSchema))

    expect(expanded).toContain('"active"')
    expect(expanded).not.toContain('"deprecated"')
  })

  test("POST /shutdown returns 503 without a registered handler", async () => {
    const app = Server.App()
    const response = await app.request("/shutdown", { method: "POST" })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false })
  })

  test("POST /shutdown dispatches the registered shutdown handler", async () => {
    const app = Server.App()
    const calls: string[] = []
    const invoked = Promise.withResolvers<void>()

    registerServerShutdownHandler((reason) => {
      calls.push(reason)
      invoked.resolve()
    })

    const response = await app.request("/shutdown", { method: "POST" })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })

    await invoked.promise
    expect(calls).toEqual(["http.shutdown"])
  })
})

function expandSchemaRefs(spec: any, value: unknown, seen = new Set<string>()): unknown {
  if (!value || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((item) => expandSchemaRefs(spec, item, seen))
  const object = value as Record<string, unknown>
  const ref = object.$ref
  if (typeof ref === "string" && ref.startsWith("#/components/schemas/")) {
    if (seen.has(ref)) return { $ref: ref }
    seen.add(ref)
    const name = ref.slice("#/components/schemas/".length)
    return expandSchemaRefs(spec, spec.components?.schemas?.[name], seen)
  }
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, expandSchemaRefs(spec, item, seen)]))
}
