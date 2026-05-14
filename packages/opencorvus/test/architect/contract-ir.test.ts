import { expect, test } from "bun:test"
import { ContractIRSchema } from "@/architect/contract-ir"

test("open valueDomain accepts short concrete reasons", () => {
  const parsed = ContractIRSchema.parse({
    kind: "type",
    name: "Order",
    fields: [
      {
        name: "note",
        typeExpr: "string",
        valueDomain: { kind: "open", reason: "free text" },
      },
    ],
  })

  expect(parsed.kind).toBe("type")
})

test("open valueDomain still rejects empty or placeholder reasons", () => {
  expect(() =>
    ContractIRSchema.parse({
      kind: "type",
      name: "Order",
      fields: [
        {
          name: "note",
          typeExpr: "string",
          valueDomain: { kind: "open", reason: "" },
        },
      ],
    }),
  ).toThrow("open valueDomain requires a concrete reason")

  expect(() =>
    ContractIRSchema.parse({
      kind: "type",
      name: "Order",
      fields: [
        {
          name: "note",
          typeExpr: "string",
          valueDomain: { kind: "open", reason: "TBD" },
        },
      ],
    }),
  ).toThrow("unknown/TBD is not a valid domain")
})
