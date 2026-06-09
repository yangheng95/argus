import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { applyBundledEnv } from "../src/bundled-env"

const temp: string[] = []
const vars = [
  "OPENCORVUS_CHANNEL_BUNDLED_ENV_FILE",
  "OPENCORVUS_CHANNEL_BUNDLED_STATE_FILE",
  "OPENCORVUS_CHANNEL_BUNDLED_TTL_HOURS",
  "BUNDLE_TOKEN",
  "BUNDLE_REGION",
  "BUNDLE_ONLY",
]

beforeEach(() => {
  for (const key of vars) {
    delete process.env[key]
  }
})

afterEach(async () => {
  for (const key of vars) {
    delete process.env[key]
  }
  while (temp.length > 0) {
    const dir = temp.pop()!
    await rm(dir, { recursive: true, force: true })
  }
})

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "channel-bundle-"))
  temp.push(dir)
  const file = path.join(dir, "bundle.env")
  const state = path.join(dir, "state", "bundle.json")
  process.env.OPENCORVUS_CHANNEL_BUNDLED_ENV_FILE = file
  process.env.OPENCORVUS_CHANNEL_BUNDLED_STATE_FILE = state
  return { file, state }
}

describe("bundled env", () => {
  test("applies bundled env and records first use", async () => {
    const data = await fixture()
    await writeFile(data.file, "BUNDLE_TOKEN=trial-token\nBUNDLE_REGION=us\n")
    const now = Date.parse("2026-03-03T08:00:00.000Z")

    const result = await applyBundledEnv(now)

    expect(result.enabled).toBe(true)
    expect(result.expired).toBe(false)
    expect(result.applied).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.firstUsedAt).toBe("2026-03-03T08:00:00.000Z")
    expect(result.expireAt).toBe("2026-03-04T08:00:00.000Z")
    expect(process.env.BUNDLE_TOKEN).toBe("trial-token")
    expect(process.env.BUNDLE_REGION).toBe("us")

    const state = JSON.parse(await readFile(data.state, "utf-8")) as { first_used_at: number }
    expect(state.first_used_at).toBe(now)
  })

  test("keeps user env as higher priority than bundled env", async () => {
    const data = await fixture()
    await writeFile(data.file, "BUNDLE_TOKEN=trial-token\nBUNDLE_ONLY=from-bundle\n")
    process.env.BUNDLE_TOKEN = "user-token"

    const result = await applyBundledEnv(Date.parse("2026-03-03T08:00:00.000Z"))

    expect(result.enabled).toBe(true)
    expect(result.applied).toBe(1)
    expect(result.skipped).toBe(1)
    expect(process.env.BUNDLE_TOKEN).toBe("user-token")
    expect(process.env.BUNDLE_ONLY).toBe("from-bundle")
  })

  test("stops applying bundled env after 24h from first use", async () => {
    const data = await fixture()
    await writeFile(data.file, "BUNDLE_TOKEN=trial-token\n")
    const first = Date.parse("2026-03-03T08:00:00.000Z")
    await mkdir(path.dirname(data.state), { recursive: true })
    await writeFile(data.state, JSON.stringify({ first_used_at: first }))

    const result = await applyBundledEnv(Date.parse("2026-03-04T08:00:00.001Z"))

    expect(result.enabled).toBe(false)
    expect(result.expired).toBe(true)
    expect(result.reason).toBe("expired")
    expect(result.applied).toBe(0)
    expect(process.env.BUNDLE_TOKEN).toBeUndefined()
  })

  test("still allows manual reconfiguration after bundled env expires", async () => {
    const data = await fixture()
    await writeFile(data.file, "BUNDLE_TOKEN=trial-token\nBUNDLE_ONLY=from-bundle\n")
    const first = Date.parse("2026-03-03T08:00:00.000Z")
    await mkdir(path.dirname(data.state), { recursive: true })
    await writeFile(data.state, JSON.stringify({ first_used_at: first }))
    process.env.BUNDLE_TOKEN = "manual-user-token"

    const result = await applyBundledEnv(Date.parse("2026-03-04T08:00:00.001Z"))

    expect(result.expired).toBe(true)
    expect(process.env.BUNDLE_TOKEN).toBe("manual-user-token")
    expect(process.env.BUNDLE_ONLY).toBeUndefined()
  })
})
