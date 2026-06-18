import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function read(rel: string): string {
  return readFileSync(join(OVERLAY_ROOT, rel), "utf8")
}

describe("Mission and Coding Assistant ledger row interactions", () => {
  const mission = read("src/components/MissionList.tsx")
  const assistant = read("src/components/CodingAssistantSessionList.tsx")

  test("ledger row containers are not exposed as nested buttons", () => {
    for (const source of [mission, assistant]) {
      expect(source).not.toContain('role="button"')
      expect(source).not.toContain("tabindex={0}")
      expect(source).not.toContain("event.target !== event.currentTarget")
    }
  })

  test("main row buttons remain the only keyboard selection controls", () => {
    expect(mission).toContain('class="task-row-main mission-row-main"')
    expect(mission).toContain("props.onSelectMission(props.mission)")
    expect(assistant).toContain('class="task-row-main coding-assistant-row-main"')
    expect(assistant).toContain("props.onSelectSession(props.session)")
  })

  test("selected row visual state is mirrored on the focusable main button", () => {
    expect(mission).toContain('data-active={props.selected ? "true" : undefined}')
    expect(mission).toContain('aria-current={props.selected ? "page" : undefined}')
    expect(assistant).toContain('data-active={props.selected ? "true" : undefined}')
    expect(assistant).toContain('aria-current={props.selected ? "page" : undefined}')
  })

  test("row action buttons stay sibling controls outside the main selection button", () => {
    const missionMain = mission.indexOf('class="task-row-main mission-row-main"')
    const missionActions = mission.indexOf('class="task-row-actions"', missionMain)
    const assistantMain = assistant.indexOf('class="task-row-main coding-assistant-row-main"')
    const assistantActions = assistant.indexOf('class="task-row-actions"', assistantMain)

    expect(missionMain).toBeGreaterThan(0)
    expect(missionActions).toBeGreaterThan(missionMain)
    expect(assistantMain).toBeGreaterThan(0)
    expect(assistantActions).toBeGreaterThan(assistantMain)
  })
})
