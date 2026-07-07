import { test } from "bun:test"

test("emits activity before hanging", async () => {
  process.stdout.write("activity-before-hang\n")
  await new Promise(() => undefined)
})
