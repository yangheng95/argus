import { test } from "bun:test"

process.on("SIGTERM", () => {
  process.stdout.write("ignored-sigterm\n")
})

test("ignores SIGTERM before hanging", async () => {
  process.stdout.write("activity-before-hang\n")
  await new Promise(() => undefined)
})
