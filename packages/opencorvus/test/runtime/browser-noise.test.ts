import { describe, expect, test } from "bun:test"
import { isBrowserImplicitAssetRequest, isResourceLoadConsoleError } from "../../src/runtime/browser-noise"

describe("browser-implicit asset request", () => {
  test("treats the conventional root favicon as browser-implicit on any origin", () => {
    expect(isBrowserImplicitAssetRequest("http://127.0.0.1:5173/favicon.ico")).toBe(true)
    expect(isBrowserImplicitAssetRequest("https://example.com/favicon.ico?v=2")).toBe(true)
  })

  test("does not exclude app-authored assets", () => {
    // A real broken bundle / asset must still be caught by the asset layer.
    expect(isBrowserImplicitAssetRequest("http://127.0.0.1:5173/src/main.js")).toBe(false)
    expect(isBrowserImplicitAssetRequest("http://127.0.0.1:5173/assets/app.css")).toBe(false)
    // Only the root favicon is the browser default — nested ones are app-owned.
    expect(isBrowserImplicitAssetRequest("http://127.0.0.1:5173/public/favicon.ico")).toBe(false)
    expect(isBrowserImplicitAssetRequest("http://127.0.0.1:5173/icons/favicon.ico")).toBe(false)
  })

  test("returns false for unparseable urls", () => {
    expect(isBrowserImplicitAssetRequest("not a url")).toBe(false)
  })
})

describe("resource-load console error", () => {
  test("matches Chromium's mirrored network-failure console message (reproduced text)", () => {
    expect(
      isResourceLoadConsoleError("Failed to load resource: the server responded with a status of 404 (Not Found)"),
    ).toBe(true)
    expect(isResourceLoadConsoleError("Failed to load resource: net::ERR_CONNECTION_REFUSED")).toBe(true)
    expect(isResourceLoadConsoleError("  Failed to load resource: blocked by client")).toBe(true)
  })

  test("keeps genuine app JavaScript errors", () => {
    expect(isResourceLoadConsoleError("Uncaught TypeError: x is not a function")).toBe(false)
    expect(isResourceLoadConsoleError("React error #418")).toBe(false)
    expect(isResourceLoadConsoleError("Warning: failed to load resource later in the sentence")).toBe(false)
  })
})
