import { describe, expect, test } from "bun:test"
import {
  extractTitle,
  generateSummary,
  validateContent,
  processText,
  TITLE_LENGTH,
} from "../../src/quicknote/text-processor"

describe("quicknote.text-processor", () => {
  describe("extractTitle", () => {
    test("extracts first 15 characters as title", () => {
      const content = "这是一个测试笔记内容，用于验证标题提取功能"
      const title = extractTitle(content)
      expect(title.length).toBe(TITLE_LENGTH)
      expect(title).toBe(content.slice(0, 15))
    })

    test("handles content shorter than 15 characters", () => {
      const content = "短内容"
      const title = extractTitle(content)
      expect(title).toBe("短内容")
    })

    test("trims whitespace before extracting", () => {
      const content = "  带空白的内容测试  "
      const title = extractTitle(content)
      expect(title).toBe("带空白的内容测试")
    })

    test("returns empty string for empty content", () => {
      expect(extractTitle("")).toBe("")
      expect(extractTitle("   ")).toBe("")
    })
  })

  describe("generateSummary", () => {
    test("generates summary up to 100 characters", () => {
      const content = "A".repeat(150)
      const summary = generateSummary(content)
      expect(summary.length).toBeLessThanOrEqual(100)
      expect(summary).toContain("...")
    })

    test("returns full content if under 100 characters", () => {
      const content = "短内容摘要测试"
      const summary = generateSummary(content)
      expect(summary).toBe("短内容摘要测试")
    })

    test("trims whitespace before generating", () => {
      const content = "  带空白的内容  "
      const summary = generateSummary(content)
      expect(summary).toBe("带空白的内容")
    })

    test("returns empty string for empty content", () => {
      expect(generateSummary("")).toBe("")
    })
  })

  describe("validateContent", () => {
    test("validates content within limits", () => {
      const content = "有效的测试内容"
      const result = validateContent(content)
      expect(result).toBe(true)
    })

    test("accepts empty content", () => {
      const result = validateContent("")
      expect(result).toBe(true)
    })

    test("rejects content over 2000 characters", () => {
      const content = "A".repeat(2001)
      const result = validateContent(content)
      expect(result).toBe(false)
    })

    test("accepts content exactly at 2000 characters", () => {
      const content = "A".repeat(2000)
      const result = validateContent(content)
      expect(result).toBe(true)
    })
  })

  describe("processText", () => {
    test("processes valid content successfully", () => {
      const content = "这是一个测试笔记，用于验证完整的文本处理流程"
      const result = processText(content)
      expect(result.valid).toBe(true)
      expect(result.title.length).toBe(TITLE_LENGTH)
      expect(result.summary).toBe(content.slice(0, 100))
    })

    test("fails for invalid content", () => {
      const result = processText("")
      expect(result.valid).toBe(false)
      expect(result.title).toBe("")
      expect(result.summary).toBe("")
      expect(result.error).toBeDefined()
    })

    test("truncates summary for long content", () => {
      const content = "A".repeat(150)
      const result = processText(content)
      expect(result.valid).toBe(true)
      expect(result.title).toBe("A".repeat(15))
      expect(result.summary.length).toBeLessThanOrEqual(100)
    })
  })
})
