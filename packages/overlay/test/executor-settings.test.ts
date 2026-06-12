import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type {
  HostKind,
  HostTransport,
  NativeCommand,
  TransportRequest,
  TransportResponse,
} from "../src/services/host-transport"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

const { __setHostTransportForTest } = await import("../src/services/host-transport")
const { createTauriTransport } = await import("../src/services/tauri-transport")
const { createTask, panelRequestBody } = await import("../src/services/task")
const {
  applySettings,
  bootstrapOverlaySettings,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  sanitizeExecutor,
  setSettingsStore,
  settingsStore,
} = await import("../src/store/settings")

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, String(value))
  }
  removeItem(key: string): void {
    this.values.delete(key)
  }
  clear(): void {
    this.values.clear()
  }
}

function fakeTransport(
  responder: (req: TransportRequest) => Promise<TransportResponse<unknown>> | TransportResponse<unknown>,
  native?: (command: NativeCommand) => Promise<unknown> | unknown,
  kind: HostKind = "tauri",
): HostTransport {
  return {
    kind,
    async request<T>(req: TransportRequest): Promise<TransportResponse<T>> {
      return (await responder(req)) as TransportResponse<T>
    },
    openStream() {
      throw new Error("openStream not used in executor settings tests")
    },
    async native(command) {
      return native ? await native(command) : true
    },
    subscribeUiCommand() {
      return { unsubscribe() {} }
    },
  }
}

const originalLocalStorage = (globalThis as any).localStorage

beforeEach(() => {
  ;(globalThis as any).localStorage = new MemoryStorage()
  applySettings({ ...DEFAULT_SETTINGS })
})

afterEach(() => {
  __setHostTransportForTest(undefined)
  applySettings({ ...DEFAULT_SETTINGS })
  ;(globalThis as any).localStorage = originalLocalStorage
})

describe("executor settings", () => {
  test("rejects stale executor ids from persisted settings", async () => {
    __setHostTransportForTest(
      fakeTransport(
        () => {
          throw new Error("request not used in settings load test")
        },
        (command) => {
          expect(command.kind).toBe("settings.load")
          return { executor: "opencode" }
        },
      ),
    )

    await loadSettings()

    expect(settingsStore.executor).toBe("opencorvus")
    expect(sanitizeExecutor("opencode")).toBe("opencorvus")
  })

  test("tauri settings load ignores stale browser storage", async () => {
    localStorage.setItem("oc_theme", "dark")
    localStorage.setItem("oc_directory", "D:/stale-browser")
    __setHostTransportForTest(
      fakeTransport(
        () => {
          throw new Error("request not used in settings load test")
        },
        (command) => {
          expect(command.kind).toBe("settings.load")
          return {
            theme: "light",
            directory: "D:/native-overlay",
            desktopNotifications: false,
          }
        },
      ),
    )

    await loadSettings()

    expect(settingsStore.theme).toBe("light")
    expect(settingsStore.directory).toBe("D:/native-overlay")
    expect(settingsStore.desktopNotifications).toBe(false)
  })

  test("browser host settings use browser storage as the single source", async () => {
    localStorage.setItem("oc_executor", "opencode")
    localStorage.setItem("oc_theme", "dark")
    localStorage.setItem("oc_preferred_project_editor", "cursor")
    __setHostTransportForTest(createTauriTransport("browser"))

    await loadSettings()

    expect(settingsStore.executor).toBe("opencorvus")
    expect(settingsStore.theme).toBe("dark")
    expect(settingsStore.preferredProjectEditor).toBe("cursor")

    setSettingsStore({
      theme: "light",
      savedDirectory: "D:/browser-source",
      preferredProjectEditor: "pycharm",
    })
    saveSettings()
    await Promise.resolve()

    expect(localStorage.getItem("oc_theme")).toBe("light")
    expect(localStorage.getItem("oc_directory")).toBe("D:/browser-source")
    expect(localStorage.getItem("oc_preferred_project_editor")).toBe("pycharm")
  })

  test("tauri settings save writes only through the native store", async () => {
    let saved: unknown
    __setHostTransportForTest(
      fakeTransport(
        () => {
          throw new Error("request not used in settings save test")
        },
        (command) => {
          expect(command.kind).toBe("settings.save")
          saved = command.payload
          return true
        },
      ),
    )
    setSettingsStore({
      theme: "dark",
      directory: "D:/dirty-unsaved",
      savedDirectory: "D:/persisted-native",
      sidebarCollapsed: true,
      desktopNotifications: false,
      preferredProjectEditor: "cursor",
    })

    saveSettings()
    await Promise.resolve()

    expect(localStorage.getItem("oc_theme")).toBeNull()
    expect(saved).toMatchObject({
      theme: "dark",
      directory: "D:/persisted-native",
      sidebarCollapsed: true,
      desktopNotifications: false,
      preferredProjectEditor: "cursor",
    })
  })

  test("task creation never sends a stale executor id", async () => {
    let captured: TransportRequest | undefined
    __setHostTransportForTest(
      fakeTransport((req) => {
        captured = req
        return {
          status: 200,
          ok: true,
          headers: {},
          body: { task_id: "task_123" },
        }
      }),
    )
    setSettingsStore("executor", "opencode" as any)

    await createTask({ text: "hello", queue: false, kind: "workflow" })

    expect(captured?.body?.kind).toBe("json")
    expect((captured?.body as any).value.executor).toBe("opencorvus")
    expect((captured?.body as any).value.kind).toBe("workflow")
  })

  test("task creation forwards an explicit OpenCorvus model", async () => {
    let captured: TransportRequest | undefined
    __setHostTransportForTest(
      fakeTransport((req) => {
        captured = req
        return {
          status: 200,
          ok: true,
          headers: {},
          body: { task_id: "task_model" },
        }
      }),
    )

    await createTask({ text: "hello", queue: false, kind: "workflow", model: "openai/gpt-5.5" })

    expect(captured?.body?.kind).toBe("json")
    expect((captured?.body as any).value.model).toBe("openai/gpt-5.5")
  })

  test("panel request body sanitizes explicit executor input", () => {
    expect(panelRequestBody("hello", {}, "req_1", [], "opencode").executor).toBe("opencorvus")
  })

  test("native settings task id alias restores the workspace task", () => {
    applySettings({
      ...DEFAULT_SETTINGS,
      workspaceTaskId: "tsk_native",
    } as Partial<typeof DEFAULT_SETTINGS> & { workspaceTaskId: string })

    expect(settingsStore.workspaceTaskID).toBe("tsk_native")
  })

  test("bootstrap settings writes the native workspace task id field", () => {
    setSettingsStore("workspaceTaskID", "tsk_saved")

    expect((bootstrapOverlaySettings(settingsStore) as any).workspaceTaskId).toBe("tsk_saved")
  })

  test("invalid persisted preferred editor falls back to vscode", async () => {
    __setHostTransportForTest(
      fakeTransport(
        () => {
          throw new Error("request not used in settings load test")
        },
        (command) => {
          expect(command.kind).toBe("settings.load")
          return { preferredProjectEditor: "notepad" }
        },
      ),
    )

    await loadSettings()

    expect(settingsStore.preferredProjectEditor).toBe("vscode")
  })
})
