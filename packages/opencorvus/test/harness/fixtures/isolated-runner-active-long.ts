import { test } from "bun:test"
import { setTimeout as sleep } from "node:timers/promises"

test("keeps running while activity continues past Bun default timeout", async () => {
  for (let index = 0; index < 30; index++) {
    process.stdout.write(`active-${index}\n`)
    await sleep(200)
  }
})
