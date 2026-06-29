import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const textExtensions = new Set([".md", ".mdx", ".txt", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".yml", ".yaml"])

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
}

function packageReadmeBunRunCommands(readmePath: string) {
  const text = read(readmePath)
  return [...text.matchAll(/^bun run --cwd ([^\s]+) ([^\s]+)[^\r\n]*$/gm)].map((match) => ({
    packageDir: match[1]!,
    script: match[2]!,
    command: match[0],
  }))
}

function markdownCodeBlocks(text: string, language: string) {
  return Array.from(text.matchAll(new RegExp("^[ \\t]*```" + language + "\\r?\\n([\\s\\S]*?)^[ \\t]*```", "gm"))).map(
    (match) => {
      const lines = match[1]!.replace(/\s+$/, "").split(/\r?\n/)
      const indent = Math.min(
        ...lines.filter((line) => line.trim()).map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0),
      )
      return lines.map((line) => line.slice(indent)).join("\n")
    },
  )
}

function stringLiteralArrayFromConst(source: string, constName: string, seen = new Set<string>()): string[] {
  if (seen.has(constName)) throw new Error(`recursive const array reference: ${constName}`)
  seen.add(constName)
  const match = source.match(new RegExp(`const ${constName} = \\[([^\\]]+)\\] as const`))
  expect(match).not.toBeNull()
  return Array.from(match![1]!.matchAll(/\.\.\.([A-Z_]+)|"([^"]+)"/g)).flatMap((item) =>
    item[1] ? stringLiteralArrayFromConst(source, item[1], new Set(seen)) : [item[2]!],
  )
}

function githubEventGroupsFromRuntime() {
  const source = read("packages/opencorvus/src/cli/cmd/github.ts")
  const commentEvents = stringLiteralArrayFromConst(source, "COMMENT_EVENTS")
  const promptRequiredEvents = stringLiteralArrayFromConst(source, "PROMPT_REQUIRED_EVENTS")
  const repoEvents = stringLiteralArrayFromConst(source, "REPO_EVENTS")
  const supportedEvents = stringLiteralArrayFromConst(source, "SUPPORTED_EVENTS")
  const nonCommentEvents = supportedEvents.filter((eventName) => !commentEvents.includes(eventName))

  expect(promptRequiredEvents).toEqual(["issues", ...repoEvents])
  expect(stringLiteralArrayFromConst(source, "USER_EVENTS")).toEqual([
    ...commentEvents,
    ...nonCommentEvents.filter((eventName) => !repoEvents.includes(eventName)),
  ])
  return { commentEvents, nonCommentEvents, promptRequiredEvents, supportedEvents }
}

type GitHubWorkflowJob = {
  if?: string
  permissions?: Record<string, string>
  steps?: Array<Record<string, any>>
}

type GitHubWorkflow = {
  on?: Record<string, unknown>
  jobs?: Record<string, GitHubWorkflowJob>
}

function parseGitHubWorkflow(source: string): GitHubWorkflow {
  return Bun.YAML.parse(source) as GitHubWorkflow
}

function opencorvusJob(workflow: GitHubWorkflow): GitHubWorkflowJob {
  const job = workflow.jobs?.opencorvus
  expect(job).toBeDefined()
  return job!
}

function expectReadOnlyAppPermissions(job: GitHubWorkflowJob) {
  expect(job.permissions).toEqual({
    "id-token": "write",
    contents: "read",
    "pull-requests": "read",
    issues: "read",
  })
}

function expectOpenCorvusActionSteps(job: GitHubWorkflowJob, options: { promptRequired: boolean }) {
  expect(job.steps).toHaveLength(2)
  const steps = job.steps!
  expect(steps[0]).toMatchObject({
    uses: "actions/checkout@v7",
    with: { "persist-credentials": false },
  })
  expect(steps[1]).toMatchObject({
    uses: "yangheng95/opencorvus/github@latest",
    with: { model: "alibaba-coding-plan-cn/qwen3.5-plus" },
  })
  expect("run" in steps[1]!).toBe(false)
  const actionInputs = steps[1]!.with as Record<string, unknown>
  expect("prompt" in actionInputs).toBe(options.promptRequired)
}

function workflowContainsEvents(workflow: GitHubWorkflow, events: string[]) {
  const configuredEvents = workflow.on ?? {}
  return events.every((eventName) => eventName in configuredEvents)
}

function expectCommentTriggerWorkflow(workflow: GitHubWorkflow, commentEvents: string[]) {
  expect(Object.keys(workflow.on ?? {})).toEqual(commentEvents)
  const job = opencorvusJob(workflow)
  expect(job.if).toContain("github.event.comment.body")
  expectReadOnlyAppPermissions(job)
  expectOpenCorvusActionSteps(job, { promptRequired: false })
}

function expectPromptConfiguredWorkflow(workflow: GitHubWorkflow, events: string[]) {
  expect(Object.keys(workflow.on ?? {})).toEqual(events)
  const job = opencorvusJob(workflow)
  expect(job.if).toBeUndefined()
  expectReadOnlyAppPermissions(job)
  expectOpenCorvusActionSteps(job, { promptRequired: true })
}

function expectPublishedGitHubActionDefinition(source: string) {
  const actionDefinition = Bun.YAML.parse(source) as {
    runs?: { using?: string; steps?: Array<Record<string, any>> }
  }
  expect(actionDefinition.runs?.using).toBe("composite")
  const steps = actionDefinition.runs?.steps
  expect(steps).toHaveLength(3)
  expect(steps![0]).toMatchObject({
    name: "Setup Bun",
    uses: "oven-sh/setup-bun@v2",
    with: { "bun-version-file": "${{ github.action_path }}/../package.json" },
  })
  expect(steps![1]).toMatchObject({
    name: "Install action dependencies",
    shell: "bash",
    run: 'bun install --cwd "$GITHUB_ACTION_PATH/.." --frozen-lockfile',
  })
  expect(steps![2]).toMatchObject({
    name: "Run opencorvus",
    shell: "bash",
    id: "run_opencorvus",
    run: 'bun "$GITHUB_ACTION_PATH/../packages/opencorvus/src/index.ts" github run',
    env: {
      MODEL: "${{ inputs.model }}",
      SHARE: "${{ inputs.share }}",
      PROMPT: "${{ inputs.prompt }}",
      MENTIONS: "${{ inputs.mentions }}",
      VARIANT: "${{ inputs.variant }}",
      OIDC_BASE_URL: "${{ inputs.oidc_base_url }}",
    },
  })
}

function walkTextFiles(relativeDir: string, out: string[] = []) {
  const dir = path.join(repoRoot, relativeDir)
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkTextFiles(path.relative(repoRoot, fullPath), out)
      continue
    }
    if (textExtensions.has(path.extname(entry.name).toLowerCase())) {
      out.push(path.relative(repoRoot, fullPath).replace(/\\/g, "/"))
    }
  }
  return out
}

function expectFilesNotToContain(files: string[], forbidden: string[]) {
  const offenders = files.flatMap((file) => {
    const text = read(file)
    return forbidden.filter((token) => text.includes(token)).map((token) => `${file}: ${token}`)
  })
  expect(offenders).toEqual([])
}

function balancedObject(source: string, startIndex: number): string | undefined {
  let depth = 0
  let quote: string | undefined
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index]!
    const next = source[index + 1]
    if (lineComment) {
      if (char === "\n") lineComment = false
      continue
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === quote) {
        quote = undefined
      }
      continue
    }
    if (char === "/" && next === "/") {
      lineComment = true
      index += 1
      continue
    }
    if (char === "/" && next === "*") {
      blockComment = true
      index += 1
      continue
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char
      continue
    }
    if (char === "{") depth += 1
    if (char === "}") {
      depth -= 1
      if (depth === 0) return source.slice(startIndex, index + 1)
    }
  }
  return undefined
}

function objectLiterals(source: string): string[] {
  const objects: string[] = []
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "{") continue
    const object = balancedObject(source, index)
    if (object) objects.push(object)
  }
  return objects
}

function arrayLiteralItemCount(source: string): number {
  const items = source.trim()
  if (!items) return 0
  return items.split(",").map((item) => item.trim()).filter(Boolean).length
}

function conversationViewTopLevelOffenders(file: string, source: string): string[] {
  const offenders: string[] = []
  const viewPattern = /\b(?:view|agentView):\s*\{/g
  for (const match of source.matchAll(viewPattern)) {
    const braceIndex = match.index + match[0].lastIndexOf("{")
    const viewObject = balancedObject(source, braceIndex)
    if (!viewObject || !/\bsessions:\s*\[/.test(viewObject)) continue
    const sessions = new Map<string, { placement: string; messageCount: number }>()
    for (const object of objectLiterals(viewObject)) {
      if (/\b(?:view|agentView|sessions|messages):\s*[\[{]/.test(object)) continue
      const sessionID = object.match(/\bsessionID:\s*"([^"]+)"/)?.[1]
      const messageIDs = object.match(/\bmessageIDs:\s*\[([^\]]*)\]/)?.[1]
      if (!sessionID || messageIDs === undefined) continue
      const placement = object.match(/\bplacement:\s*"([^"]+)"/)?.[1]
      sessions.set(sessionID, {
        placement: placement === undefined ? "" : placement,
        messageCount: arrayLiteralItemCount(messageIDs),
      })
    }
    const expectedTopLevelSessionIDs = Array.from(sessions.entries())
      .filter(([, session]) => session.placement === "top_level" && session.messageCount > 0)
      .map(([sessionID]) => sessionID)
    for (const ids of viewObject.matchAll(/\btopLevelSessionIDs:\s*\[([^\]]*)\]/g)) {
      const actualTopLevelSessionIDs = Array.from(ids[1]!.matchAll(/"([^"]+)"/g), (item) => item[1]!)
      if (actualTopLevelSessionIDs.join("\u0000") !== expectedTopLevelSessionIDs.join("\u0000")) {
        offenders.push(
          `${file}: topLevelSessionIDs differ from production projection expected=${JSON.stringify(expectedTopLevelSessionIDs)} actual=${JSON.stringify(actualTopLevelSessionIDs)}`,
        )
      }
    }
  }
  return offenders
}

describe("document health audit regressions", () => {
  test("public website docs and chrome do not publish retired repository or action contracts", () => {
    const publicFiles = [
      "README.md",
      "CONTRIBUTING.md",
      ".github/workflows/generate.yml",
      ".github/workflows/build-vscode-extension.yml",
      ".github/workflows/opencorvus.yml",
      "github/README.md",
      "github/action.yml",
      "packages/web/README.md",
      "packages/web/config.mjs",
      "packages/web/src/components/Footer.astro",
      "行情业务组件批量重写prompts.md",
      ...walkTextFiles("packages/web/src/content/docs"),
    ]

    expectFilesNotToContain(publicFiles, [
      "yangheng95/argus",
      "cd argus",
      "github/index.ts",
      "inputs.agent",
      "AGENT: ${{ inputs.agent }}",
      "| `agent` |",
      "API无法连接则提供mock数据",
      "（API无法连接则提供mock数据）",
      "ARGUS_APP_ID",
      "ARGUS_APP_SECRET",
      "packages/opencorvus/bin/opencorvus",
      "packages/opencorvus/bin/",
      "packages/opencorvus/.opencorvus/opencorvus.jsonc",
      "packages/opencorvus/script/eval-e2e.ts",
      "bun run script/eval-e2e.ts",
      "createOpencode*",
      "opencorvus.dev",
      "Starlight Starter Kit",
      "fall back to push messages",
      "自动改走 push 消息",
      "// 兜底",
      "--config PATH",
      "@gitlab/opencode-gitlab-auth",
      "@opencode-ai/plugin",
      "opencorvus auth --logout",
      "opencorvus models --list",
      "opencorvus completions",
      "opencorvus attach",
      "opencorvus mcp status",
      "opencorvus mcp remove-auth",
      "mcp status",
      "mcp remove-auth",
      "~/.opencorvus/config/opencorvus.json",
      "~/.opencorvus/overlay.log",
      "~/.opencorvus/overlay.jsonc",
      "OPENCORVUS_DEFAULT_MODEL",
      "OPENCORVUS_TOOL_TIMEOUT_MS",
      "OPENCORVUS_GOAL_RUN_TIMEOUT_MS",
      "OPENCORVUS_DECISION_INACTIVITY_MS",
      "OPENCORVUS_INTERACTION_TIMEOUT_MS",
      "OPENCORVUS_EXECUTOR_CODEX_PERMISSION_MODE",
      "OPENCORVUS_OVERLAY_BIN",
      "OPENCORVUS_OVERLAY_DISABLED",
      "OPENCORVUS_OVERLAY_SINGLETON_MODE",
      "OPENCORVUS_OVERLAY_RETRY_BASE_MS",
      "OPENCORVUS_OVERLAY_CIRCUIT_",
      "OPENCORVUS_OVERLAY_MODE",
      "OPENCORVUS_OVERLAY_STDIN_EXIT",
      "OPENCORVUS_EMBEDDED_OVERLAY_B64",
      "OPENCORVUS_EMBEDDED_OVERLAY_HASH",
      "OPENCORVUS_MODEL_",
      "CODING_DASHSCOPE_API_KEY",
      "DASHSCOPE_CODING_BASE_URL",
      "DASHSCOPE_INTL_BASE_URL",
      "DASHSCOPE_API_URL",
      "/mcp/transport",
      "MCPServe.url",
      "webpage_extract",
      "webpage_compile",
      "webpage_analyze",
      "webpage_runtime_state",
      "webpage_render",
      "webpage_evaluate",
      "webpage_text_diff",
      "webpage_vision_judge",
      "refuses to expose without password",
      "`--format default       | json`",
      "anthropic/claude-haiku-4-6",
      "packages/channel-runtime/packages/channel-runtime",
      "src/packages/channel-runtime/src/main.ts",
      "latest local package run produced",
      "172 MiB",
      "171 MiB",
      "--tool-timeout-ms",
      "--stall-timeout-ms",
      "--planning-stall-timeout-ms",
      "--skip-local-verify",
      "bun dev <directory>",
      "bun dev .",
      "bun dev serve",
      "fallback fallback",
      "fall back to the latest successful",
      "OpenCorvus inherits OpenCorvus",
      "social-cards.sst.dev",
      "model: openai/gpt-5.5",
      "anthropic/claude-sonnet-4-20250514",
      "curl -fsSL https://opencorvus.ai/install | bash",
      "npm i -g opencorvus-ai@latest",
      "npm  i -g opencorvus-ai@latest",
      "bun i -g opencorvus-ai@latest",
      "bun  i -g opencorvus-ai@latest",
      "brew install yangheng95/tap/opencorvus",
      "scoop install opencorvus",
      "choco install opencorvus",
      "STT_PROVIDERS",
    ])
  })

  test("repository GitHub workflows use current action majors", () => {
    const githubFiles = walkTextFiles(".github")
    expectFilesNotToContain(githubFiles, [
      "actions/checkout@v4",
      "actions/checkout@v6",
      "actions/setup-node@v4",
      "actions/github-script@v8",
      "actions/github-script@v7",
      "actions/cache@v4",
      "actions/upload-artifact@v4",
      "actions/download-artifact@v4",
    ])

    expect(read(".github/actions/setup-bun/action.yml")).toContain("actions/setup-node@v6")
    expect(read(".github/actions/setup-bun/action.yml")).toContain("actions/cache@v6")
    const actionDefinition = read("github/action.yml")
    expectPublishedGitHubActionDefinition(actionDefinition)
    expect(actionDefinition).toContain("oven-sh/setup-bun@v2")
    expect(actionDefinition).toContain('bun "$GITHUB_ACTION_PATH/../packages/opencorvus/src/index.ts" github run')
    expect(fs.existsSync(path.join(repoRoot, "github/index.ts"))).toBe(false)
    expect(fs.existsSync(path.join(repoRoot, "github/package.json"))).toBe(false)
    expect(fs.existsSync(path.join(repoRoot, "github/bun.lock"))).toBe(false)
    expect(read("github/README.md")).toContain(
      'bun "$GITHUB_ACTION_PATH/../packages/opencorvus/src/index.ts" github run',
    )
    expect(read("github/README.md")).toContain("SessionPrompt.prompt")
    expect(read("github/README.md")).not.toContain("./.github/actions/setup-bun")
    expect(read("github/README.md")).not.toContain("opencorvus github install")
    expect(read("github/README.md")).not.toContain("@opencorvus-ai/sdk")
    expect(actionDefinition).not.toContain("https://opencorvus.ai/install")
    expect(actionDefinition).not.toContain("~/.opencorvus/bin")
    expect(read("packages/opencorvus/src/cli/cmd/github.ts")).toContain("actions/checkout@v7")
    expect(read("packages/opencorvus/src/cli/cmd/github.ts")).not.toContain("actions/checkout@v6")

    for (const file of [
      ".github/workflows/typecheck.yml",
      ".github/workflows/test.yml",
      ".github/workflows/build.yml",
      ".github/workflows/build-vscode-extension.yml",
      ".github/workflows/build-overlays.yml",
      ".github/workflows/opencorvus.yml",
    ]) {
      const text = read(file)
      expect(text).toContain("actions/checkout@v7")
      expect(text).toContain("persist-credentials: false")
    }

    const generateWorkflow = read(".github/workflows/generate.yml")
    expect(generateWorkflow).toContain("actions/checkout@v7")
    expect(generateWorkflow).toContain("token: ${{ github.token }}")
  })

  test("beta release script does not use broad destructive git cleanup", () => {
    const beta = read("script/beta.ts")

    expect(beta).toContain("ensureCleanWorktree")
    expect(beta).toContain("git status --porcelain=v1")
    expect(beta).toContain("git merge --abort")
    expect(beta).toContain("+refs/heads/dev:refs/remotes/origin/dev")
    expect(beta).not.toContain("git fetch origin refs/heads/dev:refs/remotes/origin/dev")
    expect(beta).toContain("git ls-remote --heads origin beta")
    expect(beta).toContain("+refs/heads/beta:refs/remotes/origin/beta")
    expect(beta).toContain("Remote beta branch does not exist; first publish will create it")
    expect(beta).toContain("--force-with-lease=refs/heads/beta:")
    expect(beta).toContain("+refs/pull/${pr.number}/head:refs/heads/pr/${pr.number}")
    expect(beta).toContain('console.log("  Failed to stage changes")\n      await abortMerge()')
    expect(beta).toContain("console.log(`  Failed to commit: ${err}`)\n      await abortMerge()")
    expect(beta).not.toContain("git checkout -- .")
    expect(beta).not.toContain("git clean -fd")
    expect(beta).not.toContain("git fetch origin dev")
    expect(beta).not.toContain("git fetch origin beta")
  })

  test("release scripts use lease-based force pushes", () => {
    const files = ["script/beta.ts", "script/publish.ts", ".github/workflows/build.yml"]

    for (const file of files) {
      const text = read(file)
      expect(text).not.toMatch(/git push[^\n]*--force(?:\s|$)/)
    }

    expect(read("script/beta.ts")).toContain("--force-with-lease=refs/heads/beta:")
    expect(read(".github/workflows/build.yml")).toContain("--force-with-lease=refs/heads/release:")
    expect(read(".github/workflows/build.yml")).toContain("refs/heads/release:refs/remotes/origin/release")
    expect(read(".github/workflows/build.yml")).not.toContain("git fetch origin release")
  })

  test("release CLI publish surfaces exhausted AUR update retries", () => {
    const source = read("packages/opencorvus/script/publish.ts")

    expect(source).toContain("const maxAurUpdateAttempts = 30")
    expect(source).toContain("for (let i = 0; i < maxAurUpdateAttempts; i++)")
    expect(source).toContain("if (i === maxAurUpdateAttempts - 1)")
    expect(source).toContain("AUR update failed after ${maxAurUpdateAttempts} attempts for ${pkg}")
  })

  test("release workflow does not hide creation, asset, or no-op branch failures", () => {
    const workflow = read(".github/workflows/build.yml")

    expect(workflow).toContain('gh release view "v${VERSION}"')
    expect(workflow).toContain('gh release create "v${VERSION}"')
    expect(workflow).not.toContain('--repo "$GITHUB_REPOSITORY" || true')
    expect(workflow).toContain('UPLOAD_DIR="$(mktemp -d)"')
    expect(workflow).toContain(
      'bun ./script/stage-release-upload-assets.ts --source /tmp/release-assets --out "$UPLOAD_DIR" --version "$VERSION"',
    )
    expect(read("script/stage-release-upload-assets.ts")).toContain("Duplicate release asset name after staging")
    expect(read("script/stage-release-upload-assets.ts")).toContain("cliArchiveName")
    expect(read("script/stage-release-upload-assets.ts")).toContain("overlayBundlePatterns")
    expect(workflow).not.toContain("find /tmp/release-assets -type f -print0")
    expect(workflow).not.toContain('ASSET="${REL//\\//__}"')
    expect(workflow).toContain("if git diff --cached --quiet; then")
    expect(workflow).toContain("release branch already up to date for v${VERSION}")
    expect(workflow).toContain("No overlay artifacts found under /tmp/overlay")
    expect(workflow).toContain("Missing release branch document")
    expect(workflow).toContain("Missing OpenCorvus binary in release branch platform directory")
    expect(workflow).toContain("Missing ripgrep binary in release branch platform directory")
    expect(workflow).not.toContain("git rm -rf . 2>/dev/null || true")
    expect(workflow).not.toContain('cp "$GITHUB_WORKSPACE/README.md" . 2>/dev/null')
    expect(workflow).not.toContain('cp "$GITHUB_WORKSPACE/RELEASE.md" . 2>/dev/null')
    expect(workflow).not.toContain('chmod +x "$platform"/opencorvus* 2>/dev/null || true')
    expect(workflow).not.toContain('chmod +x "$platform"/bin/rg* 2>/dev/null || true')
    expect(workflow).not.toContain("cp -r /tmp/overlay/overlay-* overlay/ 2>/dev/null || true")
  })

  test("generate workflow fails on generated workflow drift instead of hiding it", () => {
    const workflow = read(".github/workflows/generate.yml")
    const generate = read("script/generate.ts")

    const generatedArtifacts = read("script/generated-artifacts.ts")

    expect(generate).toContain("GENERATED_ARTIFACT_PATHS")
    expect(generatedArtifacts).toContain("packages/sdk/openapi.json")
    expect(generatedArtifacts).toContain("packages/web/src/content/docs/zh-cn/reference/api.mdx")
    expect(generate).not.toContain("bun ./script/format.ts")
    expect(generate).not.toContain("--write .")
    expect(workflow).toContain("bun ./script/generated-artifacts.ts --print")
    expect(workflow).toContain("bun ./script/generated-artifacts.ts --check-worktree")
    expect(workflow).not.toContain("generated_path()")
    expect(generatedArtifacts).toContain("Generate changed non-generated file")
    expect(workflow).toContain('git add -A -- "${GENERATED_PATHS[@]}"')
    expect(workflow).not.toContain("git add -A\n")
    expect(workflow).not.toContain("git diff --cached --quiet -- .github/workflows/")
    expect(workflow).not.toContain("git restore --staged .github/workflows")

    const typecheck = read(".github/workflows/typecheck.yml")
    expect(typecheck).toContain("Verify generated API docs")
    expect(typecheck).toContain("bun run ./packages/opencorvus/script/docs/render-api-md.ts --check")
  })

  test("new architecture docs do not retain stale gateway session kind or package paths", () => {
    const files = [
      "specs/current/architecture/README.md",
      "specs/current/architecture/02-data.md",
      "specs/current/architecture/03-control.md",
    ]
    const diagrams = [
      "specs/current/architecture/01-agents.svg",
      "specs/current/architecture/02-data.svg",
      "specs/current/architecture/03-control.svg",
    ]

    expectFilesNotToContain(files, ["kind='gateway'", "src/gateway", "`assistant` · `gateway`"])
    expectFilesNotToContain(diagrams, [
      "Gateway Agent",
      "gateway/agent.ts",
      "channel_key",
      "session_gateway_singleton_idx",
      "session-proxy-middleware",
      "kind: gateway/agent",
      "orchestrator/service.ts",
      "orchestrator/task-loop.ts",
      "orchestrator/build-dispatch.ts",
      "goal-pool.ts",
      "pipeline/executor.ts",
      "build-dispatch",
      "GoalPool",
      "opencode",
      "Executor — goal/runner.ts",
      "goal/runner.ts → executor/registry.ts",
      "planner/per-goal",
      "dispatch gate",
      "created / batch_complete /",
      "acceptance_rejected / retry",
      "control-plane — 多工作区代理",
      "workspace-server/",
      "workspace route proxy",
      "adaptors/ (worktree 适配)",
      "Trace.event()",
      "替代 AgentTrace + env-gated LLMTrace",
    ])
    expectFilesNotToContain(
      ["specs/current/architecture/02-data.svg"],
      [
        "orchestrator 域",
        "orchestrator/orchestrator.sql.ts",
        "service.ts + store.ts",
        "执行与交付（7 表）",
        "goal_snapshot",
        ">run</text>",
        ">goal_run</text>",
        ">evaluation</text>",
      ],
    )
    const agentsDiagram = read("specs/current/architecture/01-agents.svg")
    expect(agentsDiagram).toContain("task-api/index.ts")
    expect(agentsDiagram).toContain("orchestrator/loop.ts")
    expect(agentsDiagram).toContain("orchestrator/tools.ts")
    expect(agentsDiagram).toContain("build/agent.ts")
    expect(agentsDiagram).toContain("executor/registry.ts")
    expect(agentsDiagram).not.toContain("goal/runner.ts")
    const dataDiagram = read("specs/current/architecture/02-data.svg")
    expect(dataDiagram).toContain("engine/engine.sql.ts")
    expect(dataDiagram).toContain("engine_artifact")
    expect(dataDiagram).toContain("artifact-centric")
    expect(dataDiagram).toContain("goal_run_attempt")
    expect(read("specs/current/architecture/02-data.md")).toContain("共 21 种")
    expect(read("specs/current/architecture/02-data.md")).toContain("gateway` 不再是 SessionKind")
  })

  test("new architecture data doc does not duplicate engine schema inventories", () => {
    const engineSql = read("packages/opencorvus/src/engine/engine.sql.ts")
    const dataDoc = read("specs/current/architecture/02-data.md")
    const engineTables = Array.from(engineSql.matchAll(/export const (Engine[A-Za-z0-9]+Table) = sqliteTable/g)).map(
      (match) => match[1],
    )
    const artifactKinds = Array.from(
      engineSql
        .slice(
          engineSql.indexOf("export type EngineArtifactKind ="),
          engineSql.indexOf("export type EngineAcceptanceStatus"),
        )
        .matchAll(/"([^"]+)"/g),
    ).map((match) => match[1])

    expect(engineTables.length).toBeGreaterThan(0)
    expect(artifactKinds.length).toBeGreaterThan(0)
    expect(dataDoc).toContain("packages/opencorvus/src/engine/engine.sql.ts")
    expect(dataDoc).toContain("唯一真源")
    expect(dataDoc).not.toContain("EngineExecutorSessionTable")
    expect(dataDoc).not.toMatch(/Engine[A-Za-z0-9]+Table、Engine[A-Za-z0-9]+Table/)
    expect(dataDoc).not.toMatch(/sqliteTable.*共 \d+ 个/)
    expect(dataDoc).not.toContain("完整 `EngineArtifactKind` 取值")
    expect(dataDoc).not.toContain("prosecutor_attempt")
  })

  test("new architecture control doc does not duplicate capability or orchestrator route inventories", () => {
    const capabilitySource = read("packages/opencorvus/src/panel/capability.ts")
    const orchestratorRoutes = read("packages/opencorvus/src/server/routes/orchestrator.ts")
    const controlDoc = read("specs/current/architecture/03-control.md")
    const actions = Array.from(capabilitySource.matchAll(/action: "([^"]+)"/g)).map((match) => match[1])
    const routeCount = (orchestratorRoutes.match(/describeRoute\(/g) ?? []).length

    expect(actions).toContain("query_task")
    expect(routeCount).toBeGreaterThan(0)
    expect(controlDoc).toContain("PanelCapabilityRegistry")
    expect(controlDoc).toContain("源码为唯一真源")
    expect(controlDoc).not.toMatch(/共 \d+ 个 action/)
    expect(controlDoc).not.toMatch(/共 \d+ 个 describeRoute/)
    expect(controlDoc).not.toContain("| 查询视图")
  })

  test("public GitHub Action examples match the generated workflow contract", () => {
    const githubActionDocs = [
      {
        file: "packages/web/src/content/docs/operations/github-action.mdx",
        description:
          "description: Trigger the OpenCorvus AI coding agent from GitHub comments, issue or PR events, schedules, and manual workflows.",
        lead: "The OpenCorvus GitHub Action triggers the AI coding agent from supported GitHub events, including comments, issue or PR lifecycle events, schedules, and manual workflows.",
        promptRequirementPhrases: ["require the `prompt` input", "payloads do not include a comment body"],
        triggerTerms: ["comments", "issue or PR lifecycle events", "schedules", "manual workflows"],
      },
      {
        file: "packages/web/src/content/docs/zh-cn/operations/github-action.mdx",
        description: "description: 通过 GitHub 评论、Issue 或 PR 事件、定时任务和手动工作流触发 AI 编码代理。",
        lead: "OpenCorvus GitHub Action 会从支持的 GitHub 事件触发 AI 编码代理，包括评论、Issue 或 PR 生命周期事件、定时任务和手动工作流。",
        promptRequirementPhrases: ["必须配置 `prompt` 输入", "没有评论正文"],
        triggerTerms: ["评论", "Issue 或 PR 生命周期事件", "定时任务", "手动工作流"],
      },
    ]
    const eventGroups = githubEventGroupsFromRuntime()

    for (const { file, description, lead, promptRequirementPhrases, triggerTerms } of githubActionDocs) {
      const text = read(file)
      expect(text).not.toContain("description: Trigger the OpenCorvus AI coding agent from a PR or Issue comment")
      expect(text).not.toContain("description: 在 PR 或 Issue 评论区")
      expect(text).toContain(description)
      expect(text).toContain(lead)
      for (const phrase of promptRequirementPhrases) {
        expect(text).toContain(phrase)
      }
      for (const triggerTerm of triggerTerms) {
        expect(text).toContain(triggerTerm)
      }
      expect(text).not.toContain("actions/checkout@v4")
      expect(text).not.toContain("model: openai/gpt-5.5")
      expect(text).toContain("actions/checkout@v7")
      expect(text).toContain("persist-credentials: false")
      expect(text).toContain('bun "$GITHUB_ACTION_PATH/../packages/opencorvus/src/index.ts" github run')
      expect(text).toContain("SessionPrompt.prompt")
      expect(text).not.toContain("starts `opencorvus serve`")
      expect(text).not.toContain("通过 `@opencorvus-ai/sdk`")
      expect(text).not.toContain("via `@opencorvus-ai/sdk`")
      expect(text).toContain("model: alibaba-coding-plan-cn/qwen3.5-plus")
      expect(text).toContain("ALIBABA_CODING_PLAN_API_KEY: ${{ secrets.ALIBABA_CODING_PLAN_API_KEY }}")
      expect(text).not.toContain("model: alibaba-cn/qwen3.5-plus")
      expect(text).not.toContain("DASHSCOPE_API_KEY")
      expect(text).not.toContain("MOCK_TOKEN")
      expect(text).not.toContain("MOCK_EVENT")
      expect(text).not.toContain("--token")
      expect(text).not.toContain("github_pat")
      expect(text).not.toContain("use_github_token")
      expect(text).not.toContain("GITHUB_TOKEN")
      expect(text).not.toContain("contents: write")
      expect(text).not.toContain("pull-requests: write")
      expect(text).not.toContain("issues: write")
      expect(text).not.toContain("OPENCORVUS_CONFIG_CONTENT")
      expect(text).not.toContain("https://coding.dashscope.aliyuncs.com/v1")
      for (const eventName of eventGroups.supportedEvents) {
        expect(text).toContain(`\`${eventName}\``)
      }
      const workflowExamples = markdownCodeBlocks(text, "yaml")
        .filter((block) => block.includes("yangheng95/opencorvus/github@latest"))
        .map(parseGitHubWorkflow)
      expect(workflowExamples).toHaveLength(2)
      const commentWorkflow = workflowExamples.find((workflow) =>
        workflowContainsEvents(workflow, eventGroups.commentEvents),
      )
      const repositoryEventWorkflow = workflowExamples.find((workflow) =>
        workflowContainsEvents(workflow, eventGroups.nonCommentEvents),
      )
      expect(commentWorkflow).toBeDefined()
      expect(repositoryEventWorkflow).toBeDefined()
      expectCommentTriggerWorkflow(commentWorkflow!, eventGroups.commentEvents)
      expectPromptConfiguredWorkflow(repositoryEventWorkflow!, eventGroups.nonCommentEvents)
    }

    const workflow = read(".github/workflows/opencorvus.yml")
    expect(workflow).toContain("uses: actions/checkout@v7")
    expect(workflow).toContain("persist-credentials: false")
    expect(workflow).toContain("model: alibaba-coding-plan-cn/qwen3.5-plus")
    expect(workflow).toContain("ALIBABA_CODING_PLAN_API_KEY: ${{ secrets.ALIBABA_CODING_PLAN_API_KEY }}")
    expect(workflow).not.toContain("OPENCORVUS_CONFIG_CONTENT")
    expect(workflow).not.toContain("https://coding.dashscope.aliyuncs.com/v1")
    expect(workflow).not.toContain("./.github/actions/setup-bun")
    expect(workflow).toContain("contents: read")
    expect(workflow).toContain("pull-requests: read")
    expect(workflow).toContain("issues: read")
    expectCommentTriggerWorkflow(parseGitHubWorkflow(workflow), eventGroups.commentEvents)

    const actionReadme = read("github/README.md")
    expect(actionReadme).toContain(
      "comments, issue or PR lifecycle events, scheduled workflows, and manual workflow dispatch events",
    )
    expect(actionReadme).toContain("require the `prompt` input because their payloads do not include a comment body.")
    for (const eventName of eventGroups.promptRequiredEvents) {
      expect(actionReadme).toContain(`\`${eventName}\``)
    }
    expect(actionReadme).not.toContain("`pull_request` require the `prompt` input")
    expect(actionReadme).toContain("The quickstart workflow below enables comment triggers only")
    expect(actionReadme).not.toContain("Mention `/opencorvus` in your comment")
    expect(actionReadme).toContain("uses: actions/checkout@v7")
    expect(actionReadme).toContain("persist-credentials: false")
    expect(actionReadme).toContain("id-token: write")
    expect(actionReadme).toContain("contents: read")
    expect(actionReadme).toContain("pull-requests: read")
    expect(actionReadme).toContain("issues: read")
    expect(actionReadme).toContain('OPENCORVUS_PERMISSION: \'{"bash": "deny"}\'')
    expect(actionReadme).toContain("model: alibaba-coding-plan-cn/qwen3.5-plus")
    expect(actionReadme).toContain("ALIBABA_CODING_PLAN_API_KEY: ${{ secrets.ALIBABA_CODING_PLAN_API_KEY }}")
    expect(actionReadme).not.toContain("contents: write")
    expect(actionReadme).not.toContain("MODEL=alibaba-coding-plan-cn/qwen3.5-plus")
    expect(actionReadme).not.toContain("ALIBABA_CODING_PLAN_API_KEY=sk-1234567890")
    expect(actionReadme).not.toContain("--token")
    expect(actionReadme).not.toContain("github_pat")
    expect(actionReadme).not.toContain("personal access token")
    for (const eventName of eventGroups.supportedEvents) {
      expect(actionReadme).toContain(`\`${eventName}\``)
    }
    const workflowExamples = markdownCodeBlocks(actionReadme, "yml")
      .filter((block) => block.includes("yangheng95/opencorvus/github@latest"))
      .map(parseGitHubWorkflow)
    expect(workflowExamples).toHaveLength(2)
    const commentWorkflow = workflowExamples.find((workflow) =>
      workflowContainsEvents(workflow, eventGroups.commentEvents),
    )
    const repositoryEventWorkflow = workflowExamples.find((workflow) =>
      workflowContainsEvents(workflow, eventGroups.nonCommentEvents),
    )
    expect(commentWorkflow).toBeDefined()
    expect(repositoryEventWorkflow).toBeDefined()
    expectCommentTriggerWorkflow(commentWorkflow!, eventGroups.commentEvents)
    expectPromptConfiguredWorkflow(repositoryEventWorkflow!, eventGroups.nonCommentEvents)
    expect(actionReadme).not.toContain("use_github_token: true")
    expect(actionReadme).not.toContain("MOCK_TOKEN")
    expect(actionReadme).not.toContain("MOCK_EVENT")
    expect(actionReadme).not.toContain("GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}")
    expect(actionReadme).not.toContain("DASHSCOPE_API_KEY")

    const actionDefinition = read("github/action.yml")
    expect(actionDefinition).not.toContain("use_github_token")
    expect(actionDefinition).not.toContain("USE_GITHUB_TOKEN")
    expect(actionDefinition).not.toContain("GITHUB_TOKEN")

    const githubCli = read("packages/opencorvus/src/cli/cmd/github.ts")
    expect(githubCli).not.toContain("normalizeUseGithubToken")
    expect(githubCli).not.toContain("USE_GITHUB_TOKEN")
    expect(githubCli).not.toContain('process.env["GITHUB_TOKEN"]')
    expect(githubCli).not.toContain("exchange_github_app_token_with_pat")
    expect(githubCli).not.toContain("github_pat")
    expect(githubCli).not.toContain("assume dirty")
    expect(githubCli).not.toContain("rev-list failed")
    expect(githubCli).not.toContain("Failed to check for existing PR")
    expect(githubCli).not.toContain("Skipped PR creation (no new commits)")
    expect(githubCli).not.toContain("Promise<number | null>")
    expect(githubCli).not.toMatch(/No commits between[\s\S]{0,180}return null/)
    expect(githubCli).toContain("compareCommitsWithBasehead")
    expect(githubCli).toContain("https://opencorvus.ai/docs/operations/github-action/")
    expect(githubCli).not.toContain("https://opencorvus.ai/docs/github/#usage-examples")
  })

  test("public MCP server docs do not publish GitHub PAT remote examples", () => {
    const mcpDocs = [
      "packages/web/src/content/docs/mcp-servers.mdx",
      "packages/web/src/content/docs/zh-cn/mcp-servers.mdx",
    ]
    for (const file of mcpDocs) {
      const text = read(file)
      expect(text).not.toContain("Remote GitHub (Bearer Token)")
      expect(text).not.toContain("远程 GitHub（Bearer Token）")
      expect(text).not.toContain("api.githubcopilot.com/mcp")
      expect(text).not.toContain("ghp_")
      expect(text).not.toContain('"Authorization": "Bearer')
      expect(text).not.toContain("Remote (HTTP)")
      expect(text).not.toContain("远程 HTTP Server")
      expect(text).not.toContain("Bearer Token")
      expect(text).not.toContain("Bearer sk-")
      expect(text).not.toContain("oauth: false")
      expect(text).not.toContain('"oauth": false')
      expect(text).not.toMatch(/\bPAT\b/)
      expect(text).not.toMatch(/personal access token/i)
    }
    expect(read("packages/web/src/content/docs/mcp-servers.mdx")).toContain(
      "OAuth is enabled by default for remote servers",
    )
    expect(read("packages/web/src/content/docs/zh-cn/mcp-servers.mdx")).toContain("远程 server 默认启用 OAuth")
  })

  test("API reference exposes MCP OAuth callback body and state error", () => {
    const apiDocs = [
      "packages/web/src/content/docs/reference/api.mdx",
      "packages/web/src/content/docs/zh-cn/reference/api.mdx",
    ]
    for (const file of apiDocs) {
      const text = read(file)
      const callbackLine = text
        .split(/\r?\n/)
        .find((line) => line.includes("`/mcp/{name}/auth/callback`") && line.includes("`mcp.auth.callback`"))
      expect(callbackLine).toContain("`code`")
      expect(callbackLine).toContain("`state`")
      expect(callbackLine).toContain("`MCPOAuthStateError`")
    }
  })

  test("public model examples use real agent config keys", () => {
    const modelDocs = [
      "packages/web/src/content/docs/models.mdx",
      "packages/web/src/content/docs/zh-cn/models.mdx",
      "packages/web/src/content/docs/providers.mdx",
      "packages/web/src/content/docs/zh-cn/providers.mdx",
    ]

    for (const file of modelDocs) {
      const text = read(file)
      expect(text).not.toMatch(/"planner"\s*:\s*\{\s*"model"/)
      expect(text).not.toMatch(/"assistant"\s*:\s*\{\s*"requirements"\s*:\s*\{\s*"model"/)
      expect(text).toContain('"architect": { "model": "anthropic/claude-sonnet-4-6" }')
    }
  })

  test("command docs use model examples from the current snapshot", () => {
    const snapshot = read("packages/opencorvus/src/provider/models-snapshot.ts")
    const commandDocs = [
      "packages/web/src/content/docs/commands.mdx",
      "packages/web/src/content/docs/zh-cn/commands.mdx",
    ]
    const missing = commandDocs.flatMap((file) => {
      const models = Array.from(read(file).matchAll(/"model": "([^"]+)"/g)).map((match) => match[1]!)
      return models
        .filter((model) => !snapshot.includes(`"${model}":`) && !snapshot.includes(`"id":"${model}"`))
        .map((model) => `${file}: ${model}`)
    })

    expect(missing).toEqual([])
  })

  test("provider and environment docs match current env contracts", () => {
    const files = [
      "packages/web/src/content/docs/reference/env.mdx",
      "packages/web/src/content/docs/zh-cn/reference/env.mdx",
      "packages/web/src/content/docs/providers.mdx",
      "packages/web/src/content/docs/zh-cn/providers.mdx",
      "packages/web/src/content/docs/operations/benchmark.mdx",
      "packages/web/src/content/docs/zh-cn/operations/benchmark.mdx",
      "packages/channel-runtime/.env.example",
      ".env.example",
    ]

    expectFilesNotToContain(files, [
      "CODING_DASHSCOPE_API_KEY",
      "DASHSCOPE_CODING_BASE_URL",
      "DASHSCOPE_INTL_BASE_URL",
      "DASHSCOPE_MAINLAND_BASE_URL",
      "DASHSCOPE_API_URL",
      "DASHSCOPE_API=",
      "OPENCORVUS_DEFAULT_MODEL",
      "OPENCORVUS_MODEL_",
      "STT_PROVIDERS",
      "routed by key prefix",
      "按 key 前缀",
      "按 key 前缀自动路由",
    ])

    for (const file of [
      "packages/web/src/content/docs/reference/env.mdx",
      "packages/web/src/content/docs/zh-cn/reference/env.mdx",
    ]) {
      expect(read(file)).toContain("OPENCORVUS_EXECUTOR_OPENCORVUS_BIN")
      expect(read(file)).toContain("OPENCORVUS_EXECUTOR_CODEX_BIN")
      expect(read(file)).toContain("OPENCORVUS_EXECUTOR_CLAUDE_CODE_BIN")
      expect(read(file)).toContain("DASHSCOPE_API_KEY")
      expect(read(file)).toContain("ALIBABA_CODING_PLAN_API_KEY")
    }
    expect(read(".env.example")).toContain("DASHSCOPE_API_KEY")
    expect(read(".env.example")).toContain("ALIBABA_CODING_PLAN_API_KEY")
    expect(read(".env.example")).not.toContain("GITHUB_TOKEN=")
    expect(read(".env.example")).not.toContain("USE_GITHUB_TOKEN=")
  })

  test("CLAUDE delegates agent rules to AGENTS as the single source", () => {
    const claude = read("CLAUDE.md")
    const agents = read("AGENTS.md")

    expect(claude).toContain("`AGENTS.md` is the single source of truth")
    expect(claude).toContain("Do not copy or fork those rules")
    expect(claude).not.toContain("## 一、核心思维原则")
    expect(claude).not.toContain("**1.**")
    expect(agents).toContain("**4.1（dispatcher 输入缺失信号）**")
    expect(agents).toContain("XML（Extensible Markup Language，可扩展标记语言）")
    expect(agents).not.toContain("\n的 XML 块时")
  })

  test("operator docs do not publish retired browser or package-manager aliases", () => {
    const envDocs = [
      "packages/web/src/content/docs/reference/env.mdx",
      "packages/web/src/content/docs/zh-cn/reference/env.mdx",
    ]
    for (const file of envDocs) {
      expect(read(file)).not.toMatch(/`\s*BROWSER_EXECUTABLE\s*`/)
    }
    expectFilesNotToContain(
      [
        "packages/opencorvus/src/browser/runtime/index.ts",
        "packages/opencorvus/src/mcp/browser/sessions.ts",
        "packages/opencorvus/src/mcp/browser/tools.ts",
        "packages/web/src/content/docs/network.mdx",
        "packages/web/src/content/docs/zh-cn/network.mdx",
        "packages/web/src/content/docs/reference/env.mdx",
        "packages/web/src/content/docs/zh-cn/reference/env.mdx",
      ],
      [["BROWSER", "_PROXY"].join("")],
    )

    for (const file of [
      "README.md",
      "packages/web/src/content/docs/start/install.mdx",
      "packages/web/src/content/docs/zh-cn/start/install.mdx",
    ]) {
      expect(read(file)).not.toContain("curl -fsSL https://opencorvus.ai/install | bash")
      expect(read(file)).not.toContain("npm i -g opencorvus-ai@latest")
      expect(read(file)).not.toContain("npm  i -g opencorvus-ai@latest")
      expect(read(file)).not.toContain("bun i -g opencorvus-ai@latest")
      expect(read(file)).not.toContain("bun  i -g opencorvus-ai@latest")
      expect(read(file)).not.toContain("brew install yangheng95/tap/opencorvus")
      expect(read(file)).not.toContain("scoop install opencorvus")
      expect(read(file)).not.toContain("choco install opencorvus")
    }
    for (const file of [
      "packages/web/src/content/docs/windows-wsl.mdx",
      "packages/web/src/content/docs/zh-cn/windows-wsl.mdx",
    ]) {
      expect(read(file)).toContain("bun run --cwd packages/opencorvus dev -- serve")
      expect(read(file)).not.toMatch(/^bun run dev$/m)
    }
    expect(read("packages/web/config.mjs")).not.toContain("socialCard")
    expect(read("packages/web/src/content/docs/commands.mdx")).not.toContain("OpenCorvus inherits OpenCorvus")
    expect(read("packages/web/src/content/docs/zh-cn/commands.mdx")).not.toContain("OpenCorvus 继承 OpenCorvus")
  })

  test("package README bun run commands point at package scripts", () => {
    const packageReadmes = ["packages/web/README.md"]
    const missingScripts: string[] = []
    const parsedCommands: string[] = []

    for (const readmePath of packageReadmes) {
      for (const command of packageReadmeBunRunCommands(readmePath)) {
        parsedCommands.push(`${readmePath}: ${command.command}`)
        const packageJsonPath = path.join(command.packageDir, "package.json").replace(/\\/g, "/")
        const packageJson = JSON.parse(read(packageJsonPath)) as { scripts?: Record<string, string> }
        if (!packageJson.scripts?.[command.script]) {
          missingScripts.push(`${readmePath}: ${command.command} -> ${packageJsonPath}#scripts.${command.script}`)
        }
      }
    }

    expect(parsedCommands).toContain("packages/web/README.md: bun run --cwd packages/web check")
    expect(missingScripts).toEqual([])
  })

  test("push automation runs hooks and web API docs name the live route source", () => {
    expect(read(".github/workflows/generate.yml")).not.toContain("--no-verify")
    expect(read("script/publish.ts")).not.toContain("--no-verify")
    expect(read("script/beta.ts")).not.toContain("--no-verify")
    expect(read("packages/web/README.md")).toContain(
      "API reference pages are generated from live OpenAPI route metadata by `packages/opencorvus/script/docs/render-api-md.ts`.",
    )
    expect(read("packages/web/README.md")).not.toContain("generated from `packages/sdk/openapi.json`")
  })

  test("server docs list mounted route modules from AppRoutes", () => {
    const appRoutes = read("packages/opencorvus/src/server/routes/app.ts")
    const serverRouteModules = fs
      .readdirSync(path.join(repoRoot, "packages/opencorvus/src/server/routes"))
      .filter((file) => file.endsWith(".ts"))
      .sort()
    const server = read("packages/opencorvus/src/server/server.ts")
    const serverDocs = ["packages/web/src/content/docs/server.mdx", "packages/web/src/content/docs/zh-cn/server.mdx"]

    for (const token of [
      "TerminalRoutes",
      "MissionRoutes",
      "PluginRoutes",
      "BrowserPreviewRoutes",
      "QuickNoteRoutes",
    ]) {
      expect(appRoutes).toContain(token)
    }
    expect(appRoutes).toContain('from "@/quicknote/routes"')
    expect(appRoutes).toContain('.route("/api/v1", QuickNoteRoutes())')
    expect(server).toContain('from "./routes/documentation"')

    for (const file of serverDocs) {
      const text = read(file)
      for (const module of serverRouteModules) {
        expect(text).toContain(`\`${module}\``)
      }
      expect(text).toContain("`packages/opencorvus/src/quicknote/routes.ts`")
      expect(text).toContain("`QuickNoteRoutes`")
      expect(text).toContain("`/api/v1/notes`")
      expect(text).not.toContain("`quick-note.ts`")
    }
  })

  test("public website docs do not pin source references to brittle line numbers", () => {
    const publicDocs = walkTextFiles("packages/web/src/content/docs")
    const lineNumberReference = /[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|md|txt|json|example):\d+(?:-\d+)?/
    const offenders = publicDocs
      .filter((file) => lineNumberReference.test(read(file)))
      .map((file) => `${file}: ${read(file).match(lineNumberReference)?.[0]}`)

    expect(offenders).toEqual([])
    expectFilesNotToContain(publicDocs, [
      "quality gates",
      "quality gate",
      "quality-gate",
      "quality-gates",
      "hard-threshold gates",
    ])
    const zhLsp = read("packages/web/src/content/docs/zh-cn/lsp.mdx")
    expect(zhLsp).not.toContain("静默跳过")
    expect(zhLsp).not.toContain("回退到纯文本 diagnostics")
    expect(zhLsp).toContain("不会为该语言产生 semantic LSP diagnostics")
  })

  test("current architecture chapters do not describe retired live paths as current", () => {
    expectFilesNotToContain(
      [
        "specs/current/architecture/01-agents.md",
        "specs/current/architecture/01-agents.svg",
        "specs/current/architecture/02-data.md",
        "specs/current/architecture/02-data.svg",
        "specs/current/architecture/03-control.md",
        "specs/current/architecture/03-control.svg",
        "specs/current/architecture/04-extensions.md",
        "specs/current/architecture/05-config.md",
        "specs/current/architecture/06-provider.md",
        "specs/current/architecture/07-panel.md",
        "specs/current/architecture/09-verification-evidence.md",
        "specs/current/architecture/11-agent-oop-protocol.md",
        "specs/current/architecture/13-agent-communication-matrix.md",
        "specs/current/architecture/99-principles.md",
      ],
      [
        "src/integrity/agent.ts",
        "packages/opencorvus/src/integrity/agent.ts",
        "Prosecutor / Acceptance",
        "argus =",
        "argus 自身",
        "调用 argus",
        "(overlay, TUI)",
        "overlay · CLI · TUI",
        "routes/tui.ts",
        "goal-pool.ts",
        "pipeline/executor.ts",
        "GoalPool",
        "opencode",
        "dispatch gate",
        "build` tool -> `goal/runner.ts` -> executor",
        "`goal/runner.ts`（worktree + executor 执行体）",
        "由 `goal/runner.ts` 在 worktree 内隔离执行",
        "engine_evaluation",
        "EngineEvaluation",
        "prefetchAcceptanceContext",
        "FrontendCheck.renders_correctly",
        "当前状态：未来方案",
        "状态：方案 / 未落地实现",
        "目标设计",
        '不是"代码现状"',
        "现状真源，2026",
        "P3 清理**未完成**",
        "store.messages` / `store.messagesBySession` —— 数据直接落在 cardTreeStore",
        "utils/card-tree.ts`（类型已迁出）",
        "acceptance evidence decision arbitration",
        "workflow acceptance control",
        "本文档若干细节仍为旧草稿",
        "spec/plan agent",
        "plan_enter",
        "spec_enter",
        "未来协议里的虚拟外部入口",
        "SYS([system_entry])",
        "OOP mailbox/registry",
        "blueprintSummary",
      ],
    )

    const controlChapter = read("specs/current/architecture/03-control.md")
    expect(controlChapter).toContain("共 28 个文件，2026-06-17")
    expect(controlChapter).toContain("routes/pty.ts")
    expect(controlChapter).toContain("routes/browser-preview.ts")
  })

  test("current architecture chapters do not present active contracts as compatibility paths", () => {
    const forbidden = [
      "向后兼容",
      "读取侧做 fallback",
      "做 fallback",
      "完全兼容",
      "历史兜底",
      "P3 前兼容",
      "兼容新字段",
      "git reset --hard",
      "active_run_id gate",
      "success-only gate",
      "启动孤儿清理 gate",
      "manifest conformance gate",
      "每阶段 commit + tag",
      "assistant.acceptance{}",
      "acceptance 多一个 max_retries",
      "Acceptance        max_steps  max_retries",
      "Agent-to-tool include/exclude adaptation protocol",
      "Tool adapters decide visible tools for ordinary agents",
      "数值硬门槛阈值",
      "Phase 2",
      "Phase 5",
      "本方案执行后",
      "workflow: { id, name, currentStep? }",
      "goalWorkflows[].planSteps",
      "`goalRuns`",
    ]
    const offenders = walkTextFiles("specs/current/architecture")
      .filter((file) => file.endsWith(".md"))
      .flatMap((file) => forbidden.filter((token) => read(file).includes(token)).map((token) => `${file}: ${token}`))

    expect(offenders).toEqual([])
  })

  test("current panel architecture is not written as a redesign plan", () => {
    const panel = read("specs/current/architecture/07-panel.md")
    expect(panel).not.toContain("当前 → 重设计 对照")
    expect(panel).not.toContain("配置面板重设计")
    expect(panel).not.toContain("### 新增的面板区域")
    expect(panel).not.toContain("Opacity")
    expect(panel).not.toContain("Always on Top")
    expect(panel).not.toContain("build / acceptance")
    expect(panel).not.toContain("acceptance 等步骤进度")
    expect(panel).not.toContain("`goal.*`")
    expect(panel).toContain("## Current Surface Ownership")
    expect(panel).toContain("## Configuration Panel")
    expect(panel).toContain("workflow.step.updated")
    expect(panel).toContain("goal.workflow.progress")
    expect(panel).toContain("visual_qa / integrity")
  })

  test("current architecture chapters are not dated implementation plans", () => {
    const datedPlanPatterns = [
      /^- 日期：2026-0[1-5]-\d{2}$/m,
      /状态（2026-\d{2}-\d{2}/,
      /实施进度（2026-/,
      /迁移状态（2026-/,
      /2026-\d{2}-\d{2} 新增/,
      /2026-\d{2}-\d{2} 更正/,
    ]
    const offenders = walkTextFiles("specs/current/architecture")
      .filter((file) => file.endsWith(".md"))
      .flatMap((file) =>
        datedPlanPatterns.filter((pattern) => pattern.test(read(file))).map((pattern) => `${file}: ${String(pattern)}`),
      )

    expect(offenders).toEqual([])
  })

  test("tool and UI text use current single-source wording", () => {
    expect(read("packages/opencorvus/src/tool/websearch.txt")).not.toMatch(/fallback/i)
    expect(read("packages/vscode-extension/docs/review-grep.md")).not.toContain("Pre-existing pre-M3")
    expect(read("packages/vscode-extension/docs/review-grep.md")).not.toContain("plan §5.4 followup")
    expect(read("packages/vscode-extension/docs/review-grep.md")).toContain("Overlay services have 0")
    expect(read("packages/opencorvus/src/tool/webfetch.txt")).not.toContain("DEPRECATED")
    expect(read("packages/opencorvus/src/tool/webfetch.txt")).not.toContain("as a fallback")
    expect(read("packages/opencorvus/src/tool/webfetch.ts")).not.toContain("fallbacks")
    expect(read("packages/opencorvus/script/benchmark/visual-diff.ts")).not.toContain("chrome-cli-fallback")
    expect(read("packages/opencorvus/src/prompt/core/frontend-design-core.txt")).not.toContain(
      "computed-style fallback rules",
    )
    expect(read("packages/opencorvus/src/frontend-design/schema.ts")).not.toContain("Legacy compatibility summary only")
    expect(read("packages/opencorvus/src/frontend-design/agent.ts")).not.toContain("legacy compatibility summary")
    expect(read("packages/opencorvus/src/orchestrator/tools.ts")).not.toContain("Legacy compatibility field only")
    expect(read("packages/opencorvus/src/orchestrator/tools.ts")).not.toContain("reuse/library/fallback plan")
    expect(read("packages/opencorvus/src/web-clone/source-skeleton.ts")).not.toContain("computed-style fallback rules")
    expect(read("packages/opencorvus/src/web-clone/source-skeleton.ts")).toContain("computed-style evidence rules")
    expect(read("packages/opencorvus/src/web-clone/handoff.ts")).not.toContain("fall back to page.ir.json")
    expect(read("packages/opencorvus/src/tool/bash.txt")).not.toContain("Only create commits when requested")
    expect(read("packages/opencorvus/src/tool/bash.txt")).not.toContain("DO NOT push")
    expect(read("packages/opencorvus/src/tool/task.txt")).not.toContain("Start at most one fresh")
    expect(read("packages/opencorvus/src/tool/task.txt")).not.toContain("generally be trusted")
    expect(read("packages/opencorvus/src/goal-workload-analyst/prompt.ts")).not.toContain("fallback / supplement")
    expect(read("packages/opencorvus/src/goal-workload-analyst/output-tools.ts")).not.toContain("fallbackSummary")
    expect(read("script/package-local.ts")).not.toContain("build:overlay:docker")
    expect(read("script/package-local.ts")).not.toContain("skipping Linux overlay builds")
    expect(read("docs/packaging.md")).not.toContain("Older local aggregate")
    expect(read("docs/packaging.md")).not.toContain("latest local package run produced")
    expect(read("docs/packaging.md")).not.toContain("172 MiB")
    expect(read("docs/packaging.md")).not.toContain("171 MiB")
    expect(read("docs/packaging.md")).toContain("Linux Binary Smoke Expectations")
    expect(read("packages/overlay/src/services/default-server.ts")).not.toContain("legacyPrefixed")
    expect(read("packages/overlay/src/services/diff.ts")).not.toContain("fetchVcsDiffs")
    expect(read("packages/overlay/src/services/diff.ts")).not.toContain("normalizeVcsDiffs")
    expect(read("packages/overlay/src/services/diff.ts")).not.toContain("stub FileChange")
    expect(read("packages/overlay/test/diff-resolve-inflight-cache.test.ts")).not.toContain("vcs-backfill")
    expect(read("specs/records/2026-06/2026-06-05-diff-preview-vcs-fallback-plan.md")).toContain("Status: Superseded")
    expect(read("packages/opencorvus/script/screenshot-overlay.ts")).not.toContain("script/screenshot.ts")
    expect(read("packages/opencorvus/script/verify-executor-shim.ts")).not.toContain("SPA fallback")
    expect(read("packages/opencorvus/script/benchmark/audit-calculator.ts")).not.toContain(
      "fallback: largest text block",
    )
    expect(read("packages/opencorvus/script/benchmark/env.ts")).not.toContain("Provider.defaultModel")
    expect(read("packages/opencorvus/script/benchmark/env.ts")).toContain(
      "benchmark model must be configured explicitly",
    )
    expect(read("packages/overlay/src/utils/transcript.ts")).not.toContain("goal_fallback")
    expect(read("packages/overlay/src/i18n/en-US.json")).not.toContain("evaluation.context.goal_fallback")
    expect(read("packages/overlay/src/i18n/zh-CN.json")).not.toContain("evaluation.context.goal_fallback")
    expect(read("packages/overlay/src/i18n/en-US.json")).toContain("Missing goal #{{index}}")

    const inspectScripts = [
      "script/inspect-goal-stalls.ts",
      "script/inspect-g3g4-stalls.ts",
      "script/inspect-task.ts",
      "script/inspect-submit.ts",
      "script/inspect-orch-errors.ts",
    ]
    expectFilesNotToContain(inspectScripts, ["D:/myhexin-local/argus", "~/.local/state/argus", "tsk_", "gol_", "ses_"])
    for (const file of inspectScripts) {
      expect(read(file)).toContain('requiredEnv("OPENCORVUS_DB")')
    }

    expect(fs.existsSync(path.join(repoRoot, "packages/opencorvus/src/prompt/information-missing.ts"))).toBe(false)
    expectFilesNotToContain(
      [
        "packages/opencorvus/src/agent/runner.ts",
        "packages/opencorvus/src/orchestrator/agent.ts",
        "packages/opencorvus/src/engine/config.ts",
        "packages/opencorvus/src/config/config.ts",
        "packages/overlay/src/components/settings/GeneralPanel.tsx",
        "packages/overlay/src/i18n/en-US.json",
        "packages/overlay/src/i18n/zh-CN.json",
      ],
      [
        ["INFORMATION", " MISSING"].join(""),
        ["<INFORMATION", " MISSING>"].join(""),
        ["fail_on_", "information_missing"].join(""),
        ["settings-fail-on-", "information-missing"].join(""),
        ["appendInformation", "MissingDiagnostic"].join(""),
        ["INFORMATION_", "MISSING_DIAGNOSTIC_TEXT"].join(""),
        ["messageHasInformation", "Missing"].join(""),
        ["extractInformation", "MissingBlock"].join(""),
        ["buildInformation", "MissingError"].join(""),
      ],
    )
  })

  test("runtime API schemas and generated clients do not publish retired compatibility fields", () => {
    expectFilesNotToContain(
      [
        "packages/opencorvus/src/orchestrator/tools.ts",
        "packages/opencorvus/src/acceptance/types.ts",
        "packages/opencorvus/src/architect/output-tools.ts",
        "packages/opencorvus/src/worktree/index.ts",
        "packages/opencorvus/src/provider/provider.ts",
        "packages/opencorvus/src/config/config.ts",
        "packages/sdk/openapi.json",
        "packages/sdk/js/src/gen/sdk.gen.ts",
        "packages/sdk/js/src/gen/types.gen.ts",
      ],
      [
        "FrontendDesignLegacyUrlField",
        "Deprecated — use `urls`",
        "backward compatibility",
        "Backward-compatible",
        "goal_run_id via session_id",
        "on_acceptance is legacy",
        '"on_acceptance"',
        "Deprecated. Worktree.create always waits",
        'checkout?: "sync" | "async"',
        "Deprecated compatibility field",
        "resumed: z.boolean()",
        "Retained for API compatibility",
        "void input.hooks",
        ["goal", "_gate"].join(""),
        ["final", "Gate"].join(""),
        ["Acceptance", "Gate", "Verdict"].join(""),
        ["arbitrate", "Acceptance", "Gate"].join(""),
        'status: z.enum(["alpha", "beta", "deprecated", "active"])',
        'status?: "alpha" | "beta" | "deprecated"',
        'status: "alpha" | "beta" | "deprecated" | "active"',
      ],
    )

    expect(read("packages/opencorvus/src/orchestrator/tools.ts")).toContain("goal_run_id")
    expect(fs.existsSync(path.join(repoRoot, ["packages/opencorvus/src/acceptance/checks/project-", "gate.ts"].join("")))).toBe(false)
    expectFilesNotToContain(
      [
        "packages/opencorvus/src/acceptance/arbiter.ts",
        "packages/opencorvus/src/acceptance/manifest.ts",
        "packages/opencorvus/src/acceptance/checks/project-assessment.ts",
        "packages/opencorvus/src/workbench/board.ts",
        "packages/opencorvus/test/acceptance/arbiter.test.ts",
        "packages/opencorvus/test/acceptance/project-assessment.test.ts",
      ],
      [
        ["Acceptance", "Gate"].join(""),
        ["acceptance ", "gate"].join(""),
        ["Evidence ", "gate"].join(""),
        ["final", "Gate"].join(""),
        "final gate",
        "publish gate",
        "publish_gate",
        "publisher gate",
        "publisher-acceptance-gate",
        ["project-", "gate"].join(""),
      ],
    )
    expect(read("packages/opencorvus/src/acceptance/types.ts")).toContain('z.enum(["on_goal", "on_integrity"])')
    expect(read("packages/opencorvus/src/worktree/index.ts")).not.toContain("checkout: z")
    expect(read("packages/opencorvus/src/provider/models.ts")).toContain(
      'status: z.enum(["alpha", "beta", "deprecated"]).optional()',
    )
    expect(read("packages/opencorvus/src/provider/provider.ts")).toContain(
      '.filter(([, model]) => model.status !== "deprecated")',
    )
    expect(read("packages/opencorvus/src/provider/provider.ts")).not.toContain(
      'if (model.status === "deprecated") delete provider.models[modelID]',
    )
    expect(read("packages/opencorvus/src/config/config.ts")).toContain('status: z.enum(["alpha", "beta"]).optional()')
    expect(read("packages/opencorvus/src/acceptance/checks/types.ts")).not.toContain("legacy acceptance evidence")
    expect(read("packages/opencorvus/test/acceptance/arbiter.test.ts")).not.toContain(
      "legacy acceptance evidence arbiter",
    )
    expect(read("packages/overlay/test/tree-writer-integrity-review.test.ts")).not.toContain(
      "legacy acceptance evidence",
    )
    expect(read("packages/opencorvus/src/config/config.ts")).not.toContain("Chunk-driven inactivity gates")
    expect(read("packages/sdk/openapi.json")).not.toContain("Chunk-driven inactivity gates")
    expect(read("packages/sdk/js/src/gen/types.gen.ts")).not.toContain("Chunk-driven inactivity gates")
  })

  test("channel runtime speech and Discord contracts do not retain fallback paths", () => {
    expectFilesNotToContain(
      [
        "packages/channel-runtime/src/stt/pipeline.ts",
        "packages/channel-runtime/src/main.ts",
        "packages/opencorvus/src/channel/supervisor.ts",
        "packages/channel-runtime/src/adapters/discord.ts",
        "packages/channel-runtime/src/adapters/feishu.ts",
        "packages/channel-runtime/test/feishu-adapter.test.ts",
      ],
      [
        "fallback chain",
        "falling back through providers",
        "trying next",
        "All providers failed",
        "best-effort",
        "fall back to a plain send",
        "retry without the reply reference",
        "falls back to chat send",
      ],
    )

    expect(read("packages/channel-runtime/src/stt/types.ts")).toContain("provider: string")
    expect(read("packages/channel-runtime/src/stt/setup.ts")).toContain(
      "Set STT_PROVIDER to one speech-to-text provider",
    )
    expect(read("packages/channel-runtime/src/main.ts")).toContain("createConfiguredSTT(process.env)")
    expect(read("packages/opencorvus/src/channel/supervisor.ts")).toContain("createConfiguredSTT(env)")
    expect(read("packages/opencorvus/src/channel/supervisor.ts")).not.toContain("createConfiguredSTT(process.env)")
  })

  test("current helper contracts do not describe active behavior as legacy fallback", () => {
    expectFilesNotToContain(
      [
        "packages/opencorvus/src/worktree/index.ts",
        "packages/opencorvus/src/acceptance/arbiter.ts",
        "packages/opencorvus/src/metrics/metrics.sql.ts",
        "packages/opencorvus/src/metrics/store.ts",
        "packages/opencorvus/src/metrics/score.ts",
        "packages/opencorvus/src/metrics/types.ts",
        "packages/opencorvus/src/storage/schema.ts",
        "packages/opencorvus/src/id/id.ts",
        "packages/overlay/src/components/Board.tsx",
        "packages/overlay/src/components/ChatComposer.tsx",
        "packages/overlay/src/components/InteractionCard.tsx",
        "packages/overlay/src/utils/card-tree.ts",
        "packages/overlay/src/services/diff.ts",
        "packages/overlay/src/services/tree-writer.ts",
        "packages/overlay/src/styles/surfaces/card.css",
        "packages/overlay/src/styles/surfaces/inspector.css",
        "packages/overlay/src/styles/surfaces/field.css",
        "packages/overlay/src/styles/surfaces/conversation.css",
        "packages/opencorvus/src/session/message.ts",
        "packages/opencorvus/src/server/routes/orchestrator.ts",
        "packages/opencorvus/src/storage/attachment-store.ts",
        "packages/opencorvus/test/storage/attachment-display-filename.test.ts",
        "packages/opencorvus/test/storage/attachment-stage.test.ts",
        "packages/sdk/openapi.json",
        "packages/sdk/js/src/gen/types.gen.ts",
      ],
      [
        "passed-verdict-without-merge_back",
        "validity gate",
        "falling through to reclaim",
        "<Show when={false}>",
        "composeAcceptanceDecision",
        "HostGateResult",
        "EngineCounterexampleTable",
        "readCounterexamplesForTask",
        "CounterexampleSeverity",
        "CounterexampleTargetScope",
        'counterexample: "cex"',
        "engine_counterexample",
        "InteractionCardList",
        "interaction-card-list",
        "criteria-panel",
        "criteria-family",
        "shouldPromoteTool",
        "export function currentChanges(",
        "legacy render heuristic retained",
        "compatibility with older callers",
        "assistant fallback",
        "Flattened view of currentChangeGroups() for legacy callers",
        "Fallback ladder",
        "falls back to attachment-<i>-<sha8>.<ext>",
        "falls back to a sha",
        "re-inventing the fallback",
        "filename ?? sha` fallback",
        "Structural validity gate",
      ],
    )

    expect(fs.existsSync(path.join(repoRoot, "packages/opencorvus/src/acceptance/verdict.ts"))).toBe(false)
    expect(fs.existsSync(path.join(repoRoot, "packages/overlay/src/components/EvaluationCriteriaPanel.tsx"))).toBe(
      false,
    )
    expect(fs.existsSync(path.join(repoRoot, "packages/overlay/src/utils/criteria.ts"))).toBe(false)
    expectFilesNotToContain(
      [
        "packages/opencorvus/src/executor/discovery.ts",
        "packages/opencorvus/src/executor/runtime-env.ts",
        "packages/opencorvus/src/pty/index.ts",
        "packages/opencorvus/src/server/routes/pty.ts",
        "packages/opencorvus/test/e2e/full-pipeline.test.ts",
        "packages/opencorvus/test/planner/pre-analysis.test.ts",
        "packages/opencorvus/test/planner/pre-analysis-eval.test.ts",
        "packages/opencorvus/test/project/vcs.test.ts",
        "packages/opencorvus/test/server/pty-routes.test.ts",
        "packages/overlay/src/store/settings.ts",
        "packages/overlay/test/executor-settings.test.ts",
      ],
      ["opencode", "Copied from OpenCode", "packages/opencode/src/pty", "packages/opencode/src/server/routes/pty"],
    )
    expectFilesNotToContain(
      ["packages/web/src/content/docs/reference/sdk.mdx", "packages/web/src/content/docs/zh-cn/reference/sdk.mdx"],
      ["OpenCode", "opencode"],
    )
    expect(fs.existsSync(path.join(repoRoot, "packages/opencorvus/src/frontend-design/reference-capture.ts"))).toBe(
      true,
    )
    expect(fs.existsSync(path.join(repoRoot, "packages/opencorvus/src/frontend-design/capture-gate.ts"))).toBe(false)
    expect(fs.existsSync(path.join(repoRoot, "packages/opencorvus/test/frontend-design/capture-gate.test.ts"))).toBe(
      false,
    )
    expectFilesNotToContain(
      [
        "packages/opencorvus/src/acceptance/checks/content-fingerprint.ts",
        "packages/opencorvus/src/frontend-design/url-screenshot-tool.ts",
        "packages/opencorvus/src/util/pixel-stats.ts",
        "packages/opencorvus/test/frontend-design/reference-capture.test.ts",
      ],
      ["capture-gate"],
    )
    expectFilesNotToContain(
      ["packages/overlay/src/services/tree-writer.ts"],
      [
        "source?.time ?? card.time ?? 0",
        "time?: number\n  sessionID?: string",
        "phase card is stubbed",
        "observation time",
        "missing emittedAt/timestamp for display message ordering",
      ],
    )
    expect(read("packages/overlay/src/utils/workflow-step.ts")).not.toContain("session card floats top-level")
    expect(read("packages/overlay/src/store/card-tree.ts")).not.toContain("build / planner / goal")
    expect(read("packages/opencorvus/src/acceptance/visual-metric.ts")).not.toContain("VisualGateResult")
    expect(read("packages/opencorvus/src/acceptance/visual-metric.ts")).not.toContain("gates:")
    expectFilesNotToContain(
      ["packages/opencorvus/src/acceptance/checks/types.ts"],
      [
        "manifestGate",
        "hostGateFailures",
        "manifestFailureDetails",
        "manifestFailures",
        "runtimeEvidenceFailures",
        "visualMetricFailures",
      ],
    )
    const executorRuntimeEnv = read("packages/opencorvus/src/executor/runtime-env.ts")
    expect(executorRuntimeEnv).toContain("ExecutorName.parse(id)")
    expect(executorRuntimeEnv).not.toContain(" | string")

    const contentFingerprint = read("packages/opencorvus/src/acceptance/checks/content-fingerprint.ts")
    expect(contentFingerprint).toContain("regionIouThreshold: number")
    expect(contentFingerprint).toContain("content fingerprint regionIouThreshold must be in (0, 1]")
    expect(contentFingerprint).not.toContain("regionIouThreshold?: number")
    expect(contentFingerprint).not.toContain("?? 0.4")

    const visualPage = read("packages/opencorvus/src/runtime/visual-page.ts")
    expect(visualPage).toContain("threshold: number")
    expect(visualPage).toContain("worstThreshold: number")
    expect(visualPage).toContain("browserLaunchTimeoutMs: number")
    expect(visualPage).toContain("navigationTimeoutMs: number")
    expect(visualPage).toContain("settleMs: number")
    expect(visualPage).toContain("checks: { meanPassed: boolean; worstPassed: boolean; runtimePassed: boolean }")
    expect(visualPage).toContain("runVisualDiff: invalid browserLaunchTimeoutMs")
    expect(visualPage).toContain("runVisualDiff: invalid navigationTimeoutMs")
    expect(visualPage).toContain("runVisualDiff: invalid settleMs")
    expect(visualPage).not.toContain("opts.threshold ?? 0.85")
    expect(visualPage).not.toContain("opts.worstThreshold ?? 0.55")
    expect(visualPage).not.toContain("browserLaunchTimeoutMs?: number")
    expect(visualPage).not.toContain("navigationTimeoutMs?: number")
    expect(visualPage).not.toContain("settleMs?: number")
    expect(visualPage).not.toContain("input.navigationTimeoutMs ?? 90_000")
    expect(visualPage).not.toContain("input.settleMs ?? 2_500")
    expect(visualPage).not.toContain("gate: {")
    expect(visualPage).not.toContain(".gate")

    const executorActivityFiles = [
      "packages/opencorvus/src/util/stream-activity.ts",
      "packages/opencorvus/src/executor/protocol/json-rpc.ts",
      "packages/opencorvus/src/executor/bootstrap.ts",
      "packages/opencorvus/src/executor/codex-app-server.ts",
      "packages/opencorvus/src/session/status.ts",
      "packages/opencorvus/src/session/prompt/state.ts",
      "packages/opencorvus/src/session/processor.ts",
      "packages/opencorvus/src/llm/activity.ts",
      "packages/opencorvus/src/build/agent.ts",
      "packages/opencorvus/src/util/event-queue.ts",
      "packages/opencorvus/test/util/stream-activity.test.ts",
      "packages/opencorvus/test/llm/activity.test.ts",
      "packages/opencorvus/test/session/extra-tools.test.ts",
    ]
    expectFilesNotToContain(executorActivityFiles, [
      "StreamActivityGate",
      "requestGate",
      "idle gate",
      "per-call gates",
      "registerActivityGate",
      "abortActivityGate",
      "activityGates",
    ])
    expect(read("packages/opencorvus/src/util/stream-activity.ts")).toContain("StreamActivityMonitor")
    expect(read("packages/opencorvus/src/session/status.ts")).toContain("registerActivityMonitor")
    expect(read("packages/opencorvus/src/executor/protocol/json-rpc.ts")).toContain("requestActivityMonitor")

    const conversationAgents = read("packages/overlay/src/store/conversation-agents.ts")
    expect(conversationAgents).toContain("rawStage")
    expect(conversationAgents).toContain("renderedTargetForPhaseSession(session, rawStage)")
    expect(conversationAgents).toContain("stage: record.rawStage || record.stage")
    expect(read("packages/overlay/src/services/tree-writer.ts")).not.toContain(
      'normalizeAgentRole(normalizedStage) === "executor"',
    )
  })

  test("root curl installer does not hide download failures behind a second path", () => {
    const text = read("install")
    expect(text).not.toContain("Fallback to standard curl")
    expect(text).not.toContain("|| ! download_with_progress")
    expect(text).toContain('download_with_progress "$url" "$tmp_dir/$filename"')
  })

  test("maintenance inspection scripts require explicit operator inputs", () => {
    const scripts = [
      "packages/opencorvus/script/benchmark/probe-task.ts",
      "packages/opencorvus/script/benchmark/review-deliverable.ts",
      "packages/opencorvus/script/mission-e2e.ts",
      "packages/opencorvus/script/replay-compaction-errors-validator.ts",
    ]

    expectFilesNotToContain(scripts, [
      "C:/Users/",
      "C:\\Users\\",
      "D:\\\\myhexin-local\\\\demos\\\\superchart",
      "tsk_dd2e4f471001WMxg1Oe23Pu3bA",
      "ses_1a65b06e4ffenN44slTAUds19S",
      "msg_e59aa9d68001NVVmrF2nPj9mrO",
      "opencorvus-overlay-benchmark-project-w5RoTK",
      "http://localhost:3000",
      "Scratch:",
      "Delete after use",
    ])

    expect(read("packages/opencorvus/script/benchmark/probe-task.ts")).toContain('requiredEnv("OPENCORVUS_DB")')
    expect(read("packages/opencorvus/script/benchmark/probe-task.ts")).toContain('requiredEnv("OPENCORVUS_TASK_ID")')
    expect(read("packages/opencorvus/script/mission-e2e.ts")).toContain('requiredEnv("MISSION_PROJECT_DIR")')
    expect(read("packages/opencorvus/script/replay-compaction-errors-validator.ts")).toContain(
      'requiredEnv("OPENCORVUS_DB")',
    )
    expect(read("packages/opencorvus/script/replay-compaction-errors-validator.ts")).toContain(
      'requiredEnv("SESSION_ID")',
    )
    expect(read("packages/opencorvus/script/replay-compaction-errors-validator.ts")).toContain(
      'requiredEnv("COMPACTION_MESSAGE_ID")',
    )
    const reviewDeliverable = read("packages/opencorvus/script/benchmark/review-deliverable.ts")
    expect(reviewDeliverable).toContain("function requiredArg")
    expect(reviewDeliverable).toContain('page.on("response"')
    expect(reviewDeliverable).toContain('page.on("requestfailed"')
    expect(reviewDeliverable).toContain("runtime/network error(s)")
    expect(reviewDeliverable).toContain("throw new Error(message)")
  })

  test("mission E2E script fails smoke verification instead of logging success", () => {
    const source = read("packages/opencorvus/script/mission-e2e.ts")

    expect(source).toContain('throw new Error("Mission E2E inactivity timeout")')
    expect(source).toContain("MISSION_E2E_CANCEL_SETTLE_TIMEOUT_MS")
    expect(source).toContain("Mission E2E loop did not settle after inactivity cancellation")
    expect(source).toContain("if (loopErr) throw loopErr")
    expect(source).toContain("Mission E2E verification failed")
    expect(source).toContain('await fs.readFile(path.join(stateDir, f), "utf8")')
    expect(source).not.toContain("LOOP ERROR:")
    expect(source).not.toContain("<MISSING:")
  })

  test("maintenance sync and cache-probe scripts do not hide machine defaults", () => {
    expect(read("script/sync-host-wsl.ps1")).not.toContain("/home/yangheng/myhexin-local/opecorvus")
    expect(read("AGENTS.md")).toContain("-WslRoot /home/<wsl-user>/myhexin-local/opecorvus")

    expect(read("packages/opencorvus/script/cache-probe/hexin-cache-probe.ts")).not.toContain(
      "aimemodeldev.myhexin.com/litellm/v1",
    )
    expect(read("packages/opencorvus/script/cache-probe/trace-aisdk-wire.ts")).not.toContain(
      "aimemodeldev.myhexin.com/litellm/v1",
    )
    expect(read("packages/opencorvus/script/cache-probe/hexin-cache-probe.ts")).toContain(
      'requiredEnv("HEXIN_OPENAI_URL")',
    )
    expect(read("packages/opencorvus/script/cache-probe/trace-aisdk-wire.ts")).toContain(
      'requiredEnv("HEXIN_OPENAI_URL")',
    )
    expect(read("packages/opencorvus/script/cache-probe/hexin-cache-probe.ts")).not.toContain("const defaultOut")
    expect(fs.existsSync(path.join(repoRoot, "packages/opencorvus/script/cache-probe/out"))).toBe(false)
  })

  test("tracked example visual checks are not bound to one developer machine", () => {
    const visualCheck = read("examples/tradingview-world-economy/test/visual-check.mjs")
    const server = read("examples/tradingview-world-economy/server.mjs")

    expect(visualCheck).not.toContain("packages/overlay/node_modules/playwright")
    expect(visualCheck).not.toContain("C:/Program Files")
    expect(visualCheck).not.toContain("chrome.exe")
    expect(visualCheck).not.toContain("const port = 4197")
    expect(visualCheck).toContain('PORT: "0"')
    expect(visualCheck).toContain('createRequire(new URL("../../../packages/overlay/package.json", import.meta.url))')
    expect(server).toContain("server.address()")
  })

  test("current overlay and repo-hygiene tests do not encode one developer profile path", () => {
    const files = [...walkTextFiles("packages/overlay/test"), "packages/opencorvus/test/project/no-nested-git.test.ts"]
    expectFilesNotToContain(files, ["C:/Users/chuan", "C:\\Users\\chuan"])
    expect(read(".gitignore")).toContain("packages/overlay/src-tauri/target-codex-repaired/")
  })

  test("overlay fixtures use current skill mounts and conversation hydrate contracts", () => {
    const offenders = walkTextFiles("packages/overlay/test").flatMap((file) => {
      const text = read(file)
      const matches: string[] = []
      const checks: Array<[string, RegExp]> = [
        ["retired /skill/mounts grouped payload", /\/skill\/mounts[^\n]*(built_in|managed|source)/],
        ["retired /skill/mounts empty object", /\/skill\/mounts[^\n]*return (?:send|json)\(\{\}\)/],
        ["retired /skill/mounts empty array", /\/skill\/mounts[^\n]*return (?:send|json|void ok)\(\[\]\)/],
        ["retired /skill/mounts installed rows as pool rows", /\/skill\/mounts[\s\S]{0,300}skills:\s*data\.skills/],
        ["retired board lane goal mutation", /data\.board\.lanes|lane\.cards/],
        ["retired non-empty board lanes fixture", /\blanes:\s*\[\s*\{/],
        ["retired non-empty lane cards fixture", /\bcards:\s*\[\s*\{/],
        ["retired per-run step card id", /step:goal:[^"'`\s]+:run:/],
        ["retired execute title", /title:\s*"Execute"/],
        ["retired per-attempt step-card comment", /per-attempt step card scoping/],
        ["conversation session row uses message-domain order key", /orderKey\("message", now - 19_000, "session-1"\)/],
        [
          "retired conversation card-tree view",
          /(?:view|agentView): \{(?=[\s\S]{0,360}?rootID:\s*"root")(?=[\s\S]{0,360}?cards:\s*\{\})(?=[\s\S]{0,360}?order:\s*\[\])/,
        ],
        ["conversation view missing messages/topLevelSessionIDs", /view: \{ (?:sessions|messages): \[\] \}/],
        ["agent conversation view missing messages/topLevelSessionIDs", /agentView: \{ sessions: \[\] \}/],
        ["conversation messageWatermark null", /messageWatermark: null/],
        ["conversation session time fallback", /const firstTime = first\?\.info\.time\.created \?\? 0/],
        ["conversation session stage fallback", /stage: first\?\.info\.resolvedRole \?\? "assistant"/],
        ["conversation top-level session parent fallback", /topLevelSessionIDs = viewSessions[\s\S]{0,120}!session\.parentSessionID/],
        ["conversation view source optional-created zero fallback", /Number\(info\?\.time\?\.created \|\| 0\)/],
        ["conversation view message zero-time fallback", /Number\(info\.time\?\.created \|\| 0\)/],
        ["conversation view optional-created zero fallback", /info\.time\?\.created[ \t]*(?:\?\?|\|\|)[ \t]*0/],
        ["conversation optional-created zero fallback", /info\?\.time\?\.created[ \t]*(?:\?\?|\|\|)[ \t]*0/],
        ["conversation rail live message default time", /info\?\.time\?\.created\s*\|\|\s*1_779_100_000_000/],
        ["conversation rail literal default created time", /time:\s*\{\s*created:\s*1_779_100_000_000\s*\},\s*\.\.\.info/],
        ["conversation message time zero fallback", /message\?\.time[ \t]*(?:\?\?|\|\|)[ \t]*0/],
        ["conversation observed time zero fallback", /firstObservedAt\s*\?\?\s*firstMessageTime\s*\?\?\s*0/],
        ["conversation part time T0 fallback", /Number\(part\.time\?\.created \|\| 0\) \|\| T0/],
        ["tree writer message token message time default", /input\.messageTime\s*\|\|\s*T0/],
        ["tree writer message token part time parent default", /input\.partTime\s*\|\|\s*messageTime/],
        ["fixture task time default fallback", /Number\(task\?\.time\?\.created \|\| 1\)/],
        ["fixture board order uses parent task time", /boardOrderKey\([^\n]*taskCreated/],
        ["fixture goal time uses task fallback", /goal\?\.time\?\.created \|\| taskCreated/],
        ["fixture step time uses goal fallback", /step\?\.startedAt \|\| step\?\.completedAt \|\| goalCreated/],
        ["fixture phase time uses step fallback", /phase\?\.startedAt \|\| phase\?\.completedAt \|\| stepTime/],
        ["fixture phase time uses started fallback", /phase\?\.startedAt \|\| stepStarted/],
        ["fixture interaction time uses task fallback", /interaction\?\.time\?\.created \|\| taskCreated/],
        ["screenshot fixture hard-codes goal-phase top-level session", /topLevelSessionIDs:\s*\[SCREENSHOT_BUILD_SESSION_ID\]/],
      ]
      for (const [label, pattern] of checks) {
        if (pattern.test(text)) matches.push(`${file}: ${label}`)
      }
      const goalPhaseSessionIDs = new Set(
        Array.from(
          text.matchAll(/sessionID:\s*"([^"]+)"(?:(?!sessionID:)[\s\S]){0,360}placement:\s*"goal_phase"/g),
          (match) => match[1],
        ),
      )
      for (const sessionID of goalPhaseSessionIDs) {
        const listedTopLevel = new RegExp(
          `topLevelSessionIDs:\\s*\\[[^\\]]*"${sessionID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^\\]]*\\]`,
        )
        if (listedTopLevel.test(text)) matches.push(`${file}: goal-phase session listed as top-level ${sessionID}`)
      }
      return matches
    }).concat(
      walkTextFiles("packages/overlay/test").flatMap((file) =>
        conversationViewTopLevelOffenders(file, read(file)),
      ),
    )

    expect(offenders).toEqual([])
    const controls = read("packages/overlay/test/browser/controls.test.ts")
    expect(controls).toContain("data.board.goalWorkflows.push")
    expect(controls).toContain("const skillPool")
    expect(controls).toContain("mounted_agents")
    expect(controls).toContain("unmounted")
    expect(controls).toContain('domain === "session"')
    expect(controls).toContain("? 50")
    expect(controls).toContain('domain === "board_goal"')
    expect(controls).toContain("? 60")
    expect(controls).toContain('domain === "board_step"')
    expect(controls).toContain("? 61")
    expect(controls).toContain('orderKey("interaction", now - 5_000, "interaction-1")')
    expect(controls).toContain('orderKey("session", now - 19_000, "session-1")')
    expect(controls).toContain('goalLoopStepIDs: ["build"]')
    expect(controls).toContain('stepID: "build"')
    expect(controls).toContain('label: "Executor"')

    const screenshotFixture = read("packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts")
    expect(screenshotFixture).toContain(
      '.filter((session) => session.placement === "top_level" && session.messageIDs.length > 0)',
    )

    const agentCompact = read("packages/overlay/test/browser/agent-compact-visual-stress.test.ts")
    expect(agentCompact).toContain("const browserErrors = installBrowserErrorCollector")
    expect(agentCompact).toContain("browserErrors.assertNoUnexpectedErrors()")

    const model = read("packages/opencorvus/src/engine/model.ts")
    expect(model).toContain("goalRunID: z.string().optional()")
    expect(model).toContain("acceptanceSpecs: AcceptanceSpecSchema.array().optional()")
    expect(model).toContain('ReviewStreamPhase = z.literal("integrity")')
    expect(model).not.toContain('ReviewStreamPhase = z.enum(["integrity", "acceptance"])')

    expect(read("packages/opencorvus/src/review/stream.ts")).toContain('export type ReviewStreamPhase = "integrity"')
    expect(read("packages/opencorvus/src/review/stream.ts")).not.toContain("reviewIDForAcceptance")
    expect(read("packages/sdk/js/src/gen/types.gen.ts")).not.toContain('phase: "integrity" | "acceptance"')
    const openApi = read("packages/sdk/openapi.json")
    for (const schemaName of [
      '"Event.review.stream.started"',
      '"Event.review.stream.progress"',
      '"Event.review.stream.chunk"',
    ]) {
      const schemaStart = openApi.indexOf(schemaName)
      expect(schemaStart).toBeGreaterThanOrEqual(0)
      const nextEventSchema = openApi.indexOf('\n      "Event.', schemaStart + schemaName.length)
      const schemaText = openApi.slice(schemaStart, nextEventSchema === -1 ? undefined : nextEventSchema)
      expect(schemaText).toContain('"const": "integrity"')
      expect(schemaText).not.toContain('"acceptance"')
    }

    const panel = read("specs/current/architecture/07-panel.md")
    for (const token of [
      "lastSequence?: number",
      "snapshotVersion: string",
      "candidateAcceptance?: Acceptance",
      "acceptedAcceptance?: Acceptance",
      "channels: TaskChannelBinding[]",
      "criteriaResults?: EvaluationCheck[]",
      "orderKey: string",
      "skippable: boolean",
      "phases?: Array",
      "workspaceDir?: string",
      "workspaceBranch?: string",
      "buildSessionID?: string",
      "changedFiles?: string[]",
      "diffStats?: { files?: number, additions?: number, deletions?: number }",
      "buildOutcome?:",
      "checks?: Array",
      "evalSummary?: string",
      "verdict?: string",
      "contracts?: Array",
    ]) {
      expect(panel).toContain(token)
    }

    const cardIdentityFiles = [
      "specs/current/architecture/07-panel-reactivity.md",
      "specs/current/architecture/07-panel.md",
      "packages/opencorvus/src/workbench/board.ts",
      "packages/overlay/src/store/card-tree.ts",
      "packages/overlay/src/services/tree-writer.ts",
      "packages/overlay/src/utils/workflow-step.ts",
      "packages/opencorvus/src/engine/workflow.ts",
      "packages/overlay/test/tree-writer-hierarchy.test.ts",
      "packages/overlay/test/browser/controls.test.ts",
      "packages/overlay/test/agent-workflow-panel.test.ts",
      "packages/overlay/test/fixtures/goal-phase-events.ts",
    ]
    expectFilesNotToContain(cardIdentityFiles, [
      "goal-group:<goalID>:step:<stepID>",
      "goal-group:<goalID>:step:<stepID>:phase:<phaseID>",
      ["step:<goalID>:<", "goalRunID|", '"pre"', ">:<stepID>"].join(""),
      ["step:<goalID>:<", "goalRunID | ", '"pre"', ">:<stepID>"].join(""),
      ["per-", "attempt"].join(""),
      ["pre-", "attempt"].join(""),
      ["Phase", " B"].join(""),
      ["Phase", " E"].join(""),
      ["M2", "b"].join(""),
      ["M2", "c"].join(""),
      ["M2", "d"].join(""),
      ["GoalWorkflowGroup", ".plan"].join(""),
      ["plan ", "· execute · eval"].join(""),
      ["Plan", "/Execute/Eval"].join(""),
      ['stepID: "', 'plan"'].join(""),
      ['stepID: "', 'execute"'].join(""),
      ['stepID: "', 'eval"'].join(""),
      ['label: "', 'Plan"'].join(""),
      ['label: "', 'Execute"'].join(""),
      ['label: "', 'Eval"'].join(""),
      'phaseID: "plan"',
      'case "planner"',
      "plan/build/evaluate",
      "plan / build / evaluate",
      "plan + build",
      "plan + build + evaluate",
      "build step now has two phases",
      "build/planner",
      "Historical attempt cards",
    ])
    const panelReactivity = read("specs/current/architecture/07-panel-reactivity.md")
    expect(panelReactivity).toContain("backend\n`orderKey`")
    expect(panelReactivity).toContain("share that single ordering axis")
    expect(panelReactivity).toContain("`<stage>:session:<sessionID>:message:<messageID>`")
    expect(panelReactivity).toContain("`integrity:session:<sessionID>`")
    expect(panelReactivity).not.toContain("`synthetic:<messageID>`")
    expect(panelReactivity).not.toContain("`synthetic:*`")
    expect(panelReactivity).not.toContain(
      "goal-scope `step:<goalID>:<stepID>` cards in board workflow order",
    )
    expect(read("specs/current/architecture/07-panel-reactivity.md")).toContain("`step:<goalID>:<stepID>`")
    const treeWriter = read("packages/overlay/src/services/tree-writer.ts")
    expect(treeWriter).toContain("return `step:${goalID}:${stepID}`")
    expect(treeWriter).toContain("requireGoalWorkflowOrderIndex")
    expect(treeWriter).toContain("requireGoalWorkflowRetryCount")
    expect(treeWriter).toContain("requireWorkflowPhaseDefinitions")
    expect(treeWriter).toContain("requireBuildPhaseSessionID")
    expect(treeWriter).not.toContain('typeof gw.orderIndex === "number" ? gw.orderIndex')
    expect(treeWriter).not.toContain('typeof gw.retryCount === "number" ? gw.retryCount + 1 : 1')
    expect(treeWriter).not.toContain("String(pdef.label || pid)")
    expect(treeWriter).not.toContain('String(pdef.sessionKind || "")')
    expect(treeWriter).not.toContain('if (s === "passed" || s === "done" || s === "ok")')
    expect(read("packages/overlay/src/store/card-tree.ts")).toContain("requirePrunableCardTime")
    expect(read("packages/overlay/src/store/card-tree.ts")).not.toContain("card.time ?? 0")
    expect(read("packages/overlay/test/fixtures/goal-phase-events.ts")).not.toContain(
      "messageOrderKey(messageID, time)",
    )
    expect(read("packages/overlay/test/conversation-agent-rail-records.test.ts")).not.toContain(
      "info.orderKey || messageOrderKey",
    )
    for (const file of cardIdentityFiles) {
      expect(read(file)).not.toMatch(/phases:\s*\{\s*plan:/)
      expect(read(file)).not.toMatch(/plan\/build\/\s*(?:\*\/\s*)?evaluate/)
    }
  })

  test("benchmark quality checks do not publish retired gate terminology", () => {
    expect(fs.existsSync(path.join(repoRoot, "packages/opencorvus/script/benchmark/quality-gates.ts"))).toBe(false)
    expect(fs.existsSync(path.join(repoRoot, "packages/opencorvus/test/benchmark/quality-gates.test.ts"))).toBe(false)
    expectFilesNotToContain(
      [
        "packages/opencorvus/script/benchmark/capture-ainvest-reference.ts",
        "packages/opencorvus/script/benchmark/quality-checks.ts",
        "packages/opencorvus/script/benchmark/overlay-web-benchmark.ts",
        "packages/opencorvus/script/benchmark/snapshot-benchmark.ts",
        "packages/opencorvus/script/benchmark/visual-diff.ts",
        "packages/opencorvus/test/benchmark/quality-checks.test.ts",
        "packages/web/src/content/docs/operations/benchmark.mdx",
        "packages/web/src/content/docs/zh-cn/operations/benchmark.mdx",
      ],
      ["quality gate", "quality-gate", "quality gates", "quality-gates", "evaluateQualityGates", "hardFailCategories"],
    )
    for (const file of [
      "packages/opencorvus/script/benchmark/capture-ainvest-reference.ts",
      "packages/opencorvus/script/benchmark/overlay-web-benchmark.ts",
      "packages/opencorvus/script/benchmark/snapshot-benchmark.ts",
      "packages/opencorvus/script/benchmark/visual-diff.ts",
    ]) {
      expect(read(file)).not.toMatch(/\bgate\b/i)
    }
    expectFilesNotToContain(
      [
        "packages/opencorvus/script/benchmark/overlay-web-benchmark.ts",
        "packages/opencorvus/script/benchmark/mission-benchmark.ts",
        "packages/opencorvus/script/benchmark/mission-scenario.ts",
        "packages/opencorvus/script/benchmark/visual-diff.ts",
      ],
      [
        "no auto-verify",
        "DEFAULT_MISSION_VERIFY_CMD",
        "WEB_CLONE_VISUAL_THRESHOLD",
        "WEB_CLONE_VISUAL_WORST_THRESHOLD",
        "OPENCORVUS_WEB_CLONE_BENCHMARK_THRESHOLD",
        "OPENCORVUS_WEB_CLONE_BENCHMARK_WORST_THRESHOLD",
        "DEFAULT_TASK_REQUEST",
        'flag("--threshold") ?? "0.85"',
        'flag("--worst-threshold") ?? "0.55"',
        "OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS ?? 60_000",
        "DEFAULT_MISSION_BENCHMARK_REQUEST",
      ],
    )
    const overlayBenchmark = read("packages/opencorvus/script/benchmark/overlay-web-benchmark.ts")
    expect(overlayBenchmark).toContain("evaluateQualityChecks")
    expect(overlayBenchmark).toContain("parseExecutor(flag(\"--executor\"))")
    expect(overlayBenchmark).toContain("unsupported executor")
    expect(overlayBenchmark).toContain('requireVisualNumberFlag("--threshold")')
    expect(overlayBenchmark).toContain('requireVisualNumberFlag("--worst-threshold")')
    expect(overlayBenchmark).toContain('requireVisualNumberFlag("--browser-launch-timeout-ms")')
    expect(overlayBenchmark).toContain('requireVisualNumberFlag("--navigation-timeout-ms")')
    expect(overlayBenchmark).toContain('requireVisualNumberFlag("--settle-ms")')
    expect(overlayBenchmark).toContain("--request-file or --request-attachment is required")
    expect(overlayBenchmark).toContain("--request-file must not be empty")
    expect(overlayBenchmark).toContain("overlay benchmark cannot auto-answer free-text interaction")
    expect(overlayBenchmark).not.toContain(["AUTO", "_REPLY"].join(""))
    expect(overlayBenchmark).not.toContain(["reasonable", "defaults"].join(" "))
    expect(overlayBenchmark).not.toContain(["message: ", "AUTO", "_REPLY"].join(""))
    expect(overlayBenchmark).not.toContain(["answersFrom", "Message(message)"].join(""))
    expect(overlayBenchmark).not.toContain("ChatGPT / Claude.ai / Poe")
    expect(read("packages/opencorvus/script/benchmark/mission-benchmark.ts")).toContain(
      "--acceptance-verify-cmd is required for mission benchmark acceptance evidence",
    )
    expect(read("packages/opencorvus/script/benchmark/mission-benchmark.ts")).toContain(
      "--request-file is required for mission benchmark task input",
    )
    expect(read("packages/opencorvus/script/benchmark/mission-benchmark.ts")).toContain(
      "--request-file must not be empty for mission benchmark task input",
    )
    expect(read("packages/opencorvus/test/benchmark/quality-checks.test.ts")).toContain("benchmark quality checks")
  })

  test("html skeleton workflow benchmark requires explicit numeric thresholds and render timeouts", () => {
    const source = read("packages/opencorvus/script/benchmark/html-skeleton-workflow-check.ts")
    expect(source).toContain("Required CLI flags")
    expect(source).toContain("`--browser-launch-timeout-ms=NUMBER`")
    expect(source).toContain("`--navigation-timeout-ms=NUMBER`")
    expect(source).toContain("`--settle-ms=NUMBER`")
    expect(source).toContain("parseRequiredNumberFlag")
    expect(source).toContain("browserLaunchTimeoutMs: number")
    expect(source).toContain("navigationTimeoutMs: number")
    expect(source).toContain("settleMs: number")
    expect(source).toContain("requirePositiveNumberInput(input.browserLaunchTimeoutMs")
    expect(source).toContain("requirePositiveNumberInput(input.navigationTimeoutMs")
    expect(source).toContain("requirePositiveNumberInput(input.settleMs")
    expect(source).toContain('throw new Error(`Missing required numeric flag ${name}`)')
    expect(source).not.toContain("parseNumberFlag")
    expect(source).not.toContain('parseRequiredNumberFlag("--threshold",')
    expect(source).not.toContain('parseRequiredNumberFlag("--worst-threshold",')
    expect(source).not.toContain('parseRequiredNumberFlag("--navigation-timeout-ms",')
    expect(source).not.toContain('parseRequiredNumberFlag("--settle-ms",')
    expect(source).not.toContain("OPENCORVUS_BROWSER_LAUNCH_TIMEOUT_MS ?? 60_000")
    expect(source).not.toContain('parseNumberFlag("--threshold", 0.95)')
    expect(source).not.toContain('parseNumberFlag("--worst-threshold", 0.8)')

    const overlayBenchmark = read("packages/opencorvus/script/benchmark/overlay-web-benchmark.ts")
    expect(overlayBenchmark).toContain("--browser-launch-timeout-ms=${browserLaunchTimeoutMs}")
    expect(overlayBenchmark).toContain("--navigation-timeout-ms=${navigationTimeoutMs}")
    expect(overlayBenchmark).toContain("--settle-ms=${settleMs}")
    const visualDiff = read("packages/opencorvus/script/benchmark/visual-diff.ts")
    expect(visualDiff).toContain('const threshold = requiredNumber("--threshold")')
    expect(visualDiff).toContain('const worstThreshold = requiredNumber("--worst-threshold")')
    expect(visualDiff).toContain('const browserLaunchTimeoutMs = requiredNumber("--browser-launch-timeout-ms")')
    expect(visualDiff).toContain('const navigationTimeoutMs = requiredNumber("--navigation-timeout-ms")')
    expect(visualDiff).toContain('const settleMs = requiredNumber("--settle-ms")')

    const htmlSkeletonTest = read("packages/opencorvus/test/benchmark/html-skeleton-workflow-check.test.ts")
    expect(htmlSkeletonTest).toContain("programmatic runner requires an explicit browser timeout")
    expect(htmlSkeletonTest).toContain("browserLaunchTimeoutMs must be a positive number")
    expect(htmlSkeletonTest).toContain("programmatic runner requires explicit navigation and settle timeouts")
    expect(htmlSkeletonTest).toContain("navigationTimeoutMs must be a positive number")
    expect(htmlSkeletonTest).toContain("settleMs must be a positive number")
  })

  test("benchmark public docs expose current required inputs and verdicts", () => {
    for (const file of [
      "packages/web/src/content/docs/operations/benchmark.mdx",
      "packages/web/src/content/docs/zh-cn/operations/benchmark.mdx",
    ]) {
      const text = read(file)
      expect(text).toContain("accepted/rejected/blocked")
      expect(text).toContain("--acceptance-verify-cmd=bun test")
      expect(text).toContain("--request-file")
      expect(text).toContain("--request-attachment")
      expect(text).toContain("--reference-images")
      expect(text).toContain("--browser-launch-timeout-ms")
      expect(text).toContain("--navigation-timeout-ms")
      expect(text).toContain("--settle-ms")
      expect(text).not.toContain("accepted/rejected）")
      expect(text).not.toContain("accepted/rejected) as")
    }
  })

  test("web clone e2e visual inputs have no default thresholds", () => {
    const source = read("packages/opencorvus/test/e2e/web-clone-source-project-e2e.test.ts")
    expect(source).toContain("requireWebCloneE2EVisualInputs")
    expect(source).toContain("OPENCORVUS_WEB_CLONE_E2E_BROWSER_LAUNCH_TIMEOUT_MS")
    expect(source).not.toContain("OPENCORVUS_WEB_CLONE_E2E_THRESHOLD ??")
    expect(source).not.toContain("OPENCORVUS_WEB_CLONE_E2E_WORST_THRESHOLD ??")
    expect(source).not.toContain("return 0.96")
  })

  test("GitLab Auth public docs explain the package-manager alias boundary", () => {
    const en = read("packages/web/src/content/docs/plugins.mdx")
    const zh = read("packages/web/src/content/docs/zh-cn/plugins.mdx")
    for (const text of [en, zh]) {
      expect(text).toContain("@gitlab/opencorvus-gitlab-auth")
      expect(text).toContain("package-manager alias")
      expect(text).not.toContain("import { gitlabAuthPlugin } from \"@gitlab/opencode-gitlab-auth\"")
    }
    expect(read("packages/opencorvus/package.json")).toContain(
      '"@gitlab/opencorvus-gitlab-auth": "npm:@gitlab/opencode-gitlab-auth@1.3.3"',
    )
  })

  test("retired source audit tool stays absent and MCP transport contracts stay documented and implemented", () => {
    expect(fs.existsSync(path.join(repoRoot, "packages/opencorvus/src/tool/web-clone-source-audit.ts"))).toBe(false)
    expect(
      fs.existsSync(path.join(repoRoot, "packages/opencorvus/src/web-clone/source-skeleton-consumption-audit.ts")),
    ).toBe(false)
    expect(fs.existsSync(path.join(repoRoot, "packages/opencorvus/test/tool/web-clone-source-audit.test.ts"))).toBe(
      false,
    )
    expect(
      fs.existsSync(
        path.join(repoRoot, "packages/opencorvus/test/web-clone/source-skeleton-consumption-audit.test.ts"),
      ),
    ).toBe(false)
    const mcpSource = read("packages/opencorvus/src/mcp/index.ts")
    expect(mcpSource).toContain("function createRemoteTransport")
    expect(mcpSource).toContain("mcpFetchRequestInit(requestTimeout)")
    expect(mcpSource).toContain("mcpFetchRequestInit(authTimeout)")
    expect(mcpSource).not.toContain("pendingOAuthTransports")
    expect(mcpSource).not.toContain("const transports")
    expect(mcpSource).not.toContain("for (const { name, transport } of transports)")
    expectFilesNotToContain(walkTextFiles("specs"), ["pendingOAuthTransports"])

    expect(read("packages/opencorvus/src/config/config.ts")).toContain("Remote MCP transport")
    expect(read("packages/opencorvus/src/config/config.ts")).toContain("Defaults to 30000 (30 seconds)")
    expect(read("packages/opencorvus/src/config/config.ts")).not.toContain("Defaults to 5000 (5 seconds)")
    expect(read("packages/web/src/content/docs/mcp-servers.mdx")).not.toContain("falls back to SSE")
    expect(read("packages/web/src/content/docs/zh-cn/mcp-servers.mdx")).not.toContain("失败降级")

    const executorDocs = [
      "packages/web/src/content/docs/mcp-servers.mdx",
      "packages/web/src/content/docs/zh-cn/mcp-servers.mdx",
    ]
    expectFilesNotToContain(executorDocs, [
      "/mcp/transport",
      "MCPServe.url",
      "McpHttpServerConfig",
      "mcp_servers.opencorvus.url",
      "webpage_extract",
      "webpage_compile",
      "webpage_analyze",
      "webpage_runtime_state",
      "webpage_render",
      "webpage_evaluate",
      "webpage_text_diff",
      "webpage_vision_judge",
    ])
    for (const file of executorDocs) {
      const text = read(file)
      expect(text).toContain("MCPServe.command(cwd)")
      expect(text).toContain("stdio")
      expect(text).toContain("`skill`")
      expect(text).toContain("`memory`")
      expect(text).toContain("`task_report`")
      expect(text).toContain('"transport": "streamable-http"')
      expect(text).toContain("`transport`")
      expect(text).toMatch(/(?:Default timeout: 30000 ms|默认超时 30000ms)/)
      expect(text).not.toContain('"timeout": 15000')
      expect(text).not.toContain("30 000 ms")
      expect(text).toContain("`sse`")
      expect(text).not.toContain("streamable-http` by default")
      expect(text).not.toContain("默认 `streamable-http`")
    }
    expect(read("packages/web/src/content/docs/zh-cn/mcp-servers.mdx")).toContain(
      "| `transport`          | 远程 MCP transport；只能是 `streamable-http` 或 `sse` |",
    )
    for (const file of [
      "packages/overlay/test/browser/command-palette.test.ts",
      "packages/overlay/test/browser/skill-mcp-panel-browser.test.ts",
      "packages/overlay/test/browser/controls.test.ts",
      "packages/overlay/test/agent-workflow-panel.test.ts",
      "packages/overlay/test/fixtures/goal-phase-events.ts",
    ]) {
      expect(read(file)).not.toMatch(/type:\s*"remote",\s*\r?\n\s*url:/)
    }
    expect(read("packages/opencorvus/src/mcp/serve.ts")).toContain("new StdioServerTransport()")
    expect(read("packages/opencorvus/src/mcp/serve.ts")).not.toContain("webpage_extract")
  })

  test("historical specs that conflict with current runtime are marked as history", () => {
    for (const file of [
      "specs/records/2026-06/coding-agent-tui-independent-plugin-2026-06-06.md",
      "specs/records/2026-06/tui-home-layout-density-2026-06-06.md",
      "specs/records/2026-06/right-sidebar-opencode-tui-copy-implementation-plan-2026-06-04.md",
      "specs/records/2026-06/right-sidebar-opencode-tui-upgrade-2026-06-04.md",
      "specs/records/2026-06/2026-06-04-right-panel-frontend-preview-mature-toolchain.md",
      "specs/records/2026-06/2026-06-05-vscode-style-activity-toolbars.md",
      "specs/records/2026-06/2026-06-04-right-sidebar-coding-assistant.md",
      "specs/records/2026-06/2026-06-11-browser-preview-manual-url-input.md",
      "specs/records/2026-06/instance-stale-global-worktree-refresh-2026-06-16.md",
      "specs/records/2026-06/task-global-project-forbidden-2026-06-16.md",
      "specs/records/2026-06/task-execution-terminalization-2026-06-16.md",
      "specs/records/2026-06/tui-tank-battle-usability-case-2026-06-06.md",
      "specs/records/2026-06/2026-06-10-build-card-steer-operator-guidance.md",
      "specs/records/2026-06/2026-06-13-build-steer-live-ownership-interrupt-fix.md",
    ]) {
      const head = read(file).split(/\r?\n/).slice(0, 12).join("\n")
      expect(head).toMatch(/Superseded|superseded/)
    }

    const directReplyRepairPlan = read("specs/records/2026-06/bug-hunt-repair-plan-2026-06-17.md")
    expect(directReplyRepairPlan).toContain("Superseded for overlay targeted steer on 2026-06-29 by")
    expect(directReplyRepairPlan).toContain("rejects task-message\n> `target` fields before writing a root message")

    expect(read("specs/records/2026-06/2026-06-06-mission-session-agent-identity.md")).not.toContain("| TUI runtime")
    expect(read("specs/records/2026-06/task-row-action-rail-visual-alignment-2026-06-05.md")).not.toContain("TUI host")
    expect(read("specs/records/2026-06/2026-06-15-browser-preview-consensus-closure.md")).toContain(
      "manual URL branch was retired",
    )

    const retiredPackageSpecDir = ["packages", "opencorvus", "specs"]
    for (const file of [
      "acceptance-spec-scope-discipline-2026-05-23.md",
      "build-agent-review-uptake-2026-05-23.md",
      "integrity-severity-discipline-2026-05-23.md",
      "integrity-team-replay-aware-2026-05-23.md",
      "orchestrator-stuck-integrity-loop-2026-05-23.md",
    ]) {
      expect(fs.existsSync(path.join(repoRoot, ...retiredPackageSpecDir, file))).toBe(false)
    }
  })

  test("message-card historical records preserve current phase and orderKey calibration", () => {
    const records = [
      "specs/records/2026-06/2026-06-26-message-card-adjacent-segment-timeline.md",
      "specs/records/2026-06/2026-06-27-message-card-orderkey-convergence.md",
    ]
    expectFilesNotToContain(records, [
      "build/planner/evaluator",
      "build/planner phase messages",
      "planner phase messages",
      "owning goal order key",
      "time otherwise",
    ])
    for (const record of records) {
      expect(read(record)).toContain("2026-06-29 calibration")
      expect(read(record)).toContain("`build`")
    }
  })
})
