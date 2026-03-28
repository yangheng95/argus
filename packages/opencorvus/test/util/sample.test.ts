import { describe, expect, test } from "bun:test"
import { capitalizeFirst } from "../../src/util/sample"

/**
 * 首字母大写函数测试文件
 * 测试 capitalizeFirst 函数的各种边界情况和正常场景
 */
describe("util.sample", () => {
  /**
   * 测试 1: 普通字符串首字母大写
   * 验证基础功能正常工作
   */
  test("should capitalize first letter of normal string", () => {
    expect(capitalizeFirst("hello")).toBe("Hello")
    expect(capitalizeFirst("world")).toBe("World")
    expect(capitalizeFirst("test")).toBe("Test")
  })

  /**
   * 测试 2: 空字符串处理
   * 验证空输入返回空字符串
   */
  test("should handle empty string", () => {
    expect(capitalizeFirst("")).toBe("")
  })

  /**
   * 测试 3: 单个字符处理
   * 验证单字符正确大写
   */
  test("should handle single character", () => {
    expect(capitalizeFirst("a")).toBe("A")
    expect(capitalizeFirst("z")).toBe("Z")
    expect(capitalizeFirst("A")).toBe("A")
  })

  /**
   * 测试 4: 已大写字符串保持不变
   * 验证首字母已大写时不重复处理
   */
  test("should keep already capitalized string unchanged", () => {
    expect(capitalizeFirst("Hello")).toBe("Hello")
    expect(capitalizeFirst("World")).toBe("World")
    expect(capitalizeFirst("ABC")).toBe("ABC")
  })

  /**
   * 测试 5: 非字母首字符保持不变
   * 验证数字开头的字符串不处理
   */
  test("should keep non-letter first character unchanged", () => {
    expect(capitalizeFirst("123abc")).toBe("123abc")
    expect(capitalizeFirst("0test")).toBe("0test")
    expect(capitalizeFirst("999")).toBe("999")
  })

  /**
   * 测试 6: 空白前缀处理
   * 验证空格开头的字符串不处理
   */
  test("should handle whitespace prefix", () => {
    expect(capitalizeFirst(" hello")).toBe(" hello")
    expect(capitalizeFirst("  test")).toBe("  test")
    expect(capitalizeFirst("\t")).toBe("\t")
  })

  /**
   * 测试 7: 特殊字符处理
   * 验证特殊符号开头的字符串不处理
   */
  test("should handle special character", () => {
    expect(capitalizeFirst("!hello")).toBe("!hello")
    expect(capitalizeFirst("@test")).toBe("@test")
    expect(capitalizeFirst("#hash")).toBe("#hash")
    expect(capitalizeFirst("<tag>")).toBe("<tag>")
  })

  /**
   * 测试 8: Unicode 字符处理
   * 验证 Unicode 字符（包括中文、emoji）正确处理
   */
  test("should handle unicode character", () => {
    expect(capitalizeFirst("你好")).toBe("你好")
    expect(capitalizeFirst("こんにちは")).toBe("こんにちは")
    expect(capitalizeFirst("🎉party")).toBe("🎉party")
    expect(capitalizeFirst("привет")).toBe("Привет")
  })

  /**
   * 测试 9: 多单词字符串
   * 验证只大写第一个单词的首字母
   */
  test("should handle multi-word string", () => {
    expect(capitalizeFirst("hello world")).toBe("Hello world")
    expect(capitalizeFirst("test case")).toBe("Test case")
    expect(capitalizeFirst("multiple words here")).toBe("Multiple words here")
  })

  /**
   * 测试 10: 大小写混合字符串
   * 验证只有首字母受影响
   */
  test("should handle mixed case string", () => {
    expect(capitalizeFirst("hELLO")).toBe("HELLO")
    expect(capitalizeFirst("tEsT")).toBe("TEsT")
    expect(capitalizeFirst("aBCdEF")).toBe("ABCdEF")
  })
})
