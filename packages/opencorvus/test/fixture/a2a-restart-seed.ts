async function mark(activityPath: string, stage: string) {
  await Bun.write(activityPath, JSON.stringify({ pid: process.pid, stage, time: Date.now() }))
}

async function main() {
  const [home, directory, outputPath, activityPath] = process.argv.slice(2)
  const holdAfterComplete = process.argv.includes("--hold-after-complete")
  if (!home || !directory || !outputPath || !activityPath) {
    throw new Error("Usage: a2a-restart-seed <opencorvus-home> <project-dir> <output-json> <activity-json>")
  }

  process.env.OPENCORVUS_HOME = home
  await mark(activityPath, "env")

  const { Log } = await import("../../src/util/log")
  await Log.init({ print: false })
  const { Identifier } = await import("../../src/id/id")
  const { Database } = await import("../../src/storage/db")
  const { EngineTaskTable } = await import("../../src/engine/engine.sql")
  const { Instance } = await import("../../src/project/instance")
  const { Session } = await import("../../src/session")
  const ownership = await import("../../src/engine/tool-ownership")
  const queue = await import("../../src/engine/queue")
  const requestTool = await import("../../src/tool/request-orchestrator-decision")
  const agentCoordination = await import("../../src/engine/agent-coordination")
  const lease = await import("../../src/engine/lease")
  await mark(activityPath, "imports")

  try {
    await Instance.provide({
      directory,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({
          kind: "root",
          title: "A2A restart root",
          metadata: { configOverlay: { model: "openai/gpt-5.5" } },
        })
        const worker = await Session.create({
          kind: "assistant",
          parentID: root.id,
          title: "A2A restart worker",
        })
        await mark(activityPath, "sessions")

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "A2A restart task",
              request: "A worker asks the task orchestrator before the original host process exits.",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const ownershipPayload = ownership.createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: root.id,
          orchestratorMessageID: Identifier.ascending("message"),
          toolPartID: Identifier.ascending("part"),
          toolCallID: Identifier.ascending("call"),
          childSessionID: worker.id,
          toolName: "build",
          scope: "task",
          now,
        })
        ownership.insertOrchestratorToolOwnershipArtifact({
          taskID,
          payload: ownershipPayload,
          now,
        })
        await mark(activityPath, "ownership")

        const requestToolResult = await requestTool.executeRequestOrchestratorDecision(
          {
            summary: "Need continuation decision after restart",
            details: "The worker has reached a scheduling boundary before the original host process exits.",
            blocking: true,
            requested_decision: "continue this same worker session",
            evidence_refs: ["artifact:a2a-restart-e2e"],
            severity: "blocked",
          },
          {
            sessionID: worker.id,
            messageID: Identifier.ascending("message"),
            callID: Identifier.ascending("call"),
            agent: "coding",
            abort: new AbortController().signal,
            extra: { taskID },
            messages: [],
            metadata: () => {},
            ask: async () => {},
          },
          queue.dispatchTaskLoop,
        )
        const requestOutput = JSON.parse(requestToolResult.output) as {
          request_id: string
          orchestrator_wake: string
        }
        if (requestOutput.orchestrator_wake !== "queued") {
          throw new Error(`Expected queued orchestrator wake, got ${requestOutput.orchestrator_wake}`)
        }
        const request = agentCoordination.findAgentCoordinationRequest({
          taskID,
          requestID: requestOutput.request_id,
        })
        if (request?.payload.status !== "pending") {
          throw new Error(`Expected pending coordination request, got ${request?.payload.status ?? "missing"}`)
        }
        const stats = queue.queuedTaskEventStats(taskID)
        if (stats.tasks !== 1 || stats.events !== 1) {
          throw new Error(`Expected one queued wake, got tasks=${stats.tasks} events=${stats.events}`)
        }
        await mark(activityPath, "queued")

        await Bun.write(
          outputPath,
          JSON.stringify({
            processID: process.pid,
            owner: lease.processOwner(),
            taskID,
            rootID: root.id,
            workerID: worker.id,
            requestID: requestOutput.request_id,
            ownershipID: ownershipPayload.ownership_id,
          }),
        )
        await mark(activityPath, "complete")
        if (holdAfterComplete) {
          await new Promise(() => {})
        }
      },
    })
  } finally {
    await Instance.disposeAll().catch(() => undefined)
    Database.close()
  }
}

main().catch(async (error) => {
  const activityPath = process.argv[5]
  if (activityPath) {
    await mark(activityPath, "failed").catch(() => undefined)
  }
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
