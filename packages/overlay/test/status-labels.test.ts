import { beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  TASK_LIFECYCLE_STATUSES,
  WORKFLOW_STEP_STATUSES,
  UnsupportedStatusLabelError,
  taskLifecycleStatusLabel,
  taskLifecycleStatusLabelFromString,
  taskLifecycleStatusOrIdleLabel,
  workflowStepStatusLabel,
  workflowStepStatusLabelFromString,
} from "../src/utils/status-labels"
import { setLocale, setLocaleData } from "../src/utils/i18n"

const overlayRoot = join(import.meta.dir, "..")
const enUS = JSON.parse(readFileSync(join(overlayRoot, "src/i18n/en-US.json"), "utf8"))

beforeAll(async () => {
  setLocaleData("en-US", enUS)
  await setLocale("en-US")
})

function source(path: string): string {
  return readFileSync(resolve(overlayRoot, "..", "..", path), "utf8")
}

describe("status label domains", () => {
  test("task lifecycle labels accept only backend lifecycle statuses", () => {
    expect(TASK_LIFECYCLE_STATUSES).toEqual(["queued", "active", "completed", "failed", "cancelled"])
    expect(taskLifecycleStatusLabel("queued")).toBe("Queued")
    expect(taskLifecycleStatusLabel("active")).toBe("Active")
    expect(taskLifecycleStatusLabel("completed")).toBe("Completed")
    expect(taskLifecycleStatusLabel("failed")).toBe("Failed")
    expect(taskLifecycleStatusLabel("cancelled")).toBe("Cancelled")
    expect(taskLifecycleStatusLabelFromString(" active ")).toBe("Active")
    expect(() => taskLifecycleStatusLabelFromString("running")).toThrow(UnsupportedStatusLabelError)
    expect(() => taskLifecycleStatusLabelFromString("idle")).toThrow(UnsupportedStatusLabelError)
    expect(() => taskLifecycleStatusLabelFromString("")).toThrow(UnsupportedStatusLabelError)
  })

  test("idle is only the explicit no-selected-task label", () => {
    expect(taskLifecycleStatusOrIdleLabel("")).toBe("Idle")
    expect(taskLifecycleStatusOrIdleLabel(null)).toBe("Idle")
    expect(taskLifecycleStatusOrIdleLabel(undefined)).toBe("Idle")
    expect(taskLifecycleStatusOrIdleLabel("queued")).toBe("Queued")
    expect(() => taskLifecycleStatusOrIdleLabel("running")).toThrow(UnsupportedStatusLabelError)
  })

  test("workflow step labels use the workflow status domain", () => {
    expect(WORKFLOW_STEP_STATUSES).toEqual(["pending", "running", "completed", "skipped", "failed"])
    expect(workflowStepStatusLabel("pending")).toBe("Pending")
    expect(workflowStepStatusLabel("running")).toBe("Running")
    expect(workflowStepStatusLabel("completed")).toBe("Completed")
    expect(workflowStepStatusLabel("skipped")).toBe("Skipped")
    expect(workflowStepStatusLabel("failed")).toBe("Failed")
    expect(workflowStepStatusLabelFromString(" running ")).toBe("Running")
    expect(() => workflowStepStatusLabelFromString("active")).toThrow(UnsupportedStatusLabelError)
    expect(() => workflowStepStatusLabelFromString("")).toThrow(UnsupportedStatusLabelError)
  })
})

describe("status label adoption guards", () => {
  test("overlay task surfaces use shared status label helpers", () => {
    const files = [
      "packages/overlay/src/components/Board.tsx",
      "packages/overlay/src/components/TaskList.tsx",
      "packages/overlay/src/components/MissionList.tsx",
      "packages/overlay/src/components/Conversation.tsx",
      "packages/overlay/src/components/TaskStatusHeader.tsx",
      "packages/overlay/src/components/titlebar/TitlebarMenubar.tsx",
    ]
    for (const file of files) {
      const text = source(file)
      expect(text).not.toContain("return map[status] || status")
      expect(text).not.toContain("translated === key ?")
      expect(text).not.toContain("function missionTaskStatusLabel")
      expect(text).not.toContain("function taskStatusLabel")
    }

    expect(source("packages/overlay/src/components/Board.tsx")).not.toContain("function statusLabel")
    expect(source("packages/overlay/src/components/TaskList.tsx")).not.toContain("function statusLabel")
    expect(source("packages/overlay/src/components/TaskStatusHeader.tsx")).not.toContain("t(`task.status.${")
    expect(source("packages/overlay/src/components/titlebar/TitlebarMenubar.tsx")).not.toContain(
      't("task.status.running")',
    )
  })

  test("browser fixtures do not use workflow running as task lifecycle status", () => {
    const files = [
      "packages/overlay/test/browser/controls.test.ts",
      "packages/overlay/test/browser/browser-preview-evidence.test.ts",
      "packages/overlay/test/browser/browser-preview-visual-stress.test.ts",
      "packages/overlay/test/browser/agent-compact-visual-stress.test.ts",
      "packages/overlay/test/browser/interaction-card-textarea-browser.test.ts",
      "packages/overlay/test/browser/loading-spinner-motion-browser.test.ts",
      "packages/overlay/test/browser/rewind-visual-stress.test.ts",
      "packages/overlay/test/browser/toolbar-diff-navigation.test.ts",
      "packages/overlay/test/browser/workflow-generating-status-browser.test.ts",
      "packages/overlay/test/goal-group-benchmark.ts",
    ]
    const namedTaskFixture = /const\s+\w*[Tt]ask\w*\s*=\s*\{[^}]*status:\s*"running"/
    const boardTaskFixture = /(?:^|\n)\s*task:\s*\{[^}]*status:\s*"running"/
    for (const file of files) {
      const text = source(file)
      expect(namedTaskFixture.test(text), file).toBe(false)
      expect(boardTaskFixture.test(text), file).toBe(false)
    }
  })

  test("visual benchmark fixtures keep task-list and route errors strict", () => {
    const goalGroup = source("packages/overlay/test/goal-group-benchmark.ts")
    expect(goalGroup).toContain('path === "/global/tasks"')
    expect(goalGroup).toContain('path === "/tasks"')
    expect(goalGroup).toContain('`/task/${TASK_ID}/conversation`')
    expect(goalGroup).toContain("conversationHydrateHit")
    expect(goalGroup).toContain('status >= 400')
    expect(goalGroup).toContain('page.on("requestfailed"')
    expect(goalGroup).toContain("rawTranscriptMessages.map")
    expect(goalGroup).toContain("transcriptViewMessages")
    expect(goalGroup).toContain("transcriptViewSessions")
    expect(goalGroup).toContain('benchmarkOrderKey("message"')
    expect(goalGroup).toContain('benchmarkOrderKey("part"')
    expect(goalGroup).toContain('benchmarkOrderKey("session"')
    expect(goalGroup).not.toContain("messages: []")
    expect(goalGroup).not.toContain('path === "/tasks" || path === "/global/tasks"')
    expect(goalGroup).not.toContain('path === "/global/tasks" || path === "/tasks"')
    expect(goalGroup).not.toContain("time_created")
    expect(goalGroup).not.toContain("time_updated")

    const taskListPerf = source("packages/overlay/test/browser/task-list-perf.test.ts")
    expect(taskListPerf).toContain('path === "/project/current/worktrees") return send([])')
    expect(taskListPerf).toContain('orderKey: testTaskOrderKey(id, created)')
    expect(taskListPerf).toContain('failure.errorText === "net::ERR_ABORTED"')
    expect(taskListPerf).toContain('value: mission.updated')
    expect(taskListPerf).toContain('data-ui="mission-ledger-load-more"')
    expect(taskListPerf).toContain("search rendered an unproven global queue ordinal")
    expect(taskListPerf).toContain("task-perf-290")
    expect(taskListPerf).toContain("Mission delayed load-more request was not observed")
    expect(source("packages/overlay/test/fixtures/timeline-order.ts")).toContain(
      'return testTimelineOrderKey(10, time, id, 0, "task")',
    )
    expect(taskListPerf).not.toContain('path === "/project/current/worktrees") return send({ worktrees: [] })')

    const missionLoop = source("packages/overlay/test/mission-visual-loop.ts")
    expect(missionLoop).toContain("Unhandled mission visual fixture route")
    expect(missionLoop).toContain("runtimeFailures.push")
    expect(missionLoop).toContain('pathname === "/global/tasks"')
    expect(missionLoop).toContain('pathname === "/mission/wake"')
    expect(missionLoop).toContain("missionConversationHits")
    expect(missionLoop).toContain('page.click(\'[data-ui="mission-composer-submit"]\')')
    expect(missionLoop).toContain("Mission launcher follow-up conversation hydrate")
    expect(missionLoop).toContain("messages: [")
    expect(missionLoop).toContain('[overlay/response ${status}]')
    expect(missionLoop).toContain('[overlay/${type}]')
    expect(missionLoop).toContain("assertNoRuntimeFailures")
    expect(missionLoop).not.toContain(".test(url)")
    expect(missionLoop).not.toContain("Default: empty 200")
  })
})
