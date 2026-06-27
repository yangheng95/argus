import { expect, test } from "bun:test"
import path from "path"
import { Filesystem } from "../../src/util/filesystem"
import { withLocalHexinProvider } from "../../script/models-snapshot"

const repo = path.resolve(import.meta.dir, "../../../..")
const packageRoot = path.join(repo, "packages", "opencorvus")
const snapshotPath = path.join(packageRoot, "src", "provider", "models-snapshot.ts")

test("models snapshot is a checked-in offline provider source", async () => {
  const ignore = await Filesystem.readText(path.join(packageRoot, ".gitignore"))
  expect(ignore).not.toContain("src/provider/models-snapshot.ts")

  const snapshot = await import("../../src/provider/models-snapshot")
  expect(Object.keys(snapshot.snapshot).length).toBeGreaterThan(0)
})

test("models snapshot includes local hexin provider models required by mission profiles", async () => {
  const { snapshot } = await import("../../src/provider/models-snapshot")

  expect(snapshot.hexin).toBeDefined()
  expect(snapshot.hexin.api).toBe("https://aimemodeldev.myhexin.com/litellm/v1")
  expect(snapshot.hexin.models["gpt-5.5"]).toMatchObject({
    id: "gpt-5.5",
    tool_call: true,
    modalities: {
      input: ["text", "image"],
      output: ["text"],
    },
  })
  expect(snapshot.hexin.models["kimi-k2.6"]).toMatchObject({
    reasoning: true,
    temperature: false,
    interleaved: { field: "reasoning_content" },
  })
  expect(snapshot.hexin.models["openai/glm-5.1"]).toMatchObject({
    reasoning: true,
    interleaved: { field: "reasoning_content" },
  })
})

test("snapshot generator injects local hexin provider into registry data", () => {
  const generated = withLocalHexinProvider({
    example: {
      id: "example",
      env: ["EXAMPLE_API_KEY"],
      name: "Example",
      models: {},
    },
  })

  expect(generated.hexin.models["gpt-5.5"].id).toBe("gpt-5.5")
  expect(generated.hexin.models["kimi-k2.7-code"].interleaved).toEqual({ field: "reasoning_content" })
  expect(generated.hexin.models["claude-sonnet-4-6-v2"]).toBeUndefined()
  expect(generated.hexin.models["cy-claude-sonnet-4-6-v2"].limit).toEqual({
    context: 1_000_000,
    input: 1_000_000,
    output: 64_000,
  })
})

test("build scripts can reuse the checked-in snapshot without registry fetch", async () => {
  for (const script of ["build.ts", "build.local.ts"]) {
    const text = await Filesystem.readText(path.join(packageRoot, "script", script))
    expect(text).toContain("resolveModelsSnapshotData")
    expect(text).toContain("modelsSnapshotPath")
  }

  const helper = await Filesystem.readText(path.join(packageRoot, "script", "models-snapshot.ts"))
  expect(helper).toContain("OPENCORVUS_DISABLE_MODELS_FETCH")
  expect(helper).toContain("readExistingModelsSnapshot")
  expect(helper).toContain("withLocalHexinProvider")
})
