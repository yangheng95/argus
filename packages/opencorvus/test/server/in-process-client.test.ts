import { afterEach, describe, expect, test } from "bun:test"
import {
  IN_PROCESS_BASE_URL,
  createInProcessRequest,
  serverAuthorizationHeader,
} from "../../src/server/in-process-client"

const KEYS = ["OPENCORVUS_SERVER_USERNAME", "OPENCORVUS_SERVER_PASSWORD"] as const

afterEach(() => {
  for (const key of KEYS) delete process.env[key]
})

describe("in-process client", () => {
  test("builds a default authorization header from server env", () => {
    process.env.OPENCORVUS_SERVER_PASSWORD = "secret"

    expect(serverAuthorizationHeader()).toBe(`Basic ${btoa("opencorvus:secret")}`)
  })

  test("injects authorization when none is provided", () => {
    process.env.OPENCORVUS_SERVER_USERNAME = "alice"
    process.env.OPENCORVUS_SERVER_PASSWORD = "secret"

    const request = createInProcessRequest(`${IN_PROCESS_BASE_URL}/session/list`)

    expect(request.headers.get("Authorization")).toBe(`Basic ${btoa("alice:secret")}`)
  })

  test("preserves an explicit authorization header", () => {
    process.env.OPENCORVUS_SERVER_PASSWORD = "secret"

    const request = createInProcessRequest(`${IN_PROCESS_BASE_URL}/session/list`, {
      headers: {
        Authorization: "Bearer custom",
      },
    })

    expect(request.headers.get("Authorization")).toBe("Bearer custom")
  })
})
