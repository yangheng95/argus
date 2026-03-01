import { describe, test, expect } from "bun:test"
import z from "zod"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// Define a test event for use in tests
const TestEvent = BusEvent.define(
  "test.event",
  z.object({ value: z.string() }),
)

const CounterEvent = BusEvent.define(
  "test.counter",
  z.object({ count: z.number() }),
)

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
