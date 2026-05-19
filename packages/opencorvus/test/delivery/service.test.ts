import { expect, test } from "bun:test"
import { DeliveryFailureError, DeliveryService } from "../../src/delivery/service"

test("DeliveryService.verify is retired and cannot start a legacy acceptance path", async () => {
  await expect(
    DeliveryService.verify({
      task: { id: "tsk_retired_delivery", title: "Retired delivery", request: "verify" },
      goals: [],
      delivery: { summary: "legacy delivery row", changedFiles: [] },
    }),
  ).rejects.toThrow(DeliveryFailureError)
})
