import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { PanelTool } from "../../src/tool/panel"
import { EngineService } from "../../src/task-api"
import { Log } from "../../src/util/log"
import { derivePanelActor, PanelActor } from "../../src/panel/capability"
import { ensureMissionSession } from "../../src/mission/session"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

/**
 * Spec: gateway-mission-split-2026-05-28.md §4 (Mission → Squad provenance).
 *
 * `panel.create_task` records server-derived provenance: `actor` (the LLM
 * agent or external client that drove the call) and, when the actor is the
 * Mission agent, `source: "mission"` + `metadata.mission.{id, session_id}` so
 * the work shows up as Mission → Squad lineage. Auditing and authorization
 * branch off `actor`, never off the free-text `source` field.
 */
describe("derivePanelActor", () => {
  test("control agent maps to control_agent", () => {
    expect(derivePanelActor("control")).toBe(PanelActor.enum.control_agent)
  })

  test("mission agent maps to mission", () => {
    expect(derivePanelActor("mission")).toBe(PanelActor.enum.mission)
  })

  test("any other agent name (incl. undefined / blank / route fake) collapses to panel_ui", () => {
    expect(derivePanelActor(undefined)).toBe(PanelActor.enum.panel_ui)
    expect(derivePanelActor("")).toBe(PanelActor.enum.panel_ui)
    expect(derivePanelActor("gateway")).toBe(PanelActor.enum.panel_ui)
    expect(derivePanelActor("coding")).toBe(PanelActor.enum.panel_ui)
    expect(derivePanelActor("build")).toBe(PanelActor.enum.panel_ui)
  })
})

describe("panel.create_task actor provenance", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  // Run create_task and capture the EngineService.createTask input. When
  // `missionSession` is true, a real mission session is created first and
  // used as ctx.sessionID so the mission-provenance path can read
  // metadata.mission.id.
  async function runCreateTask(
    agent: string,
    opts: {
      userMetadata?: Record<string, unknown>
      missionSession?: boolean
      source?: string
      title?: string
    } = {},
  ) {
    await using tmp = await tmpdir({ git: true })
    let captured: { metadata?: Record<string, unknown>; source?: string; title?: string } | undefined
    let missionID: string | undefined
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const stubTaskID = Identifier.ascending("task")
        const createSpy = spyOn(EngineService, "createTask").mockResolvedValue(stubTaskID)
        let sessionID = Identifier.ascending("session")
        if (opts.missionSession) {
          const session = await ensureMissionSession({ missionID: "prov-mission", defaultCwd: tmp.path })
          sessionID = session.id
          missionID = session.missionID
        }
        const tool = await PanelTool.init()
        await tool.execute(
          {
            action: "create_task",
            request: "do thing",
            allow_create: true,
            queue: false,
            ...(opts.title ? { title: opts.title } : {}),
            ...(opts.userMetadata ? { metadata: opts.userMetadata } : {}),
            ...(opts.source ? { source: opts.source } : {}),
          },
          {
            sessionID,
            messageID: Identifier.ascending("message"),
            agent,
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask() {},
            extra: { surface: "panel" },
          },
        )
        expect(createSpy).toHaveBeenCalledTimes(1)
        captured = createSpy.mock.calls[0]?.[0] as { metadata?: Record<string, unknown>; source?: string; title?: string }
      },
    })
    return { metadata: captured?.metadata ?? {}, source: captured?.source, title: captured?.title, missionID }
  }

  test("control agent stamps actor=control_agent into task metadata", async () => {
    const { metadata } = await runCreateTask("control")
    expect(metadata.actor).toBe(PanelActor.enum.control_agent)
  })

  test("mission agent stamps actor=mission + source=mission + metadata.mission.{id,session_id}", async () => {
    const { metadata, source, title, missionID } = await runCreateTask("mission", {
      missionSession: true,
      source: "forged-source",
      title: "Implement settings route",
    })
    expect(metadata.actor).toBe(PanelActor.enum.mission)
    expect(source).toBe("mission")
    expect(title).toBe("Implement settings route")
    const mission = metadata.mission as { id?: string; session_id?: string } | undefined
    expect(mission?.id).toBe(missionID)
    expect(mission?.session_id).toMatch(/^ses_/)
  })

  test("mission agent passes semantic task title to EngineService", async () => {
    const { title } = await runCreateTask("mission", {
      missionSession: true,
      title: "Verify delivery evidence",
    })
    expect(title).toBe("Verify delivery evidence")
  })

  test("mission agent create_task without title is rejected before task creation", async () => {
    let error: unknown
    try {
      await runCreateTask("mission", { missionSession: true })
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("requires create_task.title")
  })

  test("mission agent in a non-mission session is rejected (no mission.id to attribute to)", async () => {
    let error: unknown
    try {
      await runCreateTask("mission") // random session, no mission metadata
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(Error)
  })

  test("non-control / non-mission agent stamps actor=panel_ui (default)", async () => {
    const { metadata, source } = await runCreateTask("gateway")
    expect(metadata.actor).toBe(PanelActor.enum.panel_ui)
    expect(source).toBe("panel")
  })

  test("client-supplied actor/mission in metadata is overridden by server-derived value", async () => {
    const { metadata } = await runCreateTask("control", {
      userMetadata: { actor: "mission", mission: { id: "forged" }, custom: "preserved" },
    })
    expect(metadata.actor).toBe(PanelActor.enum.control_agent)
    // control_agent is not the mission actor, so no server-derived mission
    // block is written; the forged client value must not survive either.
    expect(metadata.mission).toBeUndefined()
    expect(metadata.custom).toBe("preserved")
  })
})
