import { expect, test } from "bun:test"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")

test("control prompt keeps create_task request as the complete user-input source", async () => {
  const source = await Bun.file(path.join(repoRoot, "packages/opencorvus/src/control/message.ts")).text()

  expect(source).toContain("When calling `panel.create_task`, set `create_task.request`")
  expect(source).toContain("complete, self-contained task request")
  expect(source).toContain("`Original user input` section")
  expect(source).toContain("task-relevant user text quoted verbatim")
  expect(source).toContain("Do not compress the request to only a URL/title")
  expect(source).toContain("do not move load-bearing constraints from the same user input into `send_task_message`")
})
