// Direct-reply error taxonomy regression test.
//
// Until 069c22f80 added validateSessionRuntimeContractForContinuation to
// appendDirectAgentSessionReply, every refusal in this path threw a plain
// `Error` and surfaced as HTTP 500 — indistinguishable from a real server
// crash. The overlay's AgentSessionReplyBox could only show "500 error",
// even for situations like "your worker session's runtime contract is
// gone because the server restarted" which is a perfectly recoverable
// 4xx/410 situation.
//
// This test pins down the mapping so a future refactor cannot collapse
// these into 500 again without surfacing as a failed assertion.

import { afterEach, describe, expect, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { WorkerTurnDescriptor } from "../../src/agent/worker-turn-descriptor"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function installArchitectRuntimeContract(
  sessionID: string,
  model: { providerID: string; modelID: string } = { providerID: "overlay", modelID: "architect" },
) {
  const descriptor = WorkerTurnDescriptor.create({
    sessionID,
    payload: {
      agent: "architect",
      roleContractID: "architect",
      model,
      prompt: { systemMode: "complete", rawSystemPrompt: false },
      tools: { enabled: [] },
      output: { format: "text", resultMode: "reply" },
      workflow: { sessionKind: "architect" },
    },
  })
  SessionPrompt.setSessionRuntimeContract(sessionID, {
    identity: {
      sessionID,
      agentKind: "architect",
      contractKind: "stage-attempt",
      workerTurnDescriptorID: descriptor.id,
      workerTurnDescriptorHash: descriptor.hash,
      installedAt: Date.now(),
    },
    tools: {},
    structuredOutputGuard: () => undefined,
  })
}

describe("AgentSessionReplyBox error taxonomy", () => {
  afterEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("kind not in DIRECT_REPLY_AGENT_KINDS → 400 InvalidReplyTargetKindError", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        // "executor" is not in DIRECT_REPLY_AGENT_KINDS — the route should
        // refuse with a structured 400, not 500.
        const executor = await Session.create({
          kind: "executor",
          parentID: root.id,
          title: "executor",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "kind reject",
              request: "kind reject",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/session/${executor.id}/reply`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ message: "ignored" }),
        })

        expect(response.status).toBe(400)
        const body = (await response.json()) as { name?: string; data?: { kind?: string; sessionID?: string } }
        expect(body.name).toBe("InvalidReplyTargetKindError")
        expect(body.data?.kind).toBe("executor")
        expect(body.data?.sessionID).toBe(executor.id)
      },
    })
  })

  test("build kind is rejected at the route preflight (not appendDirectAgentSessionReply)", async () => {
    // "build" is not in DIRECT_REPLY_AGENT_KINDS so the kind preflight
    // in appendDirectAgentSessionReply -> resolveDirectReplyTarget
    // refuses with InvalidReplyTargetKindError before the route ever
    // reaches the session.kind === "build" half of the
    // BuildSessionDirectReplyError check. This test pins that ordering
    // so a future refactor doesn't reintroduce a duplicate refusal path
    // (rule 8). The DIFFERENT case — session.kind !== "build" but
    // envelope.agent === "build" — has its own test below because that
    // IS the path BuildSessionDirectReplyError actually defends.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const build = await Session.create({
          kind: "build",
          parentID: root.id,
          title: "build",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "build reject",
              request: "build reject",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/session/${build.id}/reply`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ message: "ignored" }),
        })

        expect(response.status).toBe(400)
        const body = (await response.json()) as { name?: string; data?: { kind?: string } }
        expect(body.name).toBe("InvalidReplyTargetKindError")
        expect(body.data?.kind).toBe("build")
      },
    })
  })

  test("non-build session with envelope.agent === 'build' → 400 BuildSessionDirectReplyError", async () => {
    // This is the hybrid case BuildSessionDirectReplyError exists for:
    // the session.kind passes the route preflight (e.g. requirements)
    // but the last user envelope carries agent: "build", meaning the
    // next loop turn would `Agent.get("build")` and wake the build
    // agent's tools/system/terminal contract on a non-build session.
    // That bypasses the build retry lifecycle — refuse early. codex
    // review 2026-05-26 flagged that the previous version of this test
    // never actually exercised this error class.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const architect = await Session.create({
          kind: "architect",
          parentID: root.id,
          title: "architect with build-tagged envelope",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "hybrid build envelope",
              request: "hybrid build envelope",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: architect.id,
          role: "user",
          time: { created: now + 1 },
          // This is the misconfiguration the check defends against.
          agent: "build",
          model: { providerID: "test-provider", modelID: "test-model" },
        })

        const response = await app.request(`/task/${taskID}/session/${architect.id}/reply`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ message: "ignored" }),
        })

        expect(response.status).toBe(400)
        const body = (await response.json()) as {
          name?: string
          data?: { sessionID?: string; sessionKind?: string; envelopeAgent?: string }
        }
        expect(body.name).toBe("BuildSessionDirectReplyError")
        expect(body.data?.sessionID).toBe(architect.id)
        // codex round 2 minor: overlay needs structured fields to pick
        // the hybrid-specific UX copy instead of the generic
        // kind_not_allowed message.
        expect(body.data?.sessionKind).toBe("architect")
        expect(body.data?.envelopeAgent).toBe("build")
      },
    })
  })

  test("session with no prior user envelope → 409 ReplyTargetEnvelopeMissingError", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const evaluator = await Session.create({
          kind: "evaluator",
          parentID: root.id,
          title: "evaluator",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "envelope missing",
              request: "envelope missing",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/session/${evaluator.id}/reply`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ message: "no envelope yet" }),
        })

        expect(response.status).toBe(409)
        const body = (await response.json()) as { name?: string; data?: { sessionID?: string } }
        expect(body.name).toBe("ReplyTargetEnvelopeMissingError")
        expect(body.data?.sessionID).toBe(evaluator.id)
      },
    })
  })

  test("worker kind with no runtime contract → 410 SessionRuntimeContractMissingError", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        // architect is in runtimeContractRequiredAgentKinds AND in
        // DIRECT_REPLY_AGENT_KINDS, so this is exactly the failure mode
        // a user sees after the opencorvus process restarts: the worker
        // session row survives, the in-memory contract is gone, and the
        // reply route must return 410 (not 500).
        const architect = await Session.create({
          kind: "architect",
          parentID: root.id,
          title: "architect",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "contract missing",
              request: "contract missing",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: architect.id,
          role: "user",
          time: { created: now + 1 },
          agent: "architect",
          model: { providerID: "test-provider", modelID: "test-model" },
        })

        const response = await app.request(`/task/${taskID}/session/${architect.id}/reply`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ message: "are you still there?" }),
        })

        expect(response.status).toBe(410)
        const body = (await response.json()) as {
          name?: string
          data?: { sessionID?: string; reason?: string; agentKind?: string }
        }
        expect(body.name).toBe("SessionRuntimeContractMissingError")
        expect(body.data?.sessionID).toBe(architect.id)
        expect(body.data?.reason).toBe("missing")
        expect(body.data?.agentKind).toBe("architect")
      },
    })
  })

  test("worker kind with contract but no model config → 400 MissingModelConfigError (not 500)", async () => {
    // codex review 2026-05-26: when the contract validator passes
    // (contract installed) but resolveAgentModelRef can't find a model
    // for the agent, the throw used to fall through onError's default
    // arm and surface as 500 — indistinguishable from a real server
    // crash, even though "set agent.X.model in opencorvus.jsonc" is a
    // user-fixable config error. server.ts maps it to 400 explicitly.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const architect = await Session.create({
          kind: "architect",
          parentID: root.id,
          title: "architect",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "model missing",
              request: "model missing",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: architect.id,
          role: "user",
          time: { created: now + 1 },
          agent: "architect",
          model: { providerID: "test-provider", modelID: "test-model" },
        })

        // Contract installed → validator passes → resolveAgentModelRef
        // is the next step. No overlay config means architect has no
        // resolvable model.
        installArchitectRuntimeContract(architect.id)

        const response = await app.request(`/task/${taskID}/session/${architect.id}/reply`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ message: "continue" }),
        })

        expect(response.status).toBe(400)
        const body = (await response.json()) as { name?: string; data?: { agent?: string } }
        expect(body.name).toBe("MissingModelConfigError")
        expect(body.data?.agent).toBe("architect")
      },
    })
  })

  test("worker kind WITH runtime contract → 202 (regression guard against over-rejecting)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        // Without an overlay model the post-contract resolveAgentModelRef
        // throws MissingModelConfigError — the test's intent is to verify
        // a healthy session accepts a reply, not to exercise model
        // resolution, so wire a trivial overlay.
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: {
            model: "overlay/default",
            agent: {
              architect: { model: "overlay/architect" },
            },
          },
        })
        const architect = await Session.create({
          kind: "architect",
          parentID: root.id,
          title: "architect",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "contract present",
              request: "contract present",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: architect.id,
          role: "user",
          time: { created: now + 1 },
          agent: "architect",
          model: { providerID: "test-provider", modelID: "test-model" },
        })

        installArchitectRuntimeContract(architect.id, { providerID: "overlay", modelID: "architect" })

        const response = await app.request(`/task/${taskID}/session/${architect.id}/reply`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ message: "continue" }),
        })

        expect(response.status).toBe(202)
      },
    })
  })

  test("worker kind with contract but no descriptor -> 410 before persisting reply", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const architect = await Session.create({
          kind: "architect",
          parentID: root.id,
          title: "architect",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "descriptor missing",
              request: "descriptor missing",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: architect.id,
          role: "user",
          time: { created: now + 1 },
          agent: "architect",
          model: { providerID: "test-provider", modelID: "test-model" },
        })

        SessionPrompt.setSessionRuntimeContract(architect.id, {
          identity: {
            sessionID: architect.id,
            agentKind: "architect",
            contractKind: "stage-attempt",
            installedAt: Date.now(),
          },
          tools: {},
          structuredOutputGuard: () => undefined,
        })

        const response = await app.request(`/task/${taskID}/session/${architect.id}/reply`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({ message: "continue" }),
        })

        expect(response.status).toBe(410)
        const body = (await response.json()) as { name?: string; data?: { agentKind?: string } }
        expect(body.name).toBe("SessionRuntimeContractMissingError")
        expect(body.data?.agentKind).toBe("architect")
        const messages = await Session.messages({ sessionID: architect.id })
        expect(messages.filter((message) => message.info.role === "user")).toHaveLength(1)
      },
    })
  })
})
