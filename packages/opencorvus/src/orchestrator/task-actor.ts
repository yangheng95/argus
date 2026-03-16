import { Instance } from "@/project/instance"
import { Channel } from "@/util/channel"
import { Log } from "@/util/log"

export namespace OrchestratorTaskActor {
  const log = Log.create({ service: "orchestrator.task-actor" })

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

  function scheduleClose(key: string, actor: Info) {
    if (actor.pending > 0 || actor.idle) return
    actor.idle = setTimeout(() => {
      if (actors()[key] !== actor || actor.pending > 0) return
      actor.inbox.close()
      delete actors()[key]
    }, 0)
  }

  async function serve(key: string, actor: Info) {
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
      scheduleClose(key, actor)
    }
    if (actors()[key] === actor && actor.pending === 0) {
      delete actors()[key]
    }
  }

  function ensure(key: string) {
    const current = actors()[key]
    if (current) return current
    const actor: Info = {
      inbox: new Channel<Command>(),
      pending: 0,
    }
    actors()[key] = actor
    void serve(key, actor).catch((cause) => {
      log.error("task actor failed", { key, cause })
      delete actors()[key]
      actor.inbox.close()
    })
    return actor
  }

  export async function submit<T>(key: string, exec: () => Promise<T>): Promise<T> {
    const actor = ensure(key)
    if (actor.idle) {
      clearTimeout(actor.idle)
      actor.idle = undefined
    }
    actor.pending += 1
    const reply = new Channel<Result>()
    if (!actor.inbox.send({ exec, reply })) throw new Error(`Task actor closed: ${key}`)
    const result = await reply.recv()
    if (!result) throw new Error(`Task actor closed: ${key}`)
    if (!result.ok) throw result.error
    return result.value as T
  }
}
