import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { Instance } from "../../src/project/instance"
import { SessionPrompt } from "../../src/session/prompt"
import { Identifier } from "../../src/id/id"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const octokitCalls = {
  comments: [] as Array<{ body: string }>,
  createPulls: [] as Array<{ title: string }>,
}
const setFailedCalls: unknown[] = []

mock.module("@actions/core", () => ({
  setFailed: mock((message: unknown) => {
    setFailedCalls.push(message)
  }),
  getIDToken: mock(async () => "oidc-token"),
}))

mock.module("@actions/github", () => ({
  context: {},
}))

mock.module("@octokit/graphql", () => ({
  graphql: {
    defaults() {
      return async () => ({
        repository: {
          issue: {
            title: "Original issue title",
            body: "Original issue body",
            author: { login: "alice" },
            createdAt: "2026-06-18T00:00:00Z",
            state: "OPEN",
            comments: { nodes: [] },
          },
        },
      })
    },
  },
}))

mock.module("@octokit/rest", () => ({
  Octokit: class {
    repos = {
      getCollaboratorPermissionLevel: mock(async () => ({ data: { permission: "write" } })),
    }

    rest = {
      repos: {
        get: mock(async () => ({ data: { default_branch: "main" } })),
      },
      reactions: {
        createForIssue: mock(async () => ({ data: { id: 1 } })),
        listForIssue: mock(async () => ({ data: [{ id: 1, user: { login: "opencorvus-agent[bot]" } }] })),
        deleteForIssue: mock(async () => ({ data: {} })),
      },
      issues: {
        createComment: mock(async (input: { body: string }) => {
          octokitCalls.comments.push({ body: input.body })
          return { data: { id: 1 } }
        }),
      },
      pulls: {
        list: mock(async () => ({ data: [] })),
        create: mock(async (input: { title: string }) => {
          octokitCalls.createPulls.push({ title: input.title })
          return { data: { number: 123 } }
        }),
      },
    }
  },
}))

const envKeys = ["MODEL", "GITHUB_RUN_ID", "PROMPT"] as const
let previousEnv: Partial<Record<(typeof envKeys)[number], string | undefined>> = {}
const originalFetch = globalThis.fetch
const fetchCalls: Array<{ url: string; method?: string; authorization?: string | null }> = []

function assistantText(sessionID: string, text: string) {
  const now = Date.now()
  return {
    info: {
      id: Identifier.ascending("message"),
      role: "assistant",
      sessionID,
      time: { created: now, completed: now },
      finish: "stop",
      agent: "coding",
      providerID: "openai",
      modelID: "gpt-test",
    },
    parts: [
      {
        id: Identifier.ascending("part"),
        sessionID,
        messageID: Identifier.ascending("message"),
        type: "text",
        text,
      },
    ],
  } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
}

async function gitCommitCount(cwd: string) {
  return (await $`git rev-list --count HEAD`.cwd(cwd).quiet().text()).trim()
}

async function gitCachedNames(cwd: string) {
  return (await $`git diff --cached --name-only`.cwd(cwd).quiet().text()).trim()
}

async function gitStatus(cwd: string) {
  return (await $`git status --porcelain`.cwd(cwd).quiet().text()).trim()
}

describe("github action run", () => {
  afterEach(async () => {
    for (const key of envKeys) {
      const value = previousEnv[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    previousEnv = {}
    globalThis.fetch = originalFetch
    fetchCalls.length = 0
    octokitCalls.comments.length = 0
    octokitCalls.createPulls.length = 0
    setFailedCalls.length = 0
    mock.restore()
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("summary failure stops issue dirty flow before git mutation or pull request creation", async () => {
    previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as typeof previousEnv
    process.env.MODEL = "openai/gpt-test"
    process.env.GITHUB_RUN_ID = "123456"
    process.env.PROMPT = "fix the issue"
    globalThis.fetch = (async (input, init) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      fetchCalls.push({ url, method: init?.method, authorization: headers.get("Authorization") })
      if (url === "https://api.opencorvus.ai/exchange_github_app_token") {
        return Response.json({ token: "app-token" })
      }
      if (url === "https://api.github.com/installation/token") {
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    await using tmp = await tmpdir({ git: true })
    const cwd = process.cwd()
    process.chdir(tmp.path)

    const promptCalls: string[] = []
    let commitCountBeforeSummary = ""
    let cachedNamesBeforeSummary = ""
    const promptSpy = spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
      const text = input.parts.find((part) => part.type === "text")?.text ?? ""
      promptCalls.push(text)
      if (promptCalls.length === 1) {
        await Bun.write(path.join(tmp.path, "dirty.txt"), "dirty work")
        commitCountBeforeSummary = await gitCommitCount(tmp.path)
        cachedNamesBeforeSummary = await gitCachedNames(tmp.path)
        return assistantText(input.sessionID, "Implemented dirty work.")
      }
      throw new Error("summary model failed")
    })
    const exitCodes: Array<string | number | null | undefined> = []
    const exit = spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      exitCodes.push(code)
      throw new Error(`process.exit:${code}`)
    })

    try {
      const { GithubRunCommand } = await import("../../src/cli/cmd/github")
      await expect(
        GithubRunCommand.handler?.({
          event: JSON.stringify({
            eventName: "issues",
            actor: "alice",
            repo: { owner: "owner", repo: "repo" },
            payload: {
              action: "opened",
              issue: {
                number: 42,
                title: "Original issue title",
              },
            },
          }),
        } as never),
      ).rejects.toThrow("process.exit:1")
    } finally {
      process.chdir(cwd)
      promptSpy.mockRestore()
      exit.mockRestore()
    }

    expect(promptCalls).toHaveLength(2)
    expect(fetchCalls).toContainEqual({
      url: "https://api.opencorvus.ai/exchange_github_app_token",
      method: "POST",
      authorization: "Bearer oidc-token",
    })
    expect(fetchCalls).toContainEqual({
      url: "https://api.github.com/installation/token",
      method: "DELETE",
      authorization: "Bearer app-token",
    })
    expect(promptCalls[1]).toBe("Summarize the following in less than 40 characters:\n\nImplemented dirty work.")
    expect(setFailedCalls).toEqual(["summary model failed"])
    expect(exitCodes).toEqual([1])
    expect(octokitCalls.createPulls).toEqual([])
    expect(octokitCalls.comments[0]?.body).toContain("summary model failed")
    expect(octokitCalls.comments[0]?.body).not.toContain("Fix issue:")

    expect(commitCountBeforeSummary).not.toBe("")
    expect(await gitCommitCount(tmp.path)).toBe(commitCountBeforeSummary)
    expect(await gitCachedNames(tmp.path)).toBe(cachedNamesBeforeSummary)
    expect(await gitStatus(tmp.path)).toContain("dirty.txt")
  }, 60_000)
})
