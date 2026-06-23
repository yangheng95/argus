import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "..", "..", "..")

function readProjectFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8")
}

test("TaskList row selection carries the clicked task directory into selectTask", () => {
  const taskList = readProjectFile("packages/overlay/src/components/TaskList.tsx")
  const main = readProjectFile("packages/overlay/src/main.tsx")

  expect(taskList).toContain("onSelectTask: (id: string, directory: string) => void")
  expect(taskList).toContain("onSelectTask: (taskID: string, directory: string) => void")
  expect(taskList).toContain("props.onSelectTask(id(), directory())")
  expect(taskList).not.toContain("props.onSelectTask(id())")

  expect(main).toContain("function selectTaskFromTaskList(taskID: string, directory?: string): void")
  expect(main).toContain("void selectTask(taskID, { directory })")
  expect(main).not.toContain("void selectTask(taskID)\n")
})
