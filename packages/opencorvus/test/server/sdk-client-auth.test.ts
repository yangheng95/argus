import { describe, expect, test } from "bun:test"
import { createOpenCorvusClient } from "@opencorvus-ai/sdk"

function captureFetch(seen: { request?: Request }) {
  return (async (request: RequestInfo | URL) => {
    seen.request = request instanceof Request ? request : new Request(request)
    return Response.json({ ok: true })
  }) as typeof fetch
}

describe("SDK client server auth", () => {
  test("password config sends Basic auth with the default server username", async () => {
    const seen: { request?: Request } = {}
    const client = createOpenCorvusClient({
      baseUrl: "http://127.0.0.1:7878",
      password: "secret",
      fetch: captureFetch(seen),
    })

    await client.global.health()

    expect(seen.request?.headers.get("Authorization")).toBe(`Basic ${btoa("opencorvus:secret")}`)
  })

  test("username config customizes the Basic auth username", async () => {
    const seen: { request?: Request } = {}
    const client = createOpenCorvusClient({
      baseUrl: "http://127.0.0.1:7878",
      username: "alice",
      password: "secret",
      fetch: captureFetch(seen),
    })

    await client.global.health()

    expect(seen.request?.headers.get("Authorization")).toBe(`Basic ${btoa("alice:secret")}`)
  })

  test("password config does not replace an explicit Authorization header", async () => {
    const seen: { request?: Request } = {}
    const client = createOpenCorvusClient({
      baseUrl: "http://127.0.0.1:7878",
      password: "secret",
      headers: { Authorization: "Bearer custom" },
      fetch: captureFetch(seen),
    })

    await client.global.health()

    expect(seen.request?.headers.get("Authorization")).toBe("Bearer custom")
  })

  test("directory config injects project scope as a query parameter", async () => {
    const seen: { request?: Request } = {}
    const directory = "C:/work/literal%2Fname"
    const client = createOpenCorvusClient({
      baseUrl: "http://127.0.0.1:7878",
      directory,
      fetch: captureFetch(seen),
    })

    await client.project.current()

    const url = new URL(seen.request!.url)
    expect(url.pathname).toBe("/project/current")
    expect(url.searchParams.get("directory")).toBe(directory)
    expect(seen.request?.headers.get("x-opencorvus-directory")).toBeNull()
    expect(seen.request!.url).toContain("literal%252Fname")
  })

  test("directory config skips global routes", async () => {
    const seen: { request?: Request } = {}
    const client = createOpenCorvusClient({
      baseUrl: "http://127.0.0.1:7878",
      directory: "C:/work/literal%2Fname",
      fetch: captureFetch(seen),
    })

    await client.global.health()

    const url = new URL(seen.request!.url)
    expect(url.pathname).toBe("/global/health")
    expect(url.searchParams.has("directory")).toBe(false)
    expect(seen.request?.headers.get("x-opencorvus-directory")).toBeNull()
  })

  test("directory config supports non-ASCII paths without header encoding", async () => {
    const seen: { request?: Request } = {}
    const directory = "C:/项目/literal%2Fname"
    const client = createOpenCorvusClient({
      baseUrl: "http://127.0.0.1:7878",
      directory,
      fetch: captureFetch(seen),
    })

    await client.project.current()

    const url = new URL(seen.request!.url)
    expect(url.searchParams.get("directory")).toBe(directory)
    expect(seen.request?.headers.get("x-opencorvus-directory")).toBeNull()
  })
})
