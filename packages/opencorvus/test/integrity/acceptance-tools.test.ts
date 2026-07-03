import { afterEach, expect, test } from "bun:test"
import { createIntegrityAcceptanceTools } from "../../src/integrity/acceptance-tools"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

test("integrity tools do not expose final visual feedback verification inspection", async () => {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const tools = createIntegrityAcceptanceTools({
        taskID: "tsk_integrity_visual_context",
        visualQa: "Visual QA implementation defect context: code module implementation issues: none. This is not a visual acceptance verdict.",
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

test("integrity run_command filters evidence input views from readonly guard but keeps implementation mutations", async () => {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const tools = createIntegrityAcceptanceTools({ taskID: "tsk_integrity_guard_filter" })

      const evidenceOnly = await tools.run_command.execute!(
        {
          command: "mkdir -p web-clone-source && printf evidence > web-clone-source/reference.txt",
          timeout_ms: 10_000,
        },
        {} as any,
      )
      expect(String(evidenceOnly)).not.toContain("readonly_guard")

      const implementationMutation = await tools.run_command.execute!(
        {
          command: "mkdir -p src && printf implementation > src/changed.txt",
          timeout_ms: 10_000,
        },
        {} as any,
      )
      expect(String(implementationMutation)).toContain("readonly_guard")
      expect(String(implementationMutation)).toContain("src/changed.txt")
      expect(String(implementationMutation)).not.toContain("web-clone-source/reference.txt")
    },
  })
}, 20_000)

test("integrity run_command can launch a background preview command with a lease", async () => {
  await using dir = await tmpdir({ git: true })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const tools = createIntegrityAcceptanceTools({ taskID: "tsk_integrity_background" })
      const output = await tools.run_command.execute!(
        {
          command: `bun -e "console.log('http://127.0.0.1:32123'); setInterval(() => {}, 1000)"`,
          timeout_ms: 3_000,
          background: true,
        },
        {} as any,
      )
      expect(String(output)).toContain("background: true")
      expect(String(output)).toContain("http://127.0.0.1:32123")
    },
  })
}, 20_000)
