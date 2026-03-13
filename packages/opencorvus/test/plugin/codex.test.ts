import { describe, expect, test } from "bun:test"
import {
  parseJwtClaims,
  extractAccountIdFromClaims,
  extractAccountId,
  parseCodexSSE,
  prepareCodexBody,
  type IdTokenClaims,
} from "../../src/plugin/codex"

function createTestJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

describe("plugin.codex", () => {
  describe("parseJwtClaims", () => {
    test("parses valid JWT with claims", () => {
      const payload = { email: "test@example.com", chatgpt_account_id: "acc-123" }
      const jwt = createTestJwt(payload)
      const claims = parseJwtClaims(jwt)
      expect(claims).toEqual(payload)
    })

    test("returns undefined for JWT with less than 3 parts", () => {
      expect(parseJwtClaims("invalid")).toBeUndefined()
      expect(parseJwtClaims("only.two")).toBeUndefined()
    })

    test("returns undefined for invalid base64", () => {
      expect(parseJwtClaims("a.!!!invalid!!!.b")).toBeUndefined()
    })

    test("returns undefined for invalid JSON payload", () => {
      const header = Buffer.from("{}").toString("base64url")
      const invalidJson = Buffer.from("not json").toString("base64url")
      expect(parseJwtClaims(`${header}.${invalidJson}.sig`)).toBeUndefined()
    })
  })

  describe("extractAccountIdFromClaims", () => {
    test("extracts chatgpt_account_id from root", () => {
      const claims: IdTokenClaims = { chatgpt_account_id: "acc-root" }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts chatgpt_account_id from nested https://api.openai.com/auth", () => {
      const claims: IdTokenClaims = {
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-nested")
    })

    test("prefers root over nested", () => {
      const claims: IdTokenClaims = {
        chatgpt_account_id: "acc-root",
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts from organizations array as fallback", () => {
      const claims: IdTokenClaims = {
        organizations: [{ id: "org-123" }, { id: "org-456" }],
      }
      expect(extractAccountIdFromClaims(claims)).toBe("org-123")
    })

    test("returns undefined when no accountId found", () => {
      const claims: IdTokenClaims = { email: "test@example.com" }
      expect(extractAccountIdFromClaims(claims)).toBeUndefined()
    })
  })

  describe("extractAccountId", () => {
    test("extracts from id_token first", () => {
      const idToken = createTestJwt({ chatgpt_account_id: "from-id-token" })
      const accessToken = createTestJwt({ chatgpt_account_id: "from-access-token" })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-id-token")
    })

    test("falls back to access_token when id_token has no accountId", () => {
      const idToken = createTestJwt({ email: "test@example.com" })
      const accessToken = createTestJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "from-access" },
      })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-access")
    })

    test("returns undefined when no tokens have accountId", () => {
      const token = createTestJwt({ email: "test@example.com" })
      expect(
        extractAccountId({
          id_token: token,
          access_token: token,
          refresh_token: "rt",
        }),
      ).toBeUndefined()
    })

    test("handles missing id_token", () => {
      const accessToken = createTestJwt({ chatgpt_account_id: "acc-123" })
      expect(
        extractAccountId({
          id_token: "",
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("acc-123")
    })
  })

  describe("prepareCodexBody", () => {
    test("lifts system input into top-level instructions for responses payloads", () => {
      const body = prepareCodexBody({
        model: "gpt-5.3-codex",
        max_output_tokens: 1234,
        input: [
          { role: "system", content: "You are a senior engineer." },
          { role: "user", content: [{ type: "input_text", text: "fix the bug" }] },
        ],
      }) as Record<string, unknown>

      expect(body.instructions).toBe("You are a senior engineer.")
      expect(body.store).toBe(false)
      expect(body.stream).toBe(true)
      expect(body.max_output_tokens).toBeUndefined()
      expect(body.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "fix the bug" }] }])
    })

    test("preserves existing instructions", () => {
      const body = prepareCodexBody({
        instructions: "Keep me",
        input: [{ role: "assistant", content: [{ type: "output_text", text: "done" }] }],
      }) as Record<string, unknown>

      expect(body.instructions).toBe("Keep me")
      expect(body.store).toBe(false)
      expect(body.stream).toBe(true)
      expect(body.input).toEqual([{ role: "assistant", content: [{ type: "output_text", text: "done" }] }])
    })

    test("keeps only trailing delta items on follow-up turns", () => {
      const body = prepareCodexBody(
        {
          input: [
            { role: "user", content: [{ type: "input_text", text: "first" }] },
            { role: "assistant", content: [{ type: "output_text", text: "thinking" }] },
            { type: "function_call", id: "fc_real", call_id: "call_1", name: "read_file", arguments: "{}" },
            { type: "function_call_output", call_id: "call_1", output: "ok" },
          ],
        },
        "resp_prev",
      ) as Record<string, unknown>

      expect(body.previous_response_id).toBeUndefined()
      expect(body.input).toEqual([
        { type: "function_call", id: "fc_real", call_id: "call_1", name: "read_file", arguments: "{}" },
        { type: "function_call_output", call_id: "call_1", output: "ok" },
      ])
    })
  })

  describe("parseCodexSSE", () => {
    test("extracts the final response payload from sse text", () => {
      const body = parseCodexSSE([
        "event: response.created",
        'data: {"type":"response.created","response":{"id":"resp_1","status":"in_progress"}}',
        "",
        "event: response.completed",
        'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","output":[]}}',
        "",
      ].join("\n")) as Record<string, unknown>

      expect(body.id).toBe("resp_1")
      expect(body.status).toBe("completed")
    })
  })
})
