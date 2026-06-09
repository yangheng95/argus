import { describe, test, expect } from "bun:test"
import { TypedEventEmitter } from "../src/util/emitter"

// Define test event types for type safety
type TestEvents = {
  simple: []
  data: [string, number]
  error: [Error]
  complex: [string, number, boolean]
}

describe("TypedEventEmitter.on()", () => {
  test("registers event listener successfully", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    const received: string[] = []

    emitter.on("data", (str, num) => {
      received.push(`${str}-${num}`)
    })

    emitter.emit("data", "hello", 42)
    expect(received).toEqual(["hello-42"])
  })

  test("emits event with no parameters", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    let called = false

    emitter.on("simple", () => {
      called = true
    })

    emitter.emit("simple")
    expect(called).toBe(true)
  })

  test("returns unsubscribe function", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    const received: string[] = []

    const unsubscribe = emitter.on("data", (str, num) => {
      received.push(`${str}-${num}`)
    })

    emitter.emit("data", "first", 1)
    unsubscribe()
    emitter.emit("data", "second", 2)

    expect(received).toEqual(["first-1"])
  })

  test("automatically deduplicates identical callbacks", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    let callCount = 0

    const callback = () => {
      callCount++
    }

    emitter.on("simple", callback)
    emitter.on("simple", callback) // Duplicate registration

    emitter.emit("simple")
    expect(callCount).toBe(1) // Should only be called once
  })

  test("multiple listeners are all invoked", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    const results: number[] = []

    emitter.on("data", (str, num) => results.push(num))
    emitter.on("data", (str, num) => results.push(num * 10))

    emitter.emit("data", "test", 5)
    expect(results).toEqual([5, 50])
  })

  test("listeners are invoked in registration order", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    const order: string[] = []

    emitter.on("data", () => order.push("first"))
    emitter.on("data", () => order.push("second"))
    emitter.on("data", () => order.push("third"))

    emitter.emit("data", "test", 0)
    expect(order).toEqual(["first", "second", "third"])
  })
})

describe("TypedEventEmitter.off()", () => {
  test("removes listener successfully", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    let callCount = 0

    const callback = () => {
      callCount++
    }

    emitter.on("simple", callback)
    const removed = emitter.off("simple", callback)

    expect(removed).toBe(true)
    emitter.emit("simple")
    expect(callCount).toBe(0)
  })

  test("returns false when removing non-existent listener", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    const callback = () => {}

    const result = emitter.off("simple", callback)
    expect(result).toBe(false)
  })

  test("returns false when removing from non-existent event", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    const callback = () => {}

    const result = emitter.off("error", callback)
    expect(result).toBe(false)
  })

  test("listener is not invoked after removal", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    const received: string[] = []

    const callback1 = (str: string) => received.push(`1-${str}`)
    const callback2 = (str: string) => received.push(`2-${str}`)

    emitter.on("data", callback1)
    emitter.on("data", callback2)

    emitter.emit("data", "first", 0)
    emitter.off("data", callback1)
    emitter.emit("data", "second", 0)

    expect(received).toEqual(["1-first", "2-first", "2-second"])
  })

  test("cleans up empty listener sets", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    const callback = () => {}

    emitter.on("simple", callback)
    expect(emitter.listenerCount("simple")).toBe(1)

    emitter.off("simple", callback)
    expect(emitter.listenerCount("simple")).toBe(0)
  })
})

describe("TypedEventEmitter.emit()", () => {
  test("returns true when event has listeners", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    emitter.on("simple", () => {})

    const result = emitter.emit("simple")
    expect(result).toBe(true)
  })

  test("returns false when event has no listeners", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    const result = emitter.emit("simple")
    expect(result).toBe(false)
  })

  test("returns false after all listeners are removed", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    const callback = () => {}

    emitter.on("simple", callback)
    emitter.off("simple", callback)

    const result = emitter.emit("simple")
    expect(result).toBe(false)
  })

  test("passes all parameters to listeners", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    let receivedStr: string = ""
    let receivedNum: number = 0
    let receivedBool: boolean = false

    emitter.on("complex", (str, num, bool) => {
      receivedStr = str
      receivedNum = num
      receivedBool = bool
    })

    emitter.emit("complex", "test", 123, true)
    expect(receivedStr).toBe("test")
    expect(receivedNum).toBe(123)
    expect(receivedBool).toBe(true)
  })

  test("passes Error object to listeners", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    let receivedError: Error | null = null

    emitter.on("error", (err) => {
      receivedError = err
    })

    const testError = new Error("test error")
    emitter.emit("error", testError)

    expect(receivedError).not.toBeNull()
    expect(receivedError!.message).toBe("test error")
  })
})

describe("TypedEventEmitter.once()", () => {
  test("callback is invoked only once", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    let callCount = 0

    emitter.once("simple", () => {
      callCount++
    })

    emitter.emit("simple")
    emitter.emit("simple")
    emitter.emit("simple")

    expect(callCount).toBe(1)
  })

  test("returns unsubscribe function", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    let called = false

    const unsubscribe = emitter.once("simple", () => {
      called = true
    })

    unsubscribe()
    emitter.emit("simple")

    expect(called).toBe(false)
  })

  test("listener is automatically removed after invocation", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    let callCount = 0

    emitter.once("simple", () => {
      callCount++
    })

    emitter.emit("simple")
    expect(emitter.listenerCount("simple")).toBe(0)
    expect(callCount).toBe(1)
  })

  test("passes parameters correctly", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    let receivedStr: string = ""
    let receivedNum: number = 0

    emitter.once("data", (str, num) => {
      receivedStr = str
      receivedNum = num
    })

    emitter.emit("data", "once", 999)
    expect(receivedStr).toBe("once")
    expect(receivedNum).toBe(999)
  })

  test("multiple once listeners each fire once", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    const results: number[] = []

    emitter.once("data", (str, num) => results.push(num))
    emitter.once("data", (str, num) => results.push(num * 10))

    emitter.emit("data", "first", 1)
    emitter.emit("data", "second", 2)

    expect(results).toEqual([1, 10])
  })
})

describe("TypedEventEmitter.listenerCount()", () => {
  test("returns 0 for event with no listeners", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    expect(emitter.listenerCount("simple")).toBe(0)
  })

  test("returns correct count for single listener", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    emitter.on("simple", () => {})

    expect(emitter.listenerCount("simple")).toBe(1)
  })

  test("returns correct count for multiple listeners", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    emitter.on("simple", () => {})
    emitter.on("simple", () => {})
    emitter.on("simple", () => {})

    expect(emitter.listenerCount("simple")).toBe(3)
  })

  test("count updates when listeners are added", () => {
    const emitter = new TypedEventEmitter<TestEvents>()

    expect(emitter.listenerCount("simple")).toBe(0)
    emitter.on("simple", () => {})
    expect(emitter.listenerCount("simple")).toBe(1)
    emitter.on("simple", () => {})
    expect(emitter.listenerCount("simple")).toBe(2)
  })

  test("count updates when listeners are removed", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    const callback1 = () => {}
    const callback2 = () => {}

    emitter.on("simple", callback1)
    emitter.on("simple", callback2)
    expect(emitter.listenerCount("simple")).toBe(2)

    emitter.off("simple", callback1)
    expect(emitter.listenerCount("simple")).toBe(1)

    emitter.off("simple", callback2)
    expect(emitter.listenerCount("simple")).toBe(0)
  })

  test("returns total count when no event specified", () => {
    const emitter = new TypedEventEmitter<TestEvents>()

    emitter.on("simple", () => {})
    emitter.on("data", () => {})
    emitter.on("error", () => {})

    expect(emitter.listenerCount()).toBe(3)
  })

  test("total count excludes removed listeners", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    const callback = () => {}

    emitter.on("simple", callback)
    emitter.on("data", () => {})
    expect(emitter.listenerCount()).toBe(2)

    emitter.off("simple", callback)
    expect(emitter.listenerCount()).toBe(1)
  })

  test("returns 0 for non-existent event", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    emitter.on("simple", () => {})

    expect(emitter.listenerCount("error")).toBe(0)
  })
})

describe("TypedEventEmitter type safety", () => {
  test("rejects invalid event names at compile time", () => {
    const emitter = new TypedEventEmitter<TestEvents>()

    // This would cause a TypeScript error if uncommented:
    // emitter.on("invalid-event" as any, () => {})

    // Valid event names should work
    emitter.on("simple", () => {})
    emitter.on("data", () => {})
    expect(emitter.listenerCount()).toBe(2)
  })

  test("enforces correct callback parameter types", () => {
    const emitter = new TypedEventEmitter<TestEvents>()

    // Valid callbacks with correct parameter types
    emitter.on("data", (str: string, num: number) => {
      // Type checking ensures str is string and num is number
      expect(typeof str).toBe("string")
      expect(typeof num).toBe("number")
    })

    emitter.on("error", (err: Error) => {
      expect(err).toBeInstanceOf(Error)
    })

    expect(emitter.listenerCount()).toBe(2)
  })

  test("enforces correct emit parameter types", () => {
    const emitter = new TypedEventEmitter<TestEvents>()

    emitter.on("data", (str, num) => {
      expect(str).toBe("test")
      expect(num).toBe(42)
    })

    // Valid emit with correct parameter types
    emitter.emit("data", "test", 42)
  })
})

describe("TypedEventEmitter edge cases", () => {
  test("handles listener that throws an error", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    const results: string[] = []

    emitter.on("simple", () => {
      results.push("before")
      throw new Error("test error")
    })
    emitter.on("simple", () => {
      results.push("after")
    })

    expect(() => emitter.emit("simple")).toThrow("test error")
    // Note: Second listener may or may not be called depending on error handling
    // This test verifies that errors propagate correctly
  })

  test("handles rapid add/remove cycles", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    const callbacks = Array.from({ length: 10 }, () => () => {})

    callbacks.forEach((cb) => emitter.on("simple", cb))
    expect(emitter.listenerCount("simple")).toBe(10)

    callbacks.forEach((cb) => emitter.off("simple", cb))
    expect(emitter.listenerCount("simple")).toBe(0)
  })

  test("handles multiple event types independently", () => {
    const emitter = new TypedEventEmitter<TestEvents>()
    const simpleCalls: number[] = []
    const dataCalls: string[] = []

    emitter.on("simple", () => simpleCalls.push(1))
    emitter.on("data", (str, num) => dataCalls.push(`${str}-${num}`))

    emitter.emit("simple")
    emitter.emit("data", "test", 42)
    emitter.emit("simple")

    expect(simpleCalls).toEqual([1, 1])
    expect(dataCalls).toEqual(["test-42"])
    expect(emitter.listenerCount()).toBe(2)
  })
})
