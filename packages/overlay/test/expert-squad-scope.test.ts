import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { HostTransport, TransportRequest } from "../src/services/host-transport"
import { expertSquadCatalogFixture } from "./browser/expert-squad-fixture"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

const MAIN_SOURCE = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8")
const SERVICE_SOURCE = readFileSync(join(import.meta.dir, "../src/services/expert-squad.ts"), "utf8")
const PANEL_SOURCE = readFileSync(join(import.meta.dir, "../src/components/settings/ExpertSquadPanel.tsx"), "utf8")
const SKILL_MARKET_SOURCE = readFileSync(
  join(import.meta.dir, "../src/components/settings/SkillMarketPanel.tsx"),
  "utf8",
)

const { configure } = await import("../src/services/api")
const { loadExpertSquadCatalog, markExpertSquadCatalogStale, setProjectExpertSquadActive } = await import(
  "../src/services/expert-squad"
)
const { markSessionConfigStale } = await import("../src/services/config")
const { HOST_CAPABILITIES, __setHostTransportForTest } = await import("../src/services/host-transport")
const { appStore, setAppStore } = await import("../src/store/app")
const { setBoardStore } = await import("../src/store/board")
const { setSettingsStore } = await import("../src/store/settings")
const { expertSquadCatalogDirectory, expertSquadCatalogRequestKey, expertSquadCatalogScope } = await import(
  "../src/services/expert-squad-scope"
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

function installCatalogTransport(): TransportRequest[] {
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
        body: expertSquadCatalogFixture({
          active: "frontend-replica",
          projectActive: "frontend-replica",
          squads: [
            { id: "general", label: "General", built_in: true },
            { id: "frontend-replica", label: "Frontend Replica", built_in: false },
          ],
        }),
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
  return requests
}

describe("expert squad task session owner", () => {
  afterEach(() => {
    resetStores()
    configure({ directory: "" })
    __setHostTransportForTest(undefined)
  })

  test("selected task with unresolved root session does not fall back to project catalog", () => {
    resetStores()
    setBoardStore("selectedSource", { kind: "task", id: "tsk_1", directory: "D:/repo/task" })

    expect(expertSquadCatalogDirectory()).toBe("D:/repo/task")
    expect(expertSquadCatalogScope()).toEqual({ kind: "pending", taskID: "tsk_1", directory: "D:/repo/task" })
    expect(expertSquadCatalogRequestKey()).toBe("expert-squad:pending-task:tsk_1:D:/repo/task")
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

    expect(expertSquadCatalogScope()).toEqual({ kind: "pending", taskID: "tsk_2", directory: "D:/repo/task" })

    setBoardStore("tasks", [
      {
        task: {
          id: "tsk_2",
          directory: "D:/repo/task",
          sessionID: "ses_new",
        },
      },
    ])

    expect(expertSquadCatalogScope()).toEqual({ kind: "session", sessionID: "ses_new", directory: "D:/repo/task" })
  })

  test("selected task keeps expert squad pending while task switch is hydrating", () => {
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

    expect(expertSquadCatalogScope()).toEqual({ kind: "pending", taskID: "tsk_1", directory: "D:/repo/task" })
    expect(expertSquadCatalogRequestKey()).toBe("expert-squad:pending-task:tsk_1:D:/repo/task")

    setBoardStore("taskSwitching", false)

    expect(expertSquadCatalogScope()).toEqual({ kind: "session", sessionID: "ses_root", directory: "D:/repo/task" })
    expect(expertSquadCatalogRequestKey()).toMatch(/^expert-squad:catalog:D:\/repo\/task:session:ses_root:\d+$/)
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

    const key = expertSquadCatalogRequestKey()

    expect(expertSquadCatalogScope()).toEqual({ kind: "session", sessionID: "ses_root", directory: "D:/repo/task" })
    expect(key).toMatch(/^expert-squad:catalog:D:\/repo\/task:session:ses_root:\d+$/)

    setBoardStore("tasks", [
      {
        task: {
          id: "tsk_1",
          directory: "D:/repo/task",
          sessionID: "ses_root",
        },
      },
    ])

    expect(expertSquadCatalogRequestKey()).toBe(key)
  })

  test("project catalog ignores stale standalone sessions after the project directory changes", async () => {
    resetStores()
    setBoardStore("selectedSource", { kind: "session", id: "ses_direct" })
    setSettingsStore("directory", "D:/repo/new-project")
    const requests = installCatalogTransport()

    const scope = expertSquadCatalogScope()

    expect(scope).toEqual({ kind: "project", directory: "D:/repo/new-project" })
    expect(expertSquadCatalogRequestKey()).toMatch(/^expert-squad:catalog:D:\/repo\/new-project:project:\d+$/)
    if (scope.kind !== "project" && scope.kind !== "session") throw new Error("catalog scope did not resolve")

    await loadExpertSquadCatalog(scope)

    expect(requests).toHaveLength(1)
    expect(requests[0]!.path).toBe("expert-squad/catalog")
    expect(requests[0]!.query?.directory).toBe("D:/repo/new-project")
    expect(requests[0]!.query?.sessionID).toBeUndefined()
  })

  test("expert squad catalog loaders require an explicit project or session scope", () => {
    expect(SERVICE_SOURCE).toContain("export type ExpertSquadCatalogScope")
    expect(SERVICE_SOURCE).toContain("export async function loadExpertSquadCatalog(scope: ExpertSquadCatalogScope)")
    expect(SERVICE_SOURCE).not.toContain("loadExpertSquadCatalog(sessionID?: string)")
    expect(MAIN_SOURCE).toContain("const scope = expertSquadCatalogScope()")
    expect(MAIN_SOURCE).toContain("expertSquadLoadedRequestKey")
    expect(MAIN_SOURCE).toContain("requestKey === expertSquadInFlightRequestKey")
    expect(MAIN_SOURCE).toContain("setActiveExpertSquad(catalog.active.effective)")
    expect(MAIN_SOURCE).not.toContain("catalog.profiles")
    expect(MAIN_SOURCE).not.toContain("setActivePromptProfile")
    expect(MAIN_SOURCE).not.toContain("rootTaskSessionID() || activeSessionID() || undefined")
  })

  test("overlay expert squad catalog type carries MCP prompt and resource refs", () => {
    for (const field of [
      "default_mcp_prompt_refs",
      "package_mcp_prompt_refs",
      "default_mcp_resource_refs",
      "package_mcp_resource_refs",
    ]) {
      expect(SERVICE_SOURCE).toContain(`${field}: string[]`)
    }
  })

  test("skill mount matrix uses the same expert squad session scope", () => {
    expect(SKILL_MARKET_SOURCE).toContain('import { expertSquadCatalogScope } from "../../services/expert-squad-scope"')
    expect(SKILL_MARKET_SOURCE).toContain("const scope = expertSquadCatalogScope()")
    expect(SKILL_MARKET_SOURCE).toContain('scope.kind === "pending"')
    expect(SKILL_MARKET_SOURCE).toContain("sessionID,")
  })

  test("ordinary config reloads do not change the expert squad request key", () => {
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

    const before = expertSquadCatalogRequestKey()

    setAppStore("config", {
      prompt_profile: {
        active: "backend",
      },
    })

    expect(expertSquadCatalogRequestKey()).toBe(before)

    markSessionConfigStale("ses_root")

    expect(expertSquadCatalogRequestKey()).toBe(before)

    markExpertSquadCatalogStale()

    expect(expertSquadCatalogRequestKey()).not.toBe(before)
  })

  test("catalog requests carry the scope directory instead of relying on the global api directory", async () => {
    resetStores()
    configure({ directory: "D:/repo/old" })
    const requests = installCatalogTransport()

    await loadExpertSquadCatalog({ kind: "session", directory: "D:/repo/task", sessionID: "ses_root" })

    expect(requests).toHaveLength(1)
    expect(requests[0]!.path).toBe("expert-squad/catalog")
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
    const responseBody = expertSquadCatalogFixture({
      active: "frontend-replica",
      projectActive: "frontend-replica",
      squads: [
        { id: "general", label: "General", built_in: true },
        { id: "frontend-replica", label: "Frontend Replica", built_in: false },
      ],
    })
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

    const first = loadExpertSquadCatalog({ kind: "session", directory: "D:/repo/task", sessionID: "ses_root" })
    const second = loadExpertSquadCatalog({ kind: "session", directory: "D:/repo/task", sessionID: "ses_root" })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests).toHaveLength(1)

    markExpertSquadCatalogStale()
    const third = loadExpertSquadCatalog({ kind: "session", directory: "D:/repo/task", sessionID: "ses_root" })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests).toHaveLength(2)

    release?.()

    await expect(Promise.all([first, second, third])).resolves.toEqual([responseBody, responseBody, responseBody])

    await loadExpertSquadCatalog({ kind: "session", directory: "D:/repo/task", sessionID: "ses_root" })

    expect(requests).toHaveLength(3)
  })

  test("project activation ignores config responses after directory ownership changes", async () => {
    resetStores()
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
          body:
            req.method === "PATCH"
              ? { prompt_profile: { active: "backend" } }
              : { prompt_profile: { active: "frontend-replica" } },
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

    await setProjectExpertSquadActive("backend", "D:/repo/project", {
      isCurrentDirectory: () => false,
    })

    expect(requests.map((request) => request.method ?? "GET")).toEqual(["GET", "PATCH"])
    expect(requests.every((request) => request.query?.directory === "D:/repo/project")).toBe(true)
    expect(appStore.config.prompt_profile.active).toBe("frontend-replica")
  })

  test("settings panel expert squad writes are bound to the captured catalog scope", () => {
    expect(PANEL_SOURCE).toContain("function catalogScopeIdentity")
    expect(PANEL_SOURCE).toContain("function captureCatalogActionScope")
    expect(PANEL_SOURCE).toContain("const actionScopeIdentity = captured.identity")
    expect(PANEL_SOURCE).toContain("if (currentScopeIdentity() !== actionScopeIdentity) return")
    expect(PANEL_SOURCE).toContain("await refreshCatalog(squad.id, actionScope, actionScopeIdentity)")
    expect(PANEL_SOURCE).toContain("await refreshCatalog(projectActiveID(), actionScope, actionScopeIdentity)")
  })

  test("settings panel import and export actions use the captured catalog scope", () => {
    expect(PANEL_SOURCE).toContain("const captured = captureCatalogActionScope()")
    expect(PANEL_SOURCE).toContain("const sourceDirectory = await pickDirectory(captured.scope.directory)")
    expect(PANEL_SOURCE).toContain("directory: captured.scope.directory")
    expect(PANEL_SOURCE).toContain("await refreshCatalog(result.id, captured.scope, captured.identity)")
    expect(PANEL_SOURCE).toContain("await exportExpertSquadArchive(captured.scope.directory, squad.id)")
    expect(PANEL_SOURCE).toContain('"import-folder"')
    expect(PANEL_SOURCE).toContain('"import-archive"')
    expect(PANEL_SOURCE).toContain('"export"')
  })

  test("settings panel archive import captures scope before opening the native file picker", () => {
    expect(PANEL_SOURCE).toContain("let pendingArchiveImportScope: CapturedCatalogActionScope | null = null")
    expect(PANEL_SOURCE).toContain("function openArchivePicker()")
    expect(PANEL_SOURCE).toContain("pendingArchiveImportScope = captured")
    expect(PANEL_SOURCE.indexOf("pendingArchiveImportScope = captured")).toBeLessThan(
      PANEL_SOURCE.indexOf("archiveInput?.click()"),
    )
    expect(PANEL_SOURCE).toContain("const captured = pendingArchiveImportScope")
    expect(PANEL_SOURCE).toContain("pendingArchiveImportScope = null")
    expect(PANEL_SOURCE).toContain("onClick={openArchivePicker}")
  })

  test("settings panel clears stale transient state after catalog scope changes", () => {
    expect(PANEL_SOURCE).toContain("clearNotice()")
    expect(PANEL_SOURCE).toContain('if (scope.kind === "unavailable" || scope.kind === "pending")')
    expect(PANEL_SOURCE).toContain('t("expert_squad.scope_pending")')
    expect(PANEL_SOURCE).toContain('data-ui="expert-squad-scope-state"')
    expect(PANEL_SOURCE).toContain('setActionError("")')
    expect(PANEL_SOURCE).toContain("setLoading(false)")
    expect(PANEL_SOURCE).toContain("loadSequence++")
    expect(PANEL_SOURCE).toContain("type BusyAction = { key: string; scopeIdentity: string }")
    expect(PANEL_SOURCE).toContain("const activeBusy = createMemo")
    expect(PANEL_SOURCE).toContain("setBusy({ key, scopeIdentity: expectedScopeIdentity })")
    expect(PANEL_SOURCE).toContain(
      "current?.key === key && current.scopeIdentity === expectedScopeIdentity ? null : current",
    )
  })

  test("settings panel catalog-derived overview is scoped to the current catalog identity", () => {
    expect(PANEL_SOURCE).toContain('const [catalogIdentity, setCatalogIdentity] = createSignal("")')
    expect(PANEL_SOURCE).toContain(
      "const scopedCatalog = createMemo(() => (catalogIdentity() === currentScopeIdentity() ? catalog() : null))",
    )
    expect(PANEL_SOURCE).toContain("const squads = createMemo(() => scopedCatalog()?.squads ?? [])")
    expect(PANEL_SOURCE).toContain('const projectActiveID = createMemo(() => scopedCatalog()?.active.project ?? "")')
    expect(PANEL_SOURCE).toContain('const effectiveActiveID = createMemo(() => scopedCatalog()?.active.effective ?? "")')
    expect(PANEL_SOURCE).toContain("setCatalogIdentity(expectedScopeIdentity)")
    expect(PANEL_SOURCE).toContain('setCatalogIdentity("")')
  })

  test("settings panel clears stale catalog errors before same-scope reload starts", () => {
    expect(PANEL_SOURCE).toContain('if (currentScopeIdentity() === expectedScopeIdentity) setCatalogError("")')
    expect(
      PANEL_SOURCE.indexOf('if (currentScopeIdentity() === expectedScopeIdentity) setCatalogError("")'),
    ).toBeLessThan(PANEL_SOURCE.indexOf("const next = await loadExpertSquadCatalog(scope)"))
    expect(PANEL_SOURCE).toContain("<Show when={catalogError()}>")
    expect(PANEL_SOURCE).toContain(
      '<Show when={!loading()} fallback={<div class="loading-hint">{t("expert_squad.loading")}</div>}>',
    )
  })
})
