import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Scheduler } from "../src/scheduler"
import { Instance } from "../src/project/instance"
import { tmpdir } from "./fixture/fixture"

describe("Scheduler.register", () => {
  const hour = 60 * 60 * 1000

  test("defaults to instance scope per directory", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })
    const runs = { count: 0 }
    const id = "scheduler.instance." + Math.random().toString(36).slice(2)
    const task = {
      id,
      interval: hour,
      run: async () => {
        runs.count += 1
      },
    }

    await Instance.provide({
      directory: one.path,
      fn: async () => {
        Scheduler.register(task)
        await Instance.dispose()
      },
    })
    expect(runs.count).toBe(1)

    await Instance.provide({
      directory: two.path,
      fn: async () => {
        Scheduler.register(task)
        await Instance.dispose()
      },
    })
    expect(runs.count).toBe(2)
  })

  test("global scope runs once across instances", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })
    const runs = { count: 0 }
    const id = "scheduler.global." + Math.random().toString(36).slice(2)
    const task = {
      id,
      interval: hour,
      run: async () => {
        runs.count += 1
      },
      scope: "global" as const,
    }

    await Instance.provide({
      directory: one.path,
      fn: async () => {
        Scheduler.register(task)
        await Instance.dispose()
      },
    })
    expect(runs.count).toBe(1)

    await Instance.provide({
      directory: two.path,
      fn: async () => {
        Scheduler.register(task)
        await Instance.dispose()
      },
    })
    expect(runs.count).toBe(1)
    await Scheduler.disposeGlobal()
  })

  test("instance disposal waits for an active instance-scoped tick", async () => {
    await using project = await tmpdir({ git: true })
    let release!: () => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const complete = new Promise<void>((resolve) => {
      release = resolve
    })
    const id = "scheduler.instance.active." + Math.random().toString(36).slice(2)

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        Scheduler.register({
          id,
          interval: hour,
          run: async () => {
            started()
            await complete
          },
        })
        await ready
        let finished = false
        const disposal = Instance.dispose().then(() => {
          finished = true
        })
        await Promise.resolve()

        expect(finished).toBe(false)
        release()
        await disposal
        expect(finished).toBe(true)
      },
    })
  })

  test("global disposal waits for an active global tick and clears the registration", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })
    let release!: () => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const complete = new Promise<void>((resolve) => {
      release = resolve
    })
    const id = "scheduler.global.active." + Math.random().toString(36).slice(2)
    const runs = { count: 0 }

    await Instance.provide({
      directory: one.path,
      fn: async () => {
        Scheduler.register({
          id,
          interval: hour,
          scope: "global",
          run: async () => {
            runs.count += 1
            started()
            await complete
          },
        })
        await ready
      },
    })
    let finished = false
    const disposal = Scheduler.disposeGlobal().then(() => {
      finished = true
    })
    await Promise.resolve()

    expect(finished).toBe(false)
    release()
    await disposal
    expect(finished).toBe(true)
    expect(runs.count).toBe(1)

    await Instance.provide({
      directory: two.path,
      fn: async () => {
        Scheduler.register({
          id,
          interval: hour,
          scope: "global",
          run: async () => {
            runs.count += 1
          },
        })
      },
    })
    await Scheduler.disposeGlobal()
    expect(runs.count).toBe(2)
  })

  test("successful scheduler ticks are debug logs only", () => {
    const source = readFileSync(join(import.meta.dir, "../src/scheduler/index.ts"), "utf8")

    expect(source).toContain('log.debug("run", { id: task.id })')
    expect(source).not.toContain('log.info("run", { id: task.id })')
    expect(source).toContain('log.error("run failed", { id: task.id, error })')
  })
})
