import { Instance } from "@/project/instance"
import { Channel } from "@/util/channel"
import { Log } from "@/util/log"

export namespace OrchestratorRunActor {
  const log = Log.create({ service: "orchestrator.run-actor" })

  type Result =
    | { ok: true; value: unknown }
    | { ok: false; error: Error }

  type Command = {
    exec: () => Promise<unknown>
    reply: Channel<Result>
  }

  type Info = {
    inbox: Channel<Command>
    pending: number
    idle?: ReturnType<typeof setTimeout>
  }

  const actors = Instance.state(
    () => {
      const data: Record<string, Info> = {}
      return data
    },
    async (current) => {
      for (const actor of Object.values(current)) {
        if (actor.idle) clearTimeout(actor.idle)
        actor.inbox.close()
      }
    },
  )

  function error(input: unknown) {
    return input instanceof Error ? input : new Error(String(input))
  }

  function scheduleClose(runID: string, actor: Info) {
    if (actor.pending > 0 || actor.idle) return
    actor.idle = setTimeout(() => {
      if (actors()[runID] !== actor || actor.pending > 0) return
      actor.inbox.close()
      delete actors()[runID]
    }, 0)
  }

  async function serve(runID: string, actor: Info) {
    for await (const command of actor.inbox) {
      if (actor.idle) {
        clearTimeout(actor.idle)
        actor.idle = undefined
      }
      const result = await command.exec()
        .then((value) => ({ ok: true, value }) as const)
        .catch((cause) => ({ ok: false, error: error(cause) }) as const)
      actor.pending = Math.max(actor.pending - 1, 0)
      command.reply.send(result)
      command.reply.close()
      scheduleClose(runID, actor)
    }
    if (actors()[runID] === actor && actor.pending === 0) {
      delete actors()[runID]
    }
  }

  function ensure(runID: string) {
    const current = actors()[runID]
    if (current) return current
    const actor: Info = {
      inbox: new Channel<Command>(),
      pending: 0,
    }
    actors()[runID] = actor
    void serve(runID, actor).catch((cause) => {
      log.error("run actor failed", { runID, cause })
      delete actors()[runID]
      actor.inbox.close()
    })
    return actor
  }

  export async function submit<T>(runID: string, exec: () => Promise<T>): Promise<T> {
    const actor = ensure(runID)
    if (actor.idle) {
      clearTimeout(actor.idle)
      actor.idle = undefined
    }
    actor.pending += 1
    const reply = new Channel<Result>()
    if (!actor.inbox.send({ exec, reply })) throw new Error(`Run actor closed: ${runID}`)
    const result = await reply.recv()
    if (!result) throw new Error(`Run actor closed: ${runID}`)
    if (!result.ok) throw result.error
    return result.value as T
  }
}
