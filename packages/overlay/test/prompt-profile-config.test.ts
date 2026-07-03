import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"

const configServiceSource = readFileSync(join(import.meta.dir, "../src/services/config.ts"), "utf8")

describe("prompt profile config helpers", () => {
  test("config service no longer exposes custom prompt-profile writers", () => {
    expect(configServiceSource).not.toContain("createPromptProfileID")
    expect(configServiceSource).not.toContain("upsertPromptProfileConfig")
    expect(configServiceSource).not.toContain("deletePromptProfileConfig")
    expect(configServiceSource).not.toContain("parsePromptProfileImportPayload")
    expect(configServiceSource).not.toContain("importPromptProfileConfig")
    expect(configServiceSource).not.toContain("importPromptProfiles")
    expect(configServiceSource).not.toContain("prompt_profile.profiles")
  })

  test("config service keeps prompt-profile writes active-only", () => {
    expect(configServiceSource).toContain("setProjectPromptProfileActive")
    expect(configServiceSource).toContain("setSessionPromptProfileActive")
    expect(configServiceSource).toContain("prompt_profile: { active: profileID }")
    expect(configServiceSource).not.toContain("profiles,")
  })
})
