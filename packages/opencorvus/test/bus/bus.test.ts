import { describe, test, expect } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import z from "zod"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { Event } from "../../src/engine/model"
import { Instance } from "../../src/project/instance"
import { Message } from "../../src/session/message"
import { SessionEvents } from "../../src/session/events"
import { Event as ServerEvent, globalEnvelope, payload as serverEventPayload } from "../../src/server/event"
import { Workspace } from "../../src/workspace/workspace"
import { tmpdir } from "../fixture/fixture"

// Define a test event for use in tests
const TestEvent = BusEvent.define("test.event", z.object({ value: z.string() }))

const CounterEvent = BusEvent.define("test.counter", z.object({ count: z.number() }))
const NotifyDescriptorEvent = BusEvent.define("test.notify.descriptor", z.object({ value: z.string() }), {
  tier: 1,
  badge: true,
})
const NotifyResolverEvent = BusEvent.define(
  "test.notify.resolver",
  z.object({ verdict: z.enum(["accepted", "rejected"]) }),
  (payload) => (payload.verdict === "rejected" ? { tier: 1, badge: true } : { tier: 2 }),
)
const NotifyOmittedEvent = BusEvent.define("test.notify.omitted", z.object({ value: z.string() }))

describe("Bus.subscribe / Bus.publish", () => {
  test("subscriber receives published event", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const received: string[] = []

        const unsub = Bus.subscribe(TestEvent, (evt) => {
          received.push(evt.properties.value)
        })

        await Bus.publish(TestEvent, { value: "hello" })
        unsub()

        expect(received).toEqual(["hello"])
      },
    })
  })

  test("subscriber does not receive events after unsubscribing", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const received: string[] = []
        const unsub = Bus.subscribe(TestEvent, (evt) => {
          received.push(evt.properties.value)
        })

        await Bus.publish(TestEvent, { value: "first" })
        unsub()
        await Bus.publish(TestEvent, { value: "second" })

        expect(received).toEqual(["first"])
      },
    })
  })

  test("unsubscribe removes empty subscription buckets", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const before = Bus.subscriptionStats()
        const unsub = Bus.subscribe(TestEvent, () => {})
        expect(Bus.subscriptionStats()).toEqual({
          types: before.types + 1,
          callbacks: before.callbacks + 1,
        })

        unsub()

        expect(Bus.subscriptionStats()).toEqual(before)
      },
    })
  })

  test("multiple subscribers each receive the event", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const counts: number[] = []

        const unsub1 = Bus.subscribe(CounterEvent, (evt) => counts.push(evt.properties.count + 0))
        const unsub2 = Bus.subscribe(CounterEvent, (evt) => counts.push(evt.properties.count + 10))

        await Bus.publish(CounterEvent, { count: 1 })
        unsub1()
        unsub2()

        expect(counts).toContain(1)
        expect(counts).toContain(11)
      },
    })
  })

  test("synchronous subscriber failure does not stop later subscribers", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const received: string[] = []
        const unsub1 = Bus.subscribe(TestEvent, () => {
          throw new Error("first subscriber failed")
        })
        const unsub2 = Bus.subscribe(TestEvent, (evt) => {
          received.push(evt.properties.value)
        })

        try {
          await expect(Bus.publish(TestEvent, { value: "survived" })).resolves.toBeDefined()
          expect(received).toEqual(["survived"])
        } finally {
          unsub1()
          unsub2()
        }
      },
    })
  })

  test("duplicate subscribe call is ignored (same callback)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const received: string[] = []
        const handler = (evt: { type: typeof TestEvent.type; properties: { value: string } }) => {
          received.push(evt.properties.value)
        }

        const unsub1 = Bus.subscribe(TestEvent, handler)
        const unsub2 = Bus.subscribe(TestEvent, handler) // duplicate

        await Bus.publish(TestEvent, { value: "once" })
        unsub1()
        unsub2()

        // Should only be received once
        expect(received).toEqual(["once"])
      },
    })
  })
})

describe("BusEvent notification registry", () => {
  test("duplicate event type registration fails loudly instead of overwriting the registry", () => {
    expect(() => BusEvent.define(TestEvent.type, z.object({ other: z.string() }))).toThrow(/duplicate event type/i)
  })

  test("source event definitions do not register the same event type twice", () => {
    const srcRoot = path.resolve(import.meta.dir, "../../src")
    const files = collectTypeScriptFiles(srcRoot)
    const definitions = new Map<string, string[]>()

    for (const file of files) {
      const source = readFileSync(file, "utf8")
      for (const match of source.matchAll(/BusEvent\.define\(\s*["']([^"']+)["']/g)) {
        const type = match[1]!
        const list = definitions.get(type) ?? []
        list.push(path.relative(srcRoot, file).replaceAll("\\", "/"))
        definitions.set(type, list)
      }
    }

    const duplicates = [...definitions.entries()].filter(([, locations]) => locations.length > 1)
    expect(duplicates).toEqual([])
  })

  test("resolveNotify handles descriptor, payload resolver, and omitted NOOP entries", () => {
    expect(BusEvent.resolveNotify(NotifyDescriptorEvent.type, { value: "x" })).toEqual({ tier: 1, badge: true })
    expect(BusEvent.resolveNotify(NotifyResolverEvent.type, { verdict: "rejected" })).toEqual({
      tier: 1,
      badge: true,
    })
    expect(BusEvent.resolveNotify(NotifyResolverEvent.type, { verdict: "accepted" })).toEqual({ tier: 2 })
    expect(BusEvent.resolveNotify(NotifyOmittedEvent.type, { value: "x" })).toBeUndefined()
  })

  test("resolveNotify validates payloads for static descriptors, resolvers, and NOOP definitions", () => {
    expect(() => BusEvent.resolveNotify(NotifyDescriptorEvent.type, {})).toThrow()
    expect(() => BusEvent.resolveNotify(NotifyResolverEvent.type, { verdict: "maybe" })).toThrow()
    expect(() => BusEvent.resolveNotify(NotifyOmittedEvent.type, {})).toThrow()
  })

  test("server connected and heartbeat events match the advertised SSE payload schema", () => {
    const payloadSchema = BusEvent.payloads()
    expect(payloadSchema.parse(serverEventPayload(ServerEvent.Connected, {}))).toEqual({
      type: "server.connected",
      properties: {},
    })
    expect(payloadSchema.parse(serverEventPayload(ServerEvent.Heartbeat, {}))).toEqual({
      type: "server.heartbeat",
      properties: {},
    })
    expect(
      z
        .object({
          directory: z.string(),
          payload: payloadSchema,
        })
        .parse(globalEnvelope("global", ServerEvent.Heartbeat, {})),
    ).toEqual({
      directory: "global",
      payload: {
        type: "server.heartbeat",
        properties: {},
      },
    })
  })

  test("actual event annotations keep bridged tiers and global NOOPs explicit", () => {
    expect(
      BusEvent.resolveNotify(Event.InteractionResolved.type, {
        taskID: "tsk_notify_actual",
        interactionID: "int_notify_actual",
        status: "answered",
        summary: "answered",
      }),
    ).toBeUndefined()
    expect(
      BusEvent.resolveNotify(Message.Event.PartDelta.type, {
        sessionID: "ses_notify_actual",
        messageID: "msg_notify_actual",
        partID: "prt_notify_actual",
        field: "text",
        delta: "hello",
      }),
    ).toEqual({ tier: 3 })
    expect(
      BusEvent.resolveNotify(SessionEvents.Error.type, {
        error: {
          name: "UnknownError",
          data: { message: "session failed" },
        },
      }),
    ).toEqual({ tier: 1 })
    expect(() => BusEvent.resolveNotify(SessionEvents.Error.type, {})).toThrow()
    expect(BusEvent.resolveNotify(Workspace.Event.Failed.type, { message: "workspace failed" })).toBeUndefined()
  })
})

function collectTypeScriptFiles(root: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      result.push(...collectTypeScriptFiles(full))
    } else if (entry.endsWith(".ts")) {
      result.push(full)
    }
  }
  return result
}

describe("Bus.subscribeAll", () => {
  test("wildcard subscriber receives events of any type", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const types: string[] = []
        const unsub = Bus.subscribeAll((evt) => {
          types.push(evt.type)
        })

        await Bus.publish(TestEvent, { value: "x" })
        await Bus.publish(CounterEvent, { count: 0 })
        unsub()

        expect(types).toContain("test.event")
        expect(types).toContain("test.counter")
      },
    })
  })

  test("publish validates event payloads before dispatch", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const received: unknown[] = []
        const unsub = Bus.subscribe(TestEvent, (evt) => {
          received.push(evt)
        })
        try {
          await expect(Bus.publish(TestEvent as any, { value: 123 })).rejects.toThrow()
          expect(received).toEqual([])
        } finally {
          unsub()
        }
      },
    })
  })
})

describe("Bus.once", () => {
  test("once callback is called only for the first matching event", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const received: string[] = []

        Bus.once(TestEvent, (evt) => {
          received.push(evt.properties.value)
          return "done"
        })

        await Bus.publish(TestEvent, { value: "first" })
        await Bus.publish(TestEvent, { value: "second" })

        expect(received).toEqual(["first"])
      },
    })
  })

  test("once callback stays subscribed when it does not return 'done'", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const received: string[] = []

        Bus.once(TestEvent, (evt) => {
          received.push(evt.properties.value)
          return undefined // not done yet
        })

        await Bus.publish(TestEvent, { value: "first" })
        await Bus.publish(TestEvent, { value: "second" })

        expect(received).toEqual(["first", "second"])
      },
    })
  })
})
