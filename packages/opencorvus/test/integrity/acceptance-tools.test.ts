import { afterEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { textContextPacket, type AgentContextPacket } from "../../src/agent/context-packet"
import {
  createIntegrityAcceptanceTools,
  implementationEvidenceContextPacket,
  implementationEvidenceFromAgentOutcomes,
  IMPLEMENTATION_EVIDENCE_CONTEXT_PACKET_SCHEMA,
  visualQaImplementationContextPacket,
} from "../../src/integrity/acceptance-tools"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

afterEach(async () => {
  await resetDatabase()
})

function implementationEvidencePacket(data: unknown): AgentContextPacket {
  return {
    id: "malformed-implementation-evidence",
    title: "Malformed Implementation Evidence",
    source: "agent_outcomes",
    scope: "task",
    parts: [
      {
        type: "structured",
        schema: IMPLEMENTATION_EVIDENCE_CONTEXT_PACKET_SCHEMA,
        data,
      },
    ],
  }
}

test("integrity tools do not expose final visual feedback verification inspection", async () => {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const tools = createIntegrityAcceptanceTools({
        taskID: "tsk_integrity_visual_context",
        contextPackets: [
          visualQaImplementationContextPacket(
            "Visual QA implementation defect context: code module implementation issues: none. This is not a visual acceptance verdict.",
          ),
        ].filter((packet): packet is AgentContextPacket => Boolean(packet)),
      })

      expect(Object.keys(tools)).not.toContain("inspect_visual_feedback_evidence")
      expect(Object.keys(tools)).not.toContain(["inspect", "visual", "evidence"].join("_"))
      const visualQa = await tools.inspect_integrity_evidence.execute!(
        { section: "visual_qa_report", max_chars: 4_000 },
        {} as any,
      )
      expect(String(visualQa)).toContain("# Visual QA Implementation Defect Context")
      expect(String(visualQa)).toContain("code module implementation issues: none")
      expect(String(visualQa)).not.toContain("accepted=true")
    },
  })
}, 20_000)

test("integrity evidence drilldown ignores legacy source-only visual QA packets", async () => {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const tools = createIntegrityAcceptanceTools({
        taskID: "tsk_integrity_legacy_visual_context",
        contextPackets: [
          textContextPacket({
            id: "legacy-visual-qa-source-only",
            title: "Legacy Visual QA Source Only",
            source: "visual_qa",
            body: "code module implementation issues: should not be consumed without schema.",
          }),
        ].filter((packet): packet is AgentContextPacket => Boolean(packet)),
      })

      const visualQa = await tools.inspect_integrity_evidence.execute!(
        { section: "visual_qa_report", max_chars: 4_000 },
        {} as any,
      )
      expect(String(visualQa)).toContain("# Visual QA Implementation Defect Context")
      expect(String(visualQa)).toContain("(none)")
      expect(String(visualQa)).not.toContain("should not be consumed")
    },
  })
}, 20_000)

test("integrity evidence drilldown reads implementation evidence from context packets", async () => {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const tools = createIntegrityAcceptanceTools({
        taskID: "tsk_integrity_implementation_context",
        contextPackets: [
          (() => {
            const packet = implementationEvidenceContextPacket({
              summary: "Implemented the route locale fix.",
              changedFiles: ["src/routes/world-economy.tsx", "src/lib/locale.ts"],
              diffs: [
                {
                  file: "src/routes/world-economy.tsx",
                  status: "modified",
                  additions: 3,
                  deletions: 1,
                  diff: "@@ route fix @@",
                },
              ],
            })
            expect("metadata" in packet).toBe(false)
            expect(packet.parts.some((part) => part.type === "structured")).toBe(true)
            expect(packet.parts.map((part) => (part.type === "text" ? part.text : "")).join("\n")).not.toContain(
              "implementation_evidence_json:",
            )
            return packet
          })(),
        ],
      })

      const overview = await tools.inspect_integrity_evidence.execute!(
        { section: "overview", max_chars: 4_000 },
        {} as any,
      )
      expect(String(overview)).toContain("changed_files=2")
      expect(String(overview)).toContain("diffs=1")

      const directories = await tools.inspect_integrity_evidence.execute!(
        { section: "changed_directories", max_chars: 4_000 },
        {} as any,
      )
      expect(String(directories)).toContain("- src/routes")
      expect(String(directories)).toContain("- src/lib")

      const diff = await tools.inspect_integrity_evidence.execute!(
        { section: "diff_for_file", file_path: "src/routes/world-economy.tsx", max_chars: 4_000 },
        {} as any,
      )
      expect(String(diff)).toContain("# Diff For src/routes/world-economy.tsx")
      expect(String(diff)).toContain("@@ route fix @@")
    },
  })
}, 20_000)

test("integrity implementation evidence rejects malformed optional fields", async () => {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const malformedDiffTools = createIntegrityAcceptanceTools({
        contextPackets: [
          implementationEvidencePacket({
            summary: "bad diff evidence",
            changedFiles: ["src/App.tsx"],
            diffs: [{}],
          }),
        ],
      })
      await expect(
        malformedDiffTools.inspect_integrity_evidence.execute!({ section: "overview", max_chars: 4_000 }, {} as any),
      ).rejects.toThrow("diffs[0].file must be a string")

      const malformedGoalReportTools = createIntegrityAcceptanceTools({
        contextPackets: [
          implementationEvidencePacket({
            summary: "bad report evidence",
            changedFiles: ["src/App.tsx"],
            goalReports: [{ goalTitle: "UI", report: { files_changed: [{}] } }],
          }),
        ],
      })
      await expect(
        malformedGoalReportTools.inspect_integrity_evidence.execute!({ section: "executor_reports", max_chars: 4_000 }, {} as any),
      ).rejects.toThrow("report.files_changed[0].path must be a string")

      const nonArrayOptionalTools = createIntegrityAcceptanceTools({
        contextPackets: [
          implementationEvidencePacket({
            summary: "bad optional field",
            changedFiles: ["src/App.tsx"],
            diffs: {},
          }),
        ],
      })
      await expect(
        nonArrayOptionalTools.inspect_integrity_evidence.execute!({ section: "overview", max_chars: 4_000 }, {} as any),
      ).rejects.toThrow("diffs must be an array")

      const diffUnknownFieldTools = createIntegrityAcceptanceTools({
        contextPackets: [
          implementationEvidencePacket({
            summary: "bad diff evidence",
            changedFiles: ["src/App.tsx"],
            diffs: [{ file: "src/App.tsx", additionCount: 1 }],
          }),
        ],
      })
      await expect(
        diffUnknownFieldTools.inspect_integrity_evidence.execute!({ section: "overview", max_chars: 4_000 }, {} as any),
      ).rejects.toThrow("diffs[0] contains unsupported field additionCount")

      const reportUnknownFieldTools = createIntegrityAcceptanceTools({
        contextPackets: [
          implementationEvidencePacket({
            summary: "bad report evidence",
            changedFiles: ["src/App.tsx"],
            goalReports: [
              {
                goalTitle: "UI",
                report: {
                  files_changed: [{ path: "src/App.tsx", summary: "updated", extra: "typo" }],
                  checks_run: [],
                  implementation_approach: "direct fix",
                  design_decisions: [],
                  blockers: [],
                },
              },
            ],
          }),
        ],
      })
      await expect(
        reportUnknownFieldTools.inspect_integrity_evidence.execute!(
          { section: "executor_reports", max_chars: 4_000 },
          {} as any,
        ),
      ).rejects.toThrow("report.files_changed[0] contains unsupported field extra")
    },
  })
}, 20_000)

test("implementation evidence packet derives changed files and diffs from agent outcomes", () => {
  const evidence = implementationEvidenceFromAgentOutcomes([
    {
      id: "artifact_task_build",
      provider: "build",
      artifactKind: "build_attempt_outcome",
      scope: "task",
      capabilities: ["implementation"],
      status: "completed",
      result: "delivered",
      summary: "Task-level direct build repaired the route locale.",
      changedFiles: ["src/routes/world-economy.tsx"],
      diffs: [{ file: "src/routes/world-economy.tsx", status: "modified", additions: 7, deletions: 2 }],
      time: { created: 1, updated: 1 },
    },
    {
      id: "artifact_goal_build",
      provider: "build",
      artifactKind: "build_attempt_outcome",
      scope: "goal",
      capabilities: ["implementation"],
      status: "completed",
      result: "delivered",
      summary: "Goal build touched shared locale utilities.",
      changedFiles: ["src/lib/locale.ts", "src/routes/world-economy.tsx"],
      diffs: [{ file: "src/lib/locale.ts", status: "modified", additions: 2, deletions: 0 }],
      time: { created: 2, updated: 2 },
    },
  ])

  expect(evidence.changedFiles).toEqual(["src/lib/locale.ts", "src/routes/world-economy.tsx"])
  expect(evidence.diffs).toEqual([
    { file: "src/lib/locale.ts", status: "modified", additions: 2, deletions: 0 },
    { file: "src/routes/world-economy.tsx", status: "modified", additions: 7, deletions: 2 },
  ])
  expect(evidence.summary).toContain("build/artifact_task_build task completed/delivered")
  expect(evidence.summary).toContain("Task-level direct build repaired the route locale")
})

test("integrity run_command executes in an isolated project copy without mutating implementation files", async () => {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      await fs.mkdir(path.join(dir.path, "src"), { recursive: true })
      await fs.writeFile(path.join(dir.path, "src", "existing.txt"), "original\n", "utf8")
      const tools = createIntegrityAcceptanceTools({ taskID: "tsk_integrity_isolated_command" })

      const output = await tools.run_command.execute!(
        {
          command: "mkdir -p src web-clone-source && printf implementation > src/changed.txt && printf evidence > web-clone-source/reference.txt && test -f src/existing.txt",
          timeout_ms: 10_000,
        },
        {} as any,
      )
      const text = String(output)
      expect(text).toContain(`source_cwd: ${dir.path}`)
      expect(text).toContain("execution_cwd:")
      expect(text).not.toContain("readonly_guard")
      expect(await fs.readFile(path.join(dir.path, "src", "existing.txt"), "utf8")).toBe("original\n")
      expect(await fs.stat(path.join(dir.path, "src", "changed.txt")).catch(() => undefined)).toBeUndefined()
      expect(await fs.stat(path.join(dir.path, "web-clone-source", "reference.txt")).catch(() => undefined)).toBeUndefined()
    },
  })
}, 20_000)

test("integrity run_command rejects project symlinks that point outside the isolated copy source", async () => {
  await using dir = await tmpdir({ git: true })
  await using external = await tmpdir()
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      await fs.mkdir(path.join(dir.path, "src"), { recursive: true })
      await fs.symlink(
        external.path,
        path.join(dir.path, "src", "escape"),
        process.platform === "win32" ? "junction" : "dir",
      )
      const tools = createIntegrityAcceptanceTools({ taskID: "tsk_integrity_external_symlink" })

      const output = await tools.run_command.execute!(
        {
          command: `bun -e "require('node:fs').writeFileSync('src/escape/pwned.txt', 'mutated')"`,
          timeout_ms: 10_000,
        },
        {} as any,
      )

      expect(String(output)).toContain("isolated check workspace refuses symlink outside source root")
      expect(await fs.stat(path.join(external.path, "pwned.txt")).catch(() => undefined)).toBeUndefined()
    },
  })
}, 20_000)

test("integrity run_command materializes internal symlinks inside the isolated copy", async () => {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const target = path.join(dir.path, "src", "target")
      await fs.mkdir(target, { recursive: true })
      await fs.writeFile(path.join(target, "existing.txt"), "original\n", "utf8")
      await fs.symlink(
        process.platform === "win32" ? target : "target",
        path.join(dir.path, "src", "link"),
        process.platform === "win32" ? "junction" : "dir",
      )
      const tools = createIntegrityAcceptanceTools({ taskID: "tsk_integrity_internal_symlink" })

      const output = await tools.run_command.execute!(
        {
          command: `bun -e "const fs = require('node:fs'); fs.writeFileSync('src/link/new.txt', 'isolated'); console.log(fs.readFileSync('src/link/existing.txt', 'utf8').trim())"`,
          timeout_ms: 10_000,
        },
        {} as any,
      )

      expect(String(output)).toContain("exit_code: 0")
      expect(String(output)).toContain("original")
      expect(await fs.stat(path.join(target, "new.txt")).catch(() => undefined)).toBeUndefined()
    },
  })
}, 20_000)

test("integrity run_command background preview runs from an isolated project copy", async () => {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const tools = createIntegrityAcceptanceTools({ taskID: "tsk_integrity_background_isolated" })
      const output = await tools.run_command.execute!(
        {
          command: `bun -e "console.log('cwd=' + process.cwd()); console.log('http://127.0.0.1:32123'); setInterval(() => {}, 1000)"`,
          timeout_ms: 3_000,
          background: true,
        },
        {} as any,
      )
      const text = String(output)
      expect(text).toContain("background: true")
      expect(text).toContain("http://127.0.0.1:32123")
      expect(text).toContain(`source_cwd: ${dir.path}`)
      expect(text).toContain("execution_cwd:")
      const cwdLine = text
        .split(/\r?\n/)
        .find((line) => line.startsWith("cwd="))
        ?.slice("cwd=".length)
      expect(cwdLine).toBeDefined()
      expect(path.resolve(cwdLine!)).not.toBe(path.resolve(dir.path))
      expect(cwdLine).toContain(`${path.sep}.opencorvus${path.sep}`)
    },
  })
}, 20_000)

test("integrity background run_command cleans its isolated workspace on abort", async () => {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const controller = new AbortController()
      const tools = createIntegrityAcceptanceTools({
        taskID: "tsk_integrity_background_abort_cleanup",
        signal: controller.signal,
      })
      const output = await tools.run_command.execute!(
        {
          command: `bun -e "console.log('cwd=' + process.cwd()); console.log('http://127.0.0.1:32124'); setInterval(() => {}, 1000)"`,
          timeout_ms: 1_000,
          background: true,
        },
        {} as any,
      )
      const executionCwd = String(output)
        .split(/\r?\n/)
        .find((line) => line.startsWith("execution_cwd: "))
        ?.slice("execution_cwd: ".length)
      const pid = Number(
        String(output)
          .split(/\r?\n/)
          .find((line) => line.startsWith("pid: "))
          ?.slice("pid: ".length),
      )
      expect(executionCwd).toBeDefined()
      expect(Number.isInteger(pid)).toBe(true)
      await expect(fs.stat(executionCwd!)).resolves.toBeTruthy()

      controller.abort()
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const workspaceGone = !(await fs.stat(executionCwd!).catch(() => undefined))
        const processGone = !processIsRunning(pid)
        if (workspaceGone && processGone) return
        await Bun.sleep(50)
      }
      throw new Error(`expected aborted background process and workspace to be removed: ${pid} ${executionCwd}`)
    },
  })
}, 20_000)
