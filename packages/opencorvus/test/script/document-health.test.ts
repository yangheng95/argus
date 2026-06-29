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
      const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0))
      return lines.map((line) => line.slice(indent)).join("\n")
    },
  )
}

function stringLiteralArrayFromConst(source: string, constName: string): string[] {
  const match = source.match(new RegExp(`const ${constName} = \\[([^\\]]+)\\] as const`))
  expect(match).not.toBeNull()
  return Array.from(match![1]!.matchAll(/"([^"]+)"/g)).map((item) => item[1]!)
}

function supportedGitHubEventsFromRuntime(): string[] {
  const source = read("packages/opencorvus/src/cli/cmd/github.ts")
  return [...stringLiteralArrayFromConst(source, "USER_EVENTS"), ...stringLiteralArrayFromConst(source, "REPO_EVENTS")]
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
    expect(read("github/action.yml")).toContain("oven-sh/setup-bun@v2")
    expect(read("github/action.yml")).toContain(
      'bun "$GITHUB_ACTION_PATH/../packages/opencorvus/src/index.ts" github run',
    )
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
    expect(read("github/action.yml")).not.toContain("https://opencorvus.ai/install")
    expect(read("github/action.yml")).not.toContain("~/.opencorvus/bin")
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
    const files = ["specs/current/architecture/README.md", "specs/current/architecture/02-data.md", "specs/current/architecture/03-control.md"]

    expectFilesNotToContain(files, ["kind='gateway'", "src/gateway", "`assistant` · `gateway`"])
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
      "packages/web/src/content/docs/operations/github-action.mdx",
      "packages/web/src/content/docs/zh-cn/operations/github-action.mdx",
    ]
    const supportedGitHubEvents = supportedGitHubEventsFromRuntime()

    for (const file of githubActionDocs) {
      const text = read(file)
      expect(text).not.toContain("description: Trigger the OpenCorvus AI coding agent from a PR or Issue comment")
      expect(text).not.toContain("description: 在 PR 或 Issue 评论区")
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
      for (const eventName of supportedGitHubEvents) {
        expect(text).toContain(`\`${eventName}\``)
      }
      const workflowExample = markdownCodeBlocks(text, "yaml").find((block) =>
        block.includes("yangheng95/opencorvus/github@latest"),
      )
      expect(workflowExample).toBeDefined()
      const parsedWorkflow = Bun.YAML.parse(workflowExample!)
      expect(parsedWorkflow.jobs.opencorvus.steps).toHaveLength(2)
    }

    const workflow = read(".github/workflows/opencorvus.yml")
    expect(workflow).toContain("uses: actions/checkout@v7")
    expect(workflow).toContain("persist-credentials: false")
    expect(workflow).toContain("model: alibaba-coding-plan-cn/qwen3.5-plus")
    expect(workflow).toContain("ALIBABA_CODING_PLAN_API_KEY: ${{ secrets.ALIBABA_CODING_PLAN_API_KEY }}")
    expect(workflow).not.toContain("OPENCORVUS_CONFIG_CONTENT")
    expect(workflow).not.toContain("https://coding.dashscope.aliyuncs.com/v1")
    expect(workflow).toContain("contents: read")
    expect(workflow).toContain("pull-requests: read")
    expect(workflow).toContain("issues: read")

    const actionReadme = read("github/README.md")
    expect(actionReadme).toContain("uses: actions/checkout@v7")
    expect(actionReadme).toContain("persist-credentials: false")
    expect(actionReadme).toContain("id-token: write")
    expect(actionReadme).toContain("contents: read")
    expect(actionReadme).toContain("pull-requests: read")
    expect(actionReadme).toContain("issues: read")
    expect(actionReadme).toContain("OPENCORVUS_PERMISSION: '{\"bash\": \"deny\"}'")
    expect(actionReadme).toContain("model: alibaba-coding-plan-cn/qwen3.5-plus")
    expect(actionReadme).toContain("ALIBABA_CODING_PLAN_API_KEY: ${{ secrets.ALIBABA_CODING_PLAN_API_KEY }}")
    expect(actionReadme).not.toContain("contents: write")
    expect(actionReadme).not.toContain("MODEL=alibaba-coding-plan-cn/qwen3.5-plus")
    expect(actionReadme).not.toContain("ALIBABA_CODING_PLAN_API_KEY=sk-1234567890")
    expect(actionReadme).not.toContain("--token")
    expect(actionReadme).not.toContain("github_pat")
    expect(actionReadme).not.toContain("personal access token")
    for (const eventName of supportedGitHubEvents) {
      expect(actionReadme).toContain(`\`${eventName}\``)
    }
    const workflowExamples = markdownCodeBlocks(actionReadme, "yml")
    const workflowExample = workflowExamples.find((block) => block.includes("yangheng95/opencorvus/github@latest"))
    expect(workflowExample).toBeDefined()
    const parsedWorkflow = Bun.YAML.parse(workflowExample!)
    const steps = parsedWorkflow.jobs.opencorvus.steps
    expect(steps).toHaveLength(2)
    expect(steps[1]).toMatchObject({
      name: "Run OpenCorvus",
      uses: "yangheng95/opencorvus/github@latest",
      with: { model: "alibaba-coding-plan-cn/qwen3.5-plus" },
    })
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
    const serverDocs = [
      "packages/web/src/content/docs/server.mdx",
      "packages/web/src/content/docs/zh-cn/server.mdx",
    ]

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
  })

  test("current architecture chapters do not describe retired live paths as current", () => {
    expectFilesNotToContain(
      [
        "specs/current/architecture/01-agents.md",
        "specs/current/architecture/03-control.md",
        "specs/current/architecture/03-control.svg",
        "specs/current/architecture/04-extensions.md",
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
      ],
    )

    const controlChapter = read("specs/current/architecture/03-control.md")
    expect(controlChapter).toContain("共 28 个文件，2026-06-17")
    expect(controlChapter).toContain("routes/pty.ts")
    expect(controlChapter).toContain("routes/browser-preview.ts")
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

    expectFilesNotToContain(
      [
        "packages/opencorvus/src/prompt/information-missing.ts",
        "packages/opencorvus/src/agent/runner.ts",
        "packages/opencorvus/src/orchestrator/agent.ts",
        "packages/overlay/src/i18n/en-US.json",
        "packages/overlay/src/i18n/zh-CN.json",
      ],
      ["INFORMATION_MISSING_FALLBACK", "appendInformationMissingFallback", "INFORMATION MISSING fallback"],
    )
    expect(read("packages/overlay/src/i18n/en-US.json")).toContain("INFORMATION MISSING diagnostic section")
    expect(read("packages/overlay/src/i18n/zh-CN.json")).toContain("INFORMATION MISSING diagnostic")
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
        'status: z.enum(["alpha", "beta", "deprecated", "active"])',
        'status?: "alpha" | "beta" | "deprecated"',
        'status: "alpha" | "beta" | "deprecated" | "active"',
      ],
    )

    expect(read("packages/opencorvus/src/orchestrator/tools.ts")).toContain("goal_run_id")
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
      expect(text).toMatch(/(?:Default timeout: 30000 ms|默认超时 30000ms)/)
      expect(text).not.toContain('"timeout": 15000')
      expect(text).not.toContain("30 000 ms")
      expect(text).toContain("`sse`")
      expect(text).not.toContain("streamable-http` by default")
      expect(text).not.toContain("默认 `streamable-http`")
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
    ]) {
      const head = read(file).split(/\r?\n/).slice(0, 12).join("\n")
      expect(head).toMatch(/Superseded|superseded/)
    }

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
})
