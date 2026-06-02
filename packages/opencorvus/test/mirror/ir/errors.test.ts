import { describe, test, expect } from "bun:test"
import {
  FigmaFetchError,
  UrlExtractError,
  CompileError,
  AnalyzeError,
  RenderError,
  EvaluateError,
} from "../../../src/mirror/errors"

describe("Typed errors", () => {
  test("FigmaFetchError carries structured data and name discriminator", () => {
    const err = new FigmaFetchError({ reason: "401 Unauthorized", status: 401 })
    expect(err.name).toBe("MirrorFigmaFetchError")
    expect(err.data.status).toBe(401)
    expect(err.data.reason).toBe("401 Unauthorized")
  })

  test("isInstance() dispatches on class identity", () => {
    const figma = new FigmaFetchError({ reason: "x" })
    const url = new UrlExtractError({ url: "https://example.test", reason: "y" })
    expect(FigmaFetchError.isInstance(figma)).toBe(true)
    expect(FigmaFetchError.isInstance(url)).toBe(false)
    expect(UrlExtractError.isInstance(url)).toBe(true)
  })

  test("toObject() yields name + data only (serializable)", () => {
    const err = new CompileError({ source: "url", reason: "empty tree" })
    const obj = err.toObject()
    expect(obj).toEqual({
      name: "MirrorCompileError",
      data: { source: "url", reason: "empty tree" },
    })
  })

  test("all error classes expose the expected names", () => {
    expect(new AnalyzeError({ reason: "x" }).name).toBe("MirrorAnalyzeError")
    expect(new RenderError({ url: "file:///tmp/index.html", reason: "x" }).name).toBe("MirrorRenderError")
    expect(new RenderError({ url: "file:///tmp/index.html", reason: "x", phase: "evaluate" }).data.phase).toBe("evaluate")
    expect(new EvaluateError({ reason: "x" }).name).toBe("MirrorEvaluateError")
  })

  test("instances are catchable via instanceof Error", () => {
    const err = new FigmaFetchError({ reason: "test" })
    expect(err).toBeInstanceOf(Error)
  })
})
