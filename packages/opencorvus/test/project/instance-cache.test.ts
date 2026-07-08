import { afterEach, expect, test as baseTest } from "bun:test"
import { $ } from "bun"
import fs from "node:fs/promises"
import path from "node:path"
import { Config } from "../../src/config/config"
import { payloadPackageSources } from "../../src/expert-squad/payload"
import { ExpertSquadRegistry } from "../../src/expert-squad/registry"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Worktree } from "../../src/worktree"
import { projectExpertSquadFiles, writeProjectExpertSquadPackage } from "../fixture/expert-squad"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

function test(name: string, run: (activity: (step: string) => void) => Promise<void>) {
  baseTest.serial(name, { timeout: 0 }, async () => {
    await withInstanceCacheInactivityTimeout(name, 20_000, run)
  })
}

async function withInstanceCacheInactivityTimeout<T>(
  label: string,
  inactivityTimeoutMilliseconds: number,
  run: (activity: (step: string) => void) => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastActivity = "start"
  return await new Promise<T>((resolve, reject) => {
    const reset = (step: string) => {
      lastActivity = step
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        reject(new Error(`${label}: inactive for ${inactivityTimeoutMilliseconds}ms after ${lastActivity}`))
      }, inactivityTimeoutMilliseconds)
    }
    reset(lastActivity)
    run(reset)
      .then(resolve, reject)
      .finally(() => {
        if (timer) clearTimeout(timer)
      })
  })
}

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

test("releases expert-squad payload packages during project bootstrap without changing active profile", async (activity) => {
  await using tmp = await tmpdir({ git: true })
  activity("created temporary project")
  const configFile = path.join(tmp.path, "opencorvus.json")
  const config = {
    prompt_profile: {
      active: "opentest",
    },
  }
  await fs.writeFile(configFile, JSON.stringify(config, null, 2))
  activity("wrote project config")

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      activity("entered provided instance")
      const packages = await ExpertSquadRegistry.discover(tmp.path)
      expect(packages.map((item) => `${item.namespace}/${item.id}`)).toEqual(
        payloadPackageSources.map((source) => `${source.namespace}/${source.id}`),
      )
      for (const source of payloadPackageSources) {
        const targetRoot = path.join(tmp.path, ".opencorvus", "expert-squads", source.namespace, source.id)
        await expect(ExpertSquadRegistry.loadPackage(targetRoot)).resolves.toMatchObject({
          namespace: source.namespace,
          id: source.id,
        })
      }
      expect((await Config.get()).prompt_profile.active).toBe("opentest")
    },
  })
  activity("instance provide completed")

  const storedConfig = JSON.parse(await fs.readFile(configFile, "utf8"))
  expect(storedConfig.prompt_profile).toEqual(config.prompt_profile)
  expect(storedConfig).not.toHaveProperty("agent")
})

test("project bootstrap skips an existing same-id expert-squad package in another namespace", async (activity) => {
  await using tmp = await tmpdir()
  activity("created temporary directory project")
  const existingRoot = await writeProjectExpertSquadPackage(tmp.path, "frontend-replica")
  const readme = path.join(existingRoot, "README.md")
  await fs.writeFile(readme, "# Project-owned Frontend Replica\n")
  activity("wrote project-owned package")

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      activity("entered first provided instance")
      expect(await fs.readFile(readme, "utf8")).toBe("# Project-owned Frontend Replica\n")
    },
  })
  activity("first provide completed")

  await fs.writeFile(readme, "# Edited After Bootstrap\n")
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      activity("entered cached provided instance")
      expect(await fs.readFile(readme, "utf8")).toBe("# Edited After Bootstrap\n")
      const packages = await ExpertSquadRegistry.discover(tmp.path)
      expect(packages.find((item) => item.id === "frontend-replica")?.namespace).toBe("project")
      expect(packages.map((item) => item.id)).toEqual(payloadPackageSources.map((source) => source.id))
    },
  })
  activity("cached provide completed")

  await Instance.disposeAll()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      activity("entered reopened provided instance")
      expect(await fs.readFile(readme, "utf8")).toBe("# Edited After Bootstrap\n")
      const packages = await ExpertSquadRegistry.discover(tmp.path)
      expect(packages.find((item) => item.id === "frontend-replica")?.namespace).toBe("project")
      expect(packages.map((item) => item.id)).toEqual(payloadPackageSources.map((source) => source.id))
    },
  })
})

test("project bootstrap fails fast when stale direct-child expert-squad roots remain", async (activity) => {
  await using tmp = await tmpdir({ git: true })
  activity("created temporary project")
  const staleRoot = path.join(tmp.path, ".opencorvus", "expert-squads", "frontend-replica")
  for (const [relativePath, content] of Object.entries(projectExpertSquadFiles("frontend-replica"))) {
    const target = path.join(staleRoot, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
  activity("wrote stale direct-child package")

  await expect(
    Instance.provide({
      directory: tmp.path,
      fn: () => "opened",
    }),
  ).rejects.toThrow("direct package roots are not supported")
})

test("refreshes a cached directory project when the directory becomes a git repository", async (activity) => {
  await using tmp = await tmpdir()
  activity("created temporary directory")
  let initialProjectID = ""

  await Instance.provide({
    directory: tmp.path,
    fn: () => {
      activity("entered non-git provided instance")
      initialProjectID = Instance.project.id
      expect(Instance.project.id).toBe(Project.directoryProjectID(tmp.path))
      expect(Instance.project.id).not.toBe("global")
      expect(Instance.worktree).toBe(tmp.path)
    },
  })
  activity("non-git provide completed")

  await $`git init`.cwd(tmp.path).quiet()
  activity("initialized git repository")

  await Instance.provide({
    directory: tmp.path,
    async fn() {
      activity("entered refreshed git provided instance")
      expect(Instance.project.id).not.toBe("global")
      expect(Instance.project.id).toBe(initialProjectID)
      expect(Instance.directory).toBe(tmp.path)
      expect(Instance.worktree).toBe(tmp.path)
      expect(Instance.project.worktree).toBe(tmp.path)

      const info = await Worktree.create({ name: "stale-cache-smoke" })
      try {
        activity("created worktree")
        expect(info.directory).toContain(".opencorvus")
        expect(info.directory).not.toBe("/")
      } finally {
        await Worktree.remove({ directory: info.directory })
        activity("removed worktree")
      }
    },
  })
})

test("refreshes a cached git directory project when the git directory disappears", async (activity) => {
  await using tmp = await tmpdir({ git: true })
  activity("created git project")
  let initialProjectID = ""

  await Instance.provide({
    directory: tmp.path,
    fn: () => {
      activity("entered git provided instance")
      initialProjectID = Instance.project.id
      expect(Instance.current()?.git).toBe(true)
    },
  })
  activity("git provide completed")

  await fs.rm(`${tmp.path}/.git`, { recursive: true, force: true })
  activity("removed git directory")

  await Instance.provide({
    directory: tmp.path,
    fn() {
      activity("entered refreshed non-git provided instance")
      expect(Instance.project.id).toBe(initialProjectID)
      expect(Instance.directory).toBe(tmp.path)
      expect(Instance.worktree).toBe(tmp.path)
      expect(Instance.project.worktree).toBe(tmp.path)
      expect(Instance.current()?.git).toBe(false)
    },
  })
})

test("runs a late init once for an already cached directory instance", async (activity) => {
  await using tmp = await tmpdir({ git: true })
  activity("created git project")
  let initCalls = 0
  const init = async () => {
    initCalls += 1
  }

  await Instance.provide({
    directory: tmp.path,
    fn: () => {
      activity("entered initial provided instance")
      expect(Instance.directory).toBe(tmp.path)
    },
  })
  activity("initial provide completed")

  await Instance.provide({
    directory: tmp.path,
    init,
    fn: () => {
      activity("entered late-init provided instance")
      expect(initCalls).toBe(1)
    },
  })
  activity("late-init provide completed")

  await Instance.provide({
    directory: tmp.path,
    init,
    fn: () => {
      activity("entered repeated late-init provided instance")
      expect(initCalls).toBe(1)
    },
  })
})

test("reuses one Windows instance for casing variants without canonicalizing the visible path", async (activity) => {
  if (process.platform !== "win32") return

  await using tmp = await tmpdir({ git: true })
  activity("created git project")
  const firstSpelling = tmp.path.toLowerCase()
  const secondSpelling = tmp.path.toUpperCase()
  let initCalls = 0
  const init = async () => {
    initCalls += 1
  }

  await Instance.provide({
    directory: firstSpelling,
    init,
    fn: () => {
      activity("entered first casing provided instance")
      expect(Instance.directory).toBe(firstSpelling)
      expect(initCalls).toBe(1)
    },
  })
  activity("first casing provide completed")

  await Instance.provide({
    directory: secondSpelling,
    init,
    fn: () => {
      activity("entered second casing provided instance")
      expect(Instance.directory).toBe(firstSpelling)
      expect(initCalls).toBe(1)
    },
  })
})
