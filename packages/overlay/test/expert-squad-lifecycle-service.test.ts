import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { HostTransport, TransportRequest, TransportResponse } from "../src/services/host-transport"
import { expertSquadCatalogFixture } from "./browser/expert-squad-fixture"

;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

const { configure } = await import("../src/services/api")
const { __setHostTransportForTest } = await import("../src/services/host-transport")
const { setAppStore } = await import("../src/store/app")
const {
  clearSessionExpertSquadOverride,
  exportExpertSquadArchive,
  importExpertSquadArchive,
  importExpertSquadFolder,
  loadExpertSquadCatalog,
  setProjectExpertSquadActive,
  setSessionExpertSquadActive,
} = await import("../src/services/expert-squad")

const EXPERT_SQUAD_SERVICE = readFileSync(join(import.meta.dir, "../src/services/expert-squad.ts"), "utf8")
const CONFIG_SERVICE = readFileSync(join(import.meta.dir, "../src/services/config.ts"), "utf8")

function installTransport(
  responder: (req: TransportRequest) => TransportResponse<unknown> | Promise<TransportResponse<unknown>>,
): TransportRequest[] {
  const requests: TransportRequest[] = []
  __setHostTransportForTest({
    kind: "browser",
    async request(req) {
      requests.push(req)
      return (await responder(req)) as TransportResponse<any>
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

afterEach(() => {
  __setHostTransportForTest(undefined)
  configure({ directory: "" })
  setAppStore({ connected: true, config: {} })
})

describe("expert squad lifecycle service", () => {
  test("config service no longer owns expert-squad catalog helpers", () => {
    expect(CONFIG_SERVICE).not.toContain("loadPromptProfileCatalog")
    expect(CONFIG_SERVICE).not.toContain("setProjectPromptProfileActive")
    expect(CONFIG_SERVICE).not.toContain("setSessionPromptProfileActive")
    expect(CONFIG_SERVICE).not.toContain("prompt_profile.profiles")
  })

  test("catalog requests use the expert-squad route and include explicit scope", async () => {
    setAppStore("connected", true)
    const body = expertSquadCatalogFixture({
      active: "frontend-replica",
      projectActive: "general",
      sessionOverride: "frontend-replica",
      squads: [
        { id: "general", label: "General", built_in: true },
        { id: "frontend-replica", label: "Frontend Replica", built_in: false },
      ],
    })
    const requests = installTransport(() => ({ status: 200, ok: true, headers: {}, body }))

    await expect(
      loadExpertSquadCatalog({ kind: "session", directory: "D:/repo/task", sessionID: "ses_root" }),
    ).resolves.toEqual(body)

    expect(requests).toHaveLength(1)
    expect(requests[0]!.path).toBe("expert-squad/catalog")
    expect(requests[0]!.query).toMatchObject({ directory: "D:/repo/task", sessionID: "ses_root" })
  })

  test("catalog failure reports the exact expert-squad request path", async () => {
    setAppStore("connected", true)
    installTransport(() => ({ status: 500, ok: false, headers: {}, body: { data: { message: "broken manifest" } } }))

    await expect(loadExpertSquadCatalog({ kind: "project", directory: "D:/repo/project" })).rejects.toThrow(
      "GET /expert-squad/catalog?directory=D%3A%2Frepo%2Fproject failed:",
    )
    await expect(loadExpertSquadCatalog({ kind: "project", directory: "D:/repo/project" })).rejects.toThrow(
      "broken manifest",
    )
  })

  test("project activation, session override, and clearing write only prompt_profile state", async () => {
    setAppStore({
      connected: true,
      config: {
        prompt_profile: {
          active: "general",
        },
      },
    })
    let serverConfig: Record<string, unknown> = { prompt_profile: { active: "general" } }
    const requests = installTransport((request) => {
      if (request.method === "PATCH" && request.body?.kind === "json") {
        serverConfig = {
          ...serverConfig,
          ...(request.body.value as Record<string, unknown>),
        }
      }
      return {
        status: 200,
        ok: true,
        headers: {},
        body: serverConfig,
      }
    })

    await setProjectExpertSquadActive("frontend-replica", "D:/repo/project")
    await setSessionExpertSquadActive("ses_root", "backend", "D:/repo/task")
    await clearSessionExpertSquadOverride("ses_root", "D:/repo/task")

    const patchRequests = requests.filter((request) => request.method === "PATCH")
    expect(patchRequests[0]!.path).toBe("config")
    expect(patchRequests[0]!.query?.directory).toBe("D:/repo/project")
    expect((patchRequests[0]!.body as any).value).toEqual({ prompt_profile: { active: "frontend-replica" } })
    expect(patchRequests[1]!.path).toBe("session/ses_root/config")
    expect(patchRequests[1]!.query?.directory).toBe("D:/repo/task")
    expect((patchRequests[1]!.body as any).value).toEqual({ prompt_profile: { active: "backend" } })
    expect(patchRequests[2]!.path).toBe("session/ses_root/config")
    expect(patchRequests[2]!.query?.directory).toBe("D:/repo/task")
    expect((patchRequests[2]!.body as any).value).toEqual({ prompt_profile: null })
  })

  test("import, explicit replace, and export bind to the viewed directory", async () => {
    setAppStore("connected", true)
    const requests = installTransport((req) => {
      if (req.path === "expert-squad/export") {
        return {
          status: 200,
          ok: true,
          headers: {},
          body: { id: "frontend-replica", filename: "frontend-replica.zip", archiveBase64: "eA==", fileCount: 1 },
        }
      }
      return {
        status: 200,
        ok: true,
        headers: {},
        body: {
          namespace: "builtin",
          id: "frontend-replica",
          targetRoot: "D:/repo/.opencorvus/expert-squads/builtin/frontend-replica",
          replaced: true,
        },
      }
    })

    const folderImport = await importExpertSquadFolder({
      directory: "D:/repo/project",
      sourceDirectory: "D:/incoming/frontend-replica",
      replace: false,
    })
    const fileImport = await importExpertSquadArchive({
      directory: "D:/repo/project",
      archiveBase64: "eA==",
      filename: "frontend-replica.zip",
      replace: true,
    })
    await exportExpertSquadArchive("D:/repo/project", "frontend-replica")

    expect(requests.map((request) => request.path)).toEqual([
      "expert-squad/import-folder",
      "expert-squad/import-file",
      "expert-squad/export",
    ])
    expect(requests.every((request) => request.query?.directory === "D:/repo/project")).toBe(true)
    expect((requests[0]!.body as any).value).toEqual({
      sourceDirectory: "D:/incoming/frontend-replica",
      replace: false,
    })
    expect((requests[1]!.body as any).value).toEqual({
      archiveBase64: "eA==",
      filename: "frontend-replica.zip",
      replace: true,
    })
    expect((requests[2]!.body as any).value).toEqual({ id: "frontend-replica" })
    expect(folderImport).toMatchObject({
      namespace: "builtin",
      targetRoot: "D:/repo/.opencorvus/expert-squads/builtin/frontend-replica",
    })
    expect(fileImport).toMatchObject({
      namespace: "builtin",
      targetRoot: "D:/repo/.opencorvus/expert-squads/builtin/frontend-replica",
    })
  })

  test("service source allows prompt_profile.active but no custom prompt-profile definitions", () => {
    expect(EXPERT_SQUAD_SERVICE).toContain("prompt_profile")
    expect(EXPERT_SQUAD_SERVICE).toContain("active: expertSquadID")
    expect(EXPERT_SQUAD_SERVICE).not.toContain("prompt_profile.profiles")
    expect(EXPERT_SQUAD_SERVICE).not.toContain("profiles,")
    expect(EXPERT_SQUAD_SERVICE).not.toContain("expert_squad.active")
    expect(EXPERT_SQUAD_SERVICE).not.toContain("general")
  })
})
