import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

test("Session.treeInProject returns root-first descendants scoped to one project", async () => {
  await using projectOne = await tmpdir({ git: true })
  await using projectTwo = await tmpdir({ git: true })

  let projectOneID = ""
  let rootID = ""
  let firstChildID = ""
  let secondChildID = ""
  let grandchildID = ""

  await Instance.provide({
    directory: projectOne.path,
    fn: async () => {
      projectOneID = Instance.project.id
      const root = await Session.create({ kind: "root", title: "tree root" })
      const firstChild = await Session.create({ kind: "orchestrator", parentID: root.id, title: "first child" })
      const secondChild = await Session.create({ kind: "build", parentID: root.id, title: "second child" })
      const grandchild = await Session.create({ kind: "evaluator", parentID: firstChild.id, title: "grandchild" })
      rootID = root.id
      firstChildID = firstChild.id
      secondChildID = secondChild.id
      grandchildID = grandchild.id
    },
  })

  await Instance.provide({
    directory: projectTwo.path,
    fn: async () => {
      const otherRoot = await Session.create({ kind: "root", title: "foreign root" })
      await Session.create({ kind: "build", parentID: otherRoot.id, title: "foreign child" })
    },
  })

  expect(await Session.treeInProject({ sessionID: rootID, projectID: projectOneID })).toEqual([
    rootID,
    firstChildID,
    secondChildID,
    grandchildID,
  ])
})

test("Session.treeInProject implementation does not recurse through childrenInProject", async () => {
  const source = await fs.readFile(new URL("../../src/session/index.ts", import.meta.url), "utf8")
  const start = source.indexOf("export const treeInProject")
  const end = source.indexOf("export const childrenInProject", start)
  const block = source.slice(start, end)

  expect(block).toContain(".from(SessionTable)")
  expect(block).not.toContain("childrenInProject(")
})
