import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { HostTransport, TransportRequest } from "../src/services/host-transport"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

const CONFIG_SOURCE = readFileSync(join(import.meta.dir, "../src/services/config.ts"), "utf8")
const MAIN_SOURCE = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8")

const { configure } = await import("../src/services/api")
const { loadPromptProfileCatalog, markPromptProfileCatalogStale, markSessionConfigStale } = await import(
  "../src/services/config"
)
const { HOST_CAPABILITIES, __setHostTransportForTest } = await import("../src/services/host-transport")
const { setAppStore } = await import("../src/store/app")
const { setBoardStore } = await import("../src/store/board")
const { setSettingsStore } = await import("../src/store/settings")
const { promptProfileCatalogDirectory, promptProfileCatalogRequestKey, promptProfileCatalogScope } = await import(
  "../src/services/prompt-profile-scope"
)

function resetStores(): void {
  setAppStore({
    connected: true,
    config: {
      prompt_profile: {
        active: "frontend-replica",
      },
    },
  })
  setSettingsStore({
    directory: "D:/repo/project",
    savedDirectory: "",
    workspaceTaskID: "",
    workspaceDirectory: "",
    directoryEpoch: 0,
  })
  setBoardStore({
    board: null,
    tasks: [],
    pendingTasks: [],
    selectedSource: null,
    taskSequence: 0,
    selectEpoch: 0,
    taskSwitching: false,
    path: null,
    vcs: null,
    changes: [],
    boardEtag: "",
    snapshotVersion: "",
    tasksError: "",
  })
}

describe("prompt profile task session owner", () => {
  afterEach(() => {
    resetStores()
    configure({ directory: "" })
    __setHostTransportForTest(undefined)
  })

  test("selected task with unresolved root session does not fall back to project catalog", () => {
    resetStores()
    setBoardStore("selectedSource", { kind: "task", id: "tsk_1", directory: "D:/repo/task" })

    expect(promptProfileCatalogDirectory()).toBe("D:/repo/task")
    expect(promptProfileCatalogScope()).toEqual({ kind: "pending", taskID: "tsk_1", directory: "D:/repo/task" })
    expect(promptProfileCatalogRequestKey()).toBe("prompt-profile:pending-task:tsk_1:D:/repo/task")
  })

  test("selected task ignores stale board sessions from a previous task", () => {
    resetStores()
    setBoardStore("selectedSource", { kind: "task", id: "tsk_2", directory: "D:/repo/task" })
    setBoardStore("board", {
      snapshotVersion: "snapshot-old",
      task: {
        id: "tsk_1",
        directory: "D:/repo/old",
        sessionID: "ses_old",
      },
    })

    expect(promptProfileCatalogScope()).toEqual({ kind: "pending", taskID: "tsk_2", directory: "D:/repo/task" })

    setBoardStore("tasks", [
      {
        task: {
          id: "tsk_2",
          directory: "D:/repo/task",
          sessionID: "ses_new",
        },
      },
    ])

    expect(promptProfileCatalogScope()).toEqual({ kind: "session", sessionID: "ses_new", directory: "D:/repo/task" })
  })

  test("selected task keeps prompt profile pending while task switch is hydrating", () => {
    resetStores()
    setBoardStore("selectedSource", { kind: "task", id: "tsk_1", directory: "D:/repo/task" })
    setBoardStore("taskSwitching", true)
    setBoardStore("tasks", [
      {
        task: {
          id: "tsk_1",
          directory: "D:/repo/task",
          sessionID: "ses_root",
        },
      },
    ])

    expect(promptProfileCatalogScope()).toEqual({ kind: "pending", taskID: "tsk_1", directory: "D:/repo/task" })
    expect(promptProfileCatalogRequestKey()).toBe("prompt-profile:pending-task:tsk_1:D:/repo/task")

    setBoardStore("taskSwitching", false)

    expect(promptProfileCatalogScope()).toEqual({ kind: "session", sessionID: "ses_root", directory: "D:/repo/task" })
    expect(promptProfileCatalogRequestKey()).toMatch(/^prompt-profile:catalog:D:\/repo\/task:session:ses_root:\d+$/)
  })

  test("selected task loads the root session catalog after the root session resolves", () => {
    resetStores()
    setBoardStore("selectedSource", { kind: "task", id: "tsk_1", directory: "D:/repo/task" })
    setBoardStore("tasks", [
      {
        task: {
          id: "tsk_1",
          directory: "D:/repo/task",
          sessionID: "ses_root",
        },
      },
    ])

    const key = promptProfileCatalogRequestKey()

    expect(promptProfileCatalogScope()).toEqual({ kind: "session", sessionID: "ses_root", directory: "D:/repo/task" })
    expect(key).toMatch(/^prompt-profile:catalog:D:\/repo\/task:session:ses_root:\d+$/)

    setBoardStore("tasks", [
      {
        task: {
          id: "tsk_1",
          directory: "D:/repo/task",
          sessionID: "ses_root",
        },
      },
    ])

    expect(promptProfileCatalogRequestKey()).toBe(key)
  })

  test("project and standalone session scopes keep distinct request keys", () => {
    resetStores()
    const projectKey = promptProfileCatalogRequestKey()

    setBoardStore("selectedSource", { kind: "session", id: "ses_direct" })

    expect(projectKey).toMatch(/^prompt-profile:catalog:D:\/repo\/project:project:\d+$/)
    expect(promptProfileCatalogScope()).toEqual({
      kind: "session",
      sessionID: "ses_direct",
      directory: "D:/repo/project",
    })
    expect(promptProfileCatalogRequestKey()).toMatch(
      /^prompt-profile:catalog:D:\/repo\/project:session:ses_direct:\d+$/,
    )
  })

  test("prompt profile catalog loaders require an explicit project or session scope", () => {
    expect(CONFIG_SOURCE).toContain("export type PromptProfileCatalogScope")
    expect(CONFIG_SOURCE).toContain("export async function loadPromptProfileCatalog(scope: PromptProfileCatalogScope)")
    expect(CONFIG_SOURCE).not.toContain("loadPromptProfileCatalog(sessionID?: string)")
    expect(MAIN_SOURCE).toContain("const scope = promptProfileCatalogScope()")
    expect(MAIN_SOURCE).toContain("promptProfileLoadedRequestKey")
    expect(MAIN_SOURCE).toContain("requestKey === promptProfileInFlightRequestKey")
    expect(MAIN_SOURCE).not.toContain("rootTaskSessionID() || activeSessionID() || undefined")
  })

  test("ordinary config reloads do not change the prompt profile request key", () => {
    resetStores()
    setBoardStore("selectedSource", { kind: "task", id: "tsk_1", directory: "D:/repo/task" })
    setBoardStore("tasks", [
      {
        task: {
          id: "tsk_1",
          directory: "D:/repo/task",
          sessionID: "ses_root",
        },
      },
    ])

    const before = promptProfileCatalogRequestKey()

    setAppStore("config", {
      prompt_profile: {
        active: "backend",
      },
    })

    expect(promptProfileCatalogRequestKey()).toBe(before)

    markSessionConfigStale("ses_root")

    expect(promptProfileCatalogRequestKey()).toBe(before)

    markPromptProfileCatalogStale()

    expect(promptProfileCatalogRequestKey()).not.toBe(before)
  })

  test("catalog requests carry the scope directory instead of relying on the global api directory", async () => {
    resetStores()
    configure({ directory: "D:/repo/old" })
    const requests: TransportRequest[] = []
    __setHostTransportForTest({
      kind: "browser",
      capabilities: HOST_CAPABILITIES.browser,
      async request(req) {
        requests.push(req)
        return {
          status: 200,
          ok: true,
          headers: {},
          body: {
            active: "frontend-replica",
            project_active: "frontend-replica",
            session_active: "frontend-replica",
            default: "general",
            targets: [],
            profiles: [
              { id: "general", label: "General" },
              { id: "frontend-replica", label: "Frontend Replica" },
            ],
          },
        }
      },
      openStream() {
        return { close() {} }
      },
      async native() {
        return true
      },
      subscribeUiCommand() {
        return { unsubscribe() {} }
      },
    } satisfies HostTransport)

    await loadPromptProfileCatalog({ kind: "session", directory: "D:/repo/task", sessionID: "ses_root" })

    expect(requests).toHaveLength(1)
    expect(requests[0]!.path).toBe("config/prompt-profile")
    expect(requests[0]!.query?.directory).toBe("D:/repo/task")
    expect(requests[0]!.query?.sessionID).toBe("ses_root")
  })

  test("catalog requests coalesce the same in-flight scope without retaining a stale result", async () => {
    resetStores()
    configure({ directory: "D:/repo/old" })
    const requests: TransportRequest[] = []
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const responseBody = {
      active: "frontend-replica",
      project_active: "frontend-replica",
      session_active: "frontend-replica",
      default: "general",
      targets: [],
      profiles: [
        { id: "general", label: "General" },
        { id: "frontend-replica", label: "Frontend Replica" },
      ],
    }
    __setHostTransportForTest({
      kind: "browser",
      capabilities: HOST_CAPABILITIES.browser,
      async request(req) {
        requests.push(req)
        await gate
        return {
          status: 200,
          ok: true,
          headers: {},
          body: responseBody,
        }
      },
      openStream() {
        return { close() {} }
      },
      async native() {
        return true
      },
      subscribeUiCommand() {
        return { unsubscribe() {} }
      },
    } satisfies HostTransport)

    const first = loadPromptProfileCatalog({ kind: "session", directory: "D:/repo/task", sessionID: "ses_root" })
    const second = loadPromptProfileCatalog({ kind: "session", directory: "D:/repo/task", sessionID: "ses_root" })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests).toHaveLength(1)

    release?.()

    await expect(Promise.all([first, second])).resolves.toEqual([responseBody, responseBody])

    await loadPromptProfileCatalog({ kind: "session", directory: "D:/repo/task", sessionID: "ses_root" })

    expect(requests).toHaveLength(2)
  })
})
