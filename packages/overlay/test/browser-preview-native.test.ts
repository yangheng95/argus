import { afterEach, describe, expect, test } from "bun:test"
import {
  HOST_CAPABILITIES,
  UnsupportedNativeCommandError,
  __setHostTransportForTest,
  type HostTransport,
  type NativeCommand,
} from "../src/services/host-transport"
import {
  browserPreviewNativeSurfaceAvailable,
  closeBrowserPreviewNativeSurface,
  navigateBrowserPreviewNativeSurface,
  syncBrowserPreviewNativeSurface,
} from "../src/services/browser-preview-native"

function fakeTransport(host: "tauri" | "browser", commands: NativeCommand[]): HostTransport {
  return {
    kind: host,
    capabilities: HOST_CAPABILITIES[host],
    async request() {
      throw new Error("browser preview native test does not issue HTTP requests")
    },
    openStream() {
      throw new Error("browser preview native test does not open streams")
    },
    async native(command) {
      commands.push(command)
      return true
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  }
}

describe("browser preview native service", () => {
  afterEach(() => {
    __setHostTransportForTest(undefined)
  })

  test("routes sync, navigation, and close through HostTransport native commands", async () => {
    const commands: NativeCommand[] = []
    __setHostTransportForTest(fakeTransport("tauri", commands))

    expect(browserPreviewNativeSurfaceAvailable()).toBe(true)
    await syncBrowserPreviewNativeSurface({
      url: "http://127.0.0.1:4173/preview",
      bounds: { x: 11, y: 22, width: 640, height: 480 },
    })
    await navigateBrowserPreviewNativeSurface("back")
    await navigateBrowserPreviewNativeSurface("forward")
    await navigateBrowserPreviewNativeSurface("reload")
    await closeBrowserPreviewNativeSurface()

    expect(commands).toEqual([
      {
        kind: "browserPreview.sync",
        url: "http://127.0.0.1:4173/preview",
        bounds: { x: 11, y: 22, width: 640, height: 480 },
      },
      { kind: "browserPreview.navigate", action: "back" },
      { kind: "browserPreview.navigate", action: "forward" },
      { kind: "browserPreview.navigate", action: "reload" },
      { kind: "browserPreview.close" },
    ])
  })

  test("rejects hosts without native webview commands", async () => {
    const commands: NativeCommand[] = []
    __setHostTransportForTest(fakeTransport("browser", commands))

    expect(browserPreviewNativeSurfaceAvailable()).toBe(false)
    await expect(
      syncBrowserPreviewNativeSurface({
        url: "http://127.0.0.1:4173/preview",
        bounds: { x: 0, y: 0, width: 640, height: 480 },
      }),
    ).rejects.toBeInstanceOf(UnsupportedNativeCommandError)
    expect(commands).toEqual([])
  })
})
