import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const textExtensions = new Set([".md", ".mdx", ".txt", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".yml", ".yaml"])

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
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
      "github/index.ts",
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
    expectFilesNotToContain(githubFiles, ["actions/checkout@v4", "actions/setup-node@v4", "actions/github-script@v7"])

    expect(read(".github/actions/setup-bun/action.yml")).toContain("actions/setup-node@v6")
    expect(read("github/action.yml")).toContain("oven-sh/setup-bun@v2")
    expect(read("github/action.yml")).toContain(
      'bun "$GITHUB_ACTION_PATH/../packages/opencorvus/src/index.ts" github run',
    )
    expect(read("github/action.yml")).not.toContain("https://opencorvus.ai/install")
    expect(read("github/action.yml")).not.toContain("~/.opencorvus/bin")

    for (const file of [
      ".github/workflows/typecheck.yml",
      ".github/workflows/test.yml",
      ".github/workflows/build.yml",
      ".github/workflows/build-vscode-extension.yml",
      ".github/workflows/build-overlays.yml",
      ".github/workflows/opencorvus.yml",
    ]) {
      const text = read(file)
      expect(text).toContain("actions/checkout@v6")
      expect(text).toContain("persist-credentials: false")
    }

    const generateWorkflow = read(".github/workflows/generate.yml")
    expect(generateWorkflow).toContain("actions/checkout@v6")
    expect(generateWorkflow).toContain("token: ${{ github.token }}")
  })

  test("public GitHub Action examples match the generated workflow contract", () => {
    const githubActionDocs = [
      "packages/web/src/content/docs/operations/github-action.mdx",
      "packages/web/src/content/docs/zh-cn/operations/github-action.mdx",
    ]

    for (const file of githubActionDocs) {
      const text = read(file)
      expect(text).not.toContain("actions/checkout@v4")
      expect(text).not.toContain("model: openai/gpt-5.5")
      expect(text).toContain("actions/checkout@v6")
      expect(text).toContain("persist-credentials: false")
      expect(text).toContain("model: alibaba-cn/qwen3.5-plus")
    }

    const workflow = read(".github/workflows/opencorvus.yml")
    expect(workflow).toContain("uses: actions/checkout@v6")
    expect(workflow).toContain("persist-credentials: false")
    expect(workflow).toContain("model: alibaba-cn/qwen3.5-plus")
    expect(workflow).toContain("contents: read")
    expect(workflow).toContain("pull-requests: read")
    expect(workflow).toContain("issues: read")
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
    expect(read("github/index.ts")).not.toContain("social-cards.sst.dev")
    expect(read("packages/web/src/content/docs/commands.mdx")).not.toContain("OpenCorvus inherits OpenCorvus")
    expect(read("packages/web/src/content/docs/zh-cn/commands.mdx")).not.toContain("OpenCorvus 继承 OpenCorvus")
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
        "specs/new-arch/01-agents.md",
        "specs/new-arch/03-control.md",
        "specs/new-arch/03-control.svg",
        "specs/new-arch/04-extensions.md",
        "specs/new-arch/09-verification-evidence.md",
        "specs/new-arch/11-agent-oop-protocol.md",
        "specs/new-arch/13-agent-communication-matrix.md",
        "specs/new-arch/99-principles.md",
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

    const controlChapter = read("specs/new-arch/03-control.md")
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
    expect(read("packages/overlay/src/services/default-server.ts")).not.toContain("legacyPrefixed")
    expect(read("packages/overlay/src/services/diff.ts")).not.toContain("fetchVcsDiffs")
    expect(read("packages/overlay/src/services/diff.ts")).not.toContain("normalizeVcsDiffs")
    expect(read("packages/overlay/src/services/diff.ts")).not.toContain("stub FileChange")
    expect(read("packages/overlay/test/diff-resolve-inflight-cache.test.ts")).not.toContain("vcs-backfill")
    expect(read("specs/new-arch/2026-06-05-diff-preview-vcs-fallback-plan.md")).toContain("Status: Superseded")
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
        'status: z.enum(["alpha", "beta", "deprecated"]).optional()',
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
    expect(read("packages/opencorvus/src/channel/supervisor.ts")).toContain("createConfiguredSTT(process.env)")
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
    expect(read("packages/opencorvus/script/benchmark/review-deliverable.ts")).toContain("function requiredArg")
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

  test("explicit sourcePackageDir and MCP transport contracts stay documented and implemented", () => {
    const sourceAudit = read("packages/opencorvus/src/tool/web-clone-source-audit.ts")
    expect(sourceAudit).toContain("sourcePackageDir")
    expect(sourceAudit).not.toContain('path.join(Instance.directory, "web-clone-source")')
    expect(sourceAudit).not.toContain("legacy <execution directory>")

    const mcpSource = read("packages/opencorvus/src/mcp/index.ts")
    expect(mcpSource).toContain("function createRemoteTransport")
    expect(mcpSource).toContain("createRemoteTransport(mcpConfig, authProvider)")
    expect(mcpSource).not.toContain("const transports")
    expect(mcpSource).not.toContain("for (const { name, transport } of transports)")

    expect(read("packages/opencorvus/src/config/config.ts")).toContain("Remote MCP transport")
    expect(read("packages/web/src/content/docs/mcp-servers.mdx")).not.toContain("falls back to SSE")
    expect(read("packages/web/src/content/docs/zh-cn/mcp-servers.mdx")).not.toContain("失败降级")
  })

  test("historical specs that conflict with current runtime are marked as history", () => {
    for (const file of [
      "specs/coding-agent-tui-independent-plugin-2026-06-06.md",
      "specs/tui-home-layout-density-2026-06-06.md",
      "specs/new-arch/right-sidebar-opencode-tui-copy-implementation-plan-2026-06-04.md",
      "specs/new-arch/right-sidebar-opencode-tui-upgrade-2026-06-04.md",
      "specs/new-arch/2026-06-04-right-panel-frontend-preview-mature-toolchain.md",
      "specs/new-arch/2026-06-05-vscode-style-activity-toolbars.md",
      "specs/new-arch/2026-06-04-right-sidebar-coding-assistant.md",
      "specs/new-arch/2026-06-11-browser-preview-manual-url-input.md",
      "specs/instance-stale-global-worktree-refresh-2026-06-16.md",
      "specs/task-global-project-forbidden-2026-06-16.md",
      "specs/task-execution-terminalization-2026-06-16.md",
      "specs/tui-tank-battle-usability-case-2026-06-06.md",
    ]) {
      const head = read(file).split(/\r?\n/).slice(0, 12).join("\n")
      expect(head).toMatch(/Superseded|superseded/)
    }

    expect(read("specs/new-arch/2026-06-06-mission-session-agent-identity.md")).not.toContain("| TUI runtime")
    expect(read("specs/task-row-action-rail-visual-alignment-2026-06-05.md")).not.toContain("TUI host")
    expect(read("specs/new-arch/2026-06-15-browser-preview-consensus-closure.md")).toContain(
      "manual URL branch was retired",
    )

    for (const file of [
      "packages/opencorvus/specs/acceptance-spec-scope-discipline-2026-05-23.md",
      "packages/opencorvus/specs/build-agent-review-uptake-2026-05-23.md",
      "packages/opencorvus/specs/integrity-severity-discipline-2026-05-23.md",
      "packages/opencorvus/specs/integrity-team-replay-aware-2026-05-23.md",
      "packages/opencorvus/specs/orchestrator-stuck-integrity-loop-2026-05-23.md",
    ]) {
      const head = read(file).split(/\r?\n/).slice(0, 12).join("\n")
      expect(head).toContain("implemented history")
      expect(head).not.toContain("Status: design draft")
    }
  })
})
