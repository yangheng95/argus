import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { PanelTool } from "../../src/tool/panel"
import { EngineService } from "../../src/task-api"
import { Log } from "../../src/util/log"
import { derivePanelActor, PanelActor } from "../../src/panel/capability"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

/**
 * Spec: gateway-master-supervisor-2026-05-26.md §2.4.
 *
 * `panel.create_task` must record the server-derived `actor` (the LLM
 * agent or external client that drove the call) in the new task's
 * metadata. Auditing and future authorization branch off this field —
 * never off the free-text `source` field, which is reserved for
 * business-meaningful labels.
 */
describe("derivePanelActor", () => {
  test("control agent maps to control_agent", () => {
    expect(derivePanelActor("control")).toBe(PanelActor.enum.control_agent)
  })

  test("gateway-master agent maps to gateway_master", () => {
    expect(derivePanelActor("gateway-master")).toBe(PanelActor.enum.gateway_master)
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

  async function runCreateTask(agent: string, userMetadata?: Record<string, unknown>) {
    await using tmp = await tmpdir({ git: true })
    let captured: { metadata?: Record<string, unknown> } | undefined
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const stubTaskID = Identifier.ascending("task")
        const createSpy = spyOn(EngineService, "createTask").mockResolvedValue(stubTaskID)
        const tool = await PanelTool.init()
        await tool.execute(
          {
            action: "create_task",
            request: "do thing",
            allow_create: true,
            queue: false,
            ...(userMetadata ? { metadata: userMetadata } : {}),
          },
          {
            sessionID: Identifier.ascending("session"),
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
        captured = createSpy.mock.calls[0]?.[0] as { metadata?: Record<string, unknown> }
      },
    })
    return captured?.metadata ?? {}
  }

  test("control agent stamps actor=control_agent into task metadata", async () => {
    const metadata = await runCreateTask("control")
    expect(metadata.actor).toBe(PanelActor.enum.control_agent)
  })

  test("gateway-master agent stamps actor=gateway_master into task metadata", async () => {
    const metadata = await runCreateTask("gateway-master")
    expect(metadata.actor).toBe(PanelActor.enum.gateway_master)
  })

  test("non-control / non-master agent stamps actor=panel_ui (default)", async () => {
    const metadata = await runCreateTask("gateway")
    expect(metadata.actor).toBe(PanelActor.enum.panel_ui)
  })

  test("client-supplied actor in metadata is overridden by server-derived value", async () => {
    const metadata = await runCreateTask("control", { actor: "gateway_master", custom: "preserved" })
    expect(metadata.actor).toBe(PanelActor.enum.control_agent)
    expect(metadata.custom).toBe("preserved")
  })
})
