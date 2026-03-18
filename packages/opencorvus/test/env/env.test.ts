import { describe, test, expect } from "bun:test"
import { Env } from "../../src/env"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function sampleEnvEntry() {
  return Object.entries(process.env).find(([key, value]) => key.length > 0 && typeof value === "string")
}

describe("Env.get", () => {
  test("returns process.env value by default", async () => {
    const entry = sampleEnvEntry()
    expect(entry).toBeDefined()
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const [key, value] = entry!
        expect(Env.get(key)).toBe(value)
      },
    })
  })

  test("returns undefined for unknown key", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const val = Env.get("__OPENLENS_TEST_NONEXISTENT_KEY__")
        expect(val).toBeUndefined()
      },
    })
  })
})

describe("Env.set / Env.get", () => {
  test("set and retrieve a value within the same instance", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.set("__OPENLENS_TEST_KEY__", "hello")
        expect(Env.get("__OPENLENS_TEST_KEY__")).toBe("hello")
      },
    })
  })

  test("overwrites an existing value", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.set("__OPENLENS_TEST_KEY__", "first")
        Env.set("__OPENLENS_TEST_KEY__", "second")
        expect(Env.get("__OPENLENS_TEST_KEY__")).toBe("second")
      },
    })
  })
})

describe("Env.remove", () => {
  test("removes a previously set key", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.set("__OPENLENS_REMOVE_KEY__", "present")
        Env.remove("__OPENLENS_REMOVE_KEY__")
        expect(Env.get("__OPENLENS_REMOVE_KEY__")).toBeUndefined()
      },
    })
  })

  test("no-op when removing a non-existent key", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Should not throw
        expect(() => Env.remove("__OPENLENS_NONEXISTENT__")).not.toThrow()
      },
    })
  })
})

describe("Env.all", () => {
  test("returns an object containing set variables", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.set("__OPENLENS_ALL_KEY__", "value123")
        const all = Env.all()
        expect(all["__OPENLENS_ALL_KEY__"]).toBe("value123")
      },
    })
  })

  test("returns a snapshot that includes process.env variables", async () => {
    const entry = sampleEnvEntry()
    expect(entry).toBeDefined()
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const all = Env.all()
        const [key, value] = entry!
        expect(all[key]).toBe(value)
      },
    })
  })
})

describe("Env — instance isolation", () => {
  test("env changes in one instance don't affect another", async () => {
    await using tmp1 = await tmpdir()
    await using tmp2 = await tmpdir()

    await Instance.provide({
      directory: tmp1.path,
      fn: async () => {
        Env.set("__OPENLENS_ISOLATION_KEY__", "instance-one")
      },
    })

    await Instance.provide({
      directory: tmp2.path,
      fn: async () => {
        // Second instance should not see the value set in the first
        expect(Env.get("__OPENLENS_ISOLATION_KEY__")).toBeUndefined()
      },
    })
  })
})
