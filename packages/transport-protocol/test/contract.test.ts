import { describe, expect, test } from "bun:test"
import {
  EXTENSION_MESSAGE_TYPES,
  PROTOCOL_VERSION,
  WEBVIEW_MESSAGE_TYPES,
  base64ToUint8,
  isExtensionMessage,
  isWebviewMessage,
  routeRequiresProjectDirectory,
  uint8ToBase64,
  type NativeCommand,
  type ExtensionMessage,
  type WebviewMessage,
} from "../src/index"

/**
 * Contract tests for the postMessage envelope schema. These guard the
 * audit findings from 2026-04-29:
 *
 *  - transport F1: isExtensionMessage previously accepted any string
 *    `type` so long as `protocol` matched (e.g. `{type:"__proto__"}`).
 *  - transport F2: protocol-mismatch sentinel previously accepted with
 *    no `expected` / `received` validation, allowing reload storms.
 *  - transport F4: base64 codec edge cases (empty, large, malformed).
 *  - transport F8: schema regression — fields silently disappearing
 *    between versions.
 */

describe("isExtensionMessage", () => {
  test("accepts each whitelisted type with PROTOCOL_VERSION", () => {
    for (const type of EXTENSION_MESSAGE_TYPES) {
      const sample: any = { protocol: PROTOCOL_VERSION, type }
      // Fill required fields so the discriminated union typecheck holds
      // at runtime — the predicate doesn't introspect them.
      expect(isExtensionMessage(sample)).toBe(true)
    }
  })

  test("rejects unknown type even with valid protocol (audit F1)", () => {
    expect(isExtensionMessage({ protocol: PROTOCOL_VERSION, type: "__proto__" })).toBe(false)
    expect(isExtensionMessage({ protocol: PROTOCOL_VERSION, type: "toString" })).toBe(false)
    expect(isExtensionMessage({ protocol: PROTOCOL_VERSION, type: "" })).toBe(false)
    expect(isExtensionMessage({ protocol: PROTOCOL_VERSION, type: 42 })).toBe(false)
  })

  test("protocol-mismatch sentinel requires numeric expected/received (audit F2)", () => {
    expect(isExtensionMessage({ type: "protocol-mismatch", expected: 1, received: 99 })).toBe(true)
    expect(isExtensionMessage({ type: "protocol-mismatch" })).toBe(false)
    expect(isExtensionMessage({ type: "protocol-mismatch", expected: "1", received: "99" })).toBe(false)
    expect(isExtensionMessage({ type: "protocol-mismatch", expected: 1 })).toBe(false)
  })

  test("rejects mismatched protocol version (non-mismatch types)", () => {
    expect(isExtensionMessage({ protocol: 99, type: "response" })).toBe(false)
    expect(isExtensionMessage({ protocol: undefined, type: "response" })).toBe(false)
  })

  test("rejects non-objects", () => {
    expect(isExtensionMessage(null)).toBe(false)
    expect(isExtensionMessage(undefined)).toBe(false)
    expect(isExtensionMessage("string")).toBe(false)
    expect(isExtensionMessage(42)).toBe(false)
  })
})

describe("isWebviewMessage", () => {
  test("accepts each whitelisted type with the minimal valid shape", () => {
    // audit-2026-04-29 W2-V9 — `request` and `stream.open` carry an
    // HTTP method field that must be in the canonical RequestMethod
    // enum. Other types (`stream.close`, `request.abort`) only carry
    // an id, so the bare envelope still passes.
    for (const type of WEBVIEW_MESSAGE_TYPES) {
      const needsMethod = type === "request" || type === "stream.open"
      const env: any = { protocol: PROTOCOL_VERSION, type }
      if (needsMethod) env.method = "GET"
      if (type === "native.request") {
        env.id = "native-1"
        env.command = { kind: "open-url", url: "https://example.com" } satisfies NativeCommand
      }
      expect(isWebviewMessage(env)).toBe(true)
    }
  })

  test("rejects unknown type", () => {
    expect(isWebviewMessage({ protocol: PROTOCOL_VERSION, type: "stream.event" })).toBe(false)
    // ↑ that's an extension-direction type; webview must NOT send it.
    expect(isWebviewMessage({ protocol: PROTOCOL_VERSION, type: "__proto__" })).toBe(false)
  })

  test("rejects mismatched protocol version", () => {
    expect(isWebviewMessage({ protocol: 99, type: "request" })).toBe(false)
  })

  // audit-2026-04-29 W2-V9 — method enum is the schema's only
  // line of defence before fetch(). Pre-fix any string passed
  // through; lowercase, free-form, and missing methods all
  // satisfied isWebviewMessage and reached bridge.ts:fetch().
  test("rejects request/stream.open with a method outside the RequestMethod enum (lowercase, free-form, missing)", () => {
    const malformed = [
      { protocol: PROTOCOL_VERSION, type: "request", method: "get" }, // lowercase
      { protocol: PROTOCOL_VERSION, type: "request", method: "post" }, // lowercase
      { protocol: PROTOCOL_VERSION, type: "request", method: "GETT" }, // typo
      { protocol: PROTOCOL_VERSION, type: "request", method: "" }, // empty
      { protocol: PROTOCOL_VERSION, type: "request", method: "DELETE; DROP" }, // injection
      { protocol: PROTOCOL_VERSION, type: "request" }, // missing
      { protocol: PROTOCOL_VERSION, type: "stream.open", method: "post" },
      { protocol: PROTOCOL_VERSION, type: "stream.open", method: 42 as any }, // non-string
    ]
    for (const env of malformed) {
      expect(isWebviewMessage(env)).toBe(false)
    }
  })

  test("accepts every uppercase canonical method", () => {
    for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      expect(isWebviewMessage({ protocol: PROTOCOL_VERSION, type: "request", method: m })).toBe(true)
    }
  })

  test("stream.close and request.abort don't require method (no HTTP verb on those)", () => {
    expect(isWebviewMessage({ protocol: PROTOCOL_VERSION, type: "stream.close" })).toBe(true)
    expect(isWebviewMessage({ protocol: PROTOCOL_VERSION, type: "request.abort" })).toBe(true)
  })

  test("native.request requires a valid native command payload", () => {
    expect(
      isWebviewMessage({
        protocol: PROTOCOL_VERSION,
        type: "native.request",
        id: "n1",
        command: { kind: "workspace.pickDir", start: "D:/workspace" },
      }),
    ).toBe(true)
    expect(
      isWebviewMessage({
        protocol: PROTOCOL_VERSION,
        type: "native.request",
        id: "n2",
        command: { kind: "workspace.openProjectEditor", editor: "notepad", path: "D:/workspace" },
      }),
    ).toBe(false)
    expect(
      isWebviewMessage({
        protocol: PROTOCOL_VERSION,
        type: "native.request",
        id: "n3",
        command: { kind: "notification.send", body: "missing title" },
      }),
    ).toBe(false)
  })
})

describe("base64 codec (audit F4)", () => {
  test("round-trips empty Uint8Array", () => {
    const out = base64ToUint8(uint8ToBase64(new Uint8Array(0)))
    expect(out.length).toBe(0)
  })

  test("round-trips a 1 KiB sample byte-for-byte", () => {
    const input = new Uint8Array(1024)
    for (let i = 0; i < input.length; i++) input[i] = (i * 37 + 7) & 0xff
    const decoded = base64ToUint8(uint8ToBase64(input))
    expect(decoded.length).toBe(input.length)
    for (let i = 0; i < input.length; i++) expect(decoded[i]).toBe(input[i]!)
  })

  test("handles 1 MiB without 'too many arguments' / stack overflow", () => {
    const input = new Uint8Array(1024 * 1024)
    for (let i = 0; i < input.length; i++) input[i] = i & 0xff
    const encoded = uint8ToBase64(input)
    const decoded = base64ToUint8(encoded)
    expect(decoded.length).toBe(input.length)
    // Spot-check a handful of bytes (full equality on 1MB is slow).
    expect(decoded[0]).toBe(0)
    expect(decoded[255]).toBe(255)
    expect(decoded[input.length - 1]).toBe((input.length - 1) & 0xff)
  })

  test("malformed base64 throws a typed Error, not engine-specific InvalidCharacterError", () => {
    expect(() => base64ToUint8("definitely!!!not-base64@@@")).toThrow(/invalid base64/i)
  })

  test("URL-safe base64 alphabet (-_) is rejected", () => {
    // The schema does NOT use URL-safe encoding; standard `+/` is the
    // canonical form. URL-safe should fail rather than silently decode
    // to garbage.
    expect(() => base64ToUint8("--__")).toThrow()
  })
})

describe("schema snapshot (audit F8)", () => {
  test("PROTOCOL_VERSION is 2", () => {
    expect(PROTOCOL_VERSION).toBe(2)
  })

  test("EXTENSION_MESSAGE_TYPES is the canonical, ordered set", () => {
    // Locking the array prevents accidental member removal that would
    // silently break runtime validation. To add a new variant, append
    // here AND extend the discriminated union.
    expect(EXTENSION_MESSAGE_TYPES).toEqual([
      "response",
      "stream.event",
      "stream.error",
      "stream.close",
      "native.response",
      "ui-command",
      "host:theme",
    ])
  })

  test("WEBVIEW_MESSAGE_TYPES is the canonical, ordered set", () => {
    expect(WEBVIEW_MESSAGE_TYPES).toEqual(["request", "stream.open", "stream.close", "request.abort", "native.request"])
  })

  test("ExtensionMessage union shape is JSON-clonable (no methods, no symbols)", () => {
    const samples: ExtensionMessage[] = [
      {
        protocol: PROTOCOL_VERSION,
        type: "response",
        id: "x",
        ok: true,
        status: 200,
        headers: {},
        body: { kind: "empty" },
      },
      { protocol: PROTOCOL_VERSION, type: "stream.event", id: "x", events: ["a", "b"] },
      { protocol: PROTOCOL_VERSION, type: "stream.error", id: "x", message: "boom" },
      { protocol: PROTOCOL_VERSION, type: "stream.close", id: "x", reason: "done" },
      { protocol: PROTOCOL_VERSION, type: "native.response", id: "x", ok: true, value: "D:/workspace" },
      { protocol: PROTOCOL_VERSION, type: "ui-command", kind: "composer.attach", payload: { foo: 1 } },
      { protocol: PROTOCOL_VERSION, type: "host:theme", theme: "vscode-dark" },
      { type: "protocol-mismatch", expected: 2, received: 1 },
    ]
    for (const s of samples) {
      const clone = JSON.parse(JSON.stringify(s))
      expect(clone).toEqual(s)
    }
  })

  test("WebviewMessage union shape is JSON-clonable", () => {
    const samples: WebviewMessage[] = [
      {
        protocol: PROTOCOL_VERSION,
        type: "request",
        id: "x",
        method: "GET",
        path: "global/health",
        query: {},
        headers: {},
        body: { kind: "none" },
        responseKind: "json",
      },
      {
        protocol: PROTOCOL_VERSION,
        type: "stream.open",
        id: "x",
        method: "GET",
        path: "task/abc/events",
        query: {},
        headers: {},
        body: { kind: "none" },
      },
      { protocol: PROTOCOL_VERSION, type: "stream.close", id: "x" },
      { protocol: PROTOCOL_VERSION, type: "request.abort", id: "x" },
      {
        protocol: PROTOCOL_VERSION,
        type: "native.request",
        id: "native-1",
        command: { kind: "workspace.pickFiles", start: "D:/workspace", multiple: true },
      },
    ]
    for (const s of samples) {
      expect(JSON.parse(JSON.stringify(s))).toEqual(s)
    }
  })
})

describe("route directory policy", () => {
  test("control-plane and global routes do not require a project directory", () => {
    for (const path of [
      "/doc",
      "/shutdown",
      "/restart",
      "/log",
      "/log/files",
      "/global/health",
      "/global/event",
      "/global/config",
      "/global/dispose",
      "/global/db/reset",
      "/global/db/mysql/schema",
      "/global/db/mysql/export",
      "/global/db/mysql/import",
      "/global/tasks",
      "/auth",
      "/auth/login",
      "/ui/index.html",
      "/mission",
      "/task/abc/conversation",
      "/task/abc/conversation/history",
      "/task/abc/conversation/events",
      "/task/abc/conversation/session/session_123",
      "/favicon.ico",
    ]) {
      expect(routeRequiresProjectDirectory(path)).toBe(false)
    }
    expect(routeRequiresProjectDirectory("/task/abc", "DELETE")).toBe(false)
  })

  test("project routes require directory regardless of leading slash or query", () => {
    for (const path of [
      "tasks",
      "/task/abc/followup",
      "/task/abc/message",
      "/path",
      "/vcs",
      "/config/providers",
      "/config/proxy/test",
      "/config/prompt-profile",
      "/session/session_123/conversation",
      "/mission/wake",
      "/task/abc/browser-preview?targetID=art_1",
    ]) {
      expect(routeRequiresProjectDirectory(path)).toBe(true)
    }
    expect(routeRequiresProjectDirectory("/task/abc", "GET")).toBe(true)
    expect(routeRequiresProjectDirectory("/task/abc/conversation", "POST")).toBe(true)
  })
})
