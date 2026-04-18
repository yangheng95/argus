import { describe, test, expect } from "bun:test"
import { XmlIRSchema, type XmlIR } from "../../../src/mirror/ir/xml-ir"

describe("XmlIRSchema", () => {
  test("accepts minimal record with source/xml/bytes", () => {
    const ir: XmlIR = { source: "figma", xml: "<root/>", bytes: 7 }
    expect(() => XmlIRSchema.parse(ir)).not.toThrow()
  })

  test("rejects unknown source", () => {
    expect(() => XmlIRSchema.parse({ source: "pdf", xml: "", bytes: 0 })).toThrow()
  })

  test("accepts optional sectionIndex + estimatedTokens", () => {
    const ir: XmlIR = {
      source: "url",
      xml: "<root><s/></root>",
      bytes: 17,
      sectionIndex: { "s": { start: 6, end: 11 } },
      estimatedTokens: 5,
    }
    expect(() => XmlIRSchema.parse(ir)).not.toThrow()
  })

  test("rejects sectionIndex entry missing end offset", () => {
    expect(() =>
      XmlIRSchema.parse({
        source: "figma",
        xml: "",
        bytes: 0,
        sectionIndex: { bad: { start: 0 } as unknown as { start: number; end: number } },
      }),
    ).toThrow()
  })
})
