import { describe, expect, test } from "bun:test"

/**
 * Hello World 测试文件
 * 验证 Bun 测试框架正常工作的基础测试
 */
describe("hello world", () => {
  /**
   * 测试 1: 验证字符串相等断言
   * 最基础的字符串比较测试
   */
  test("should verify hello equals hello", () => {
    const greeting = "hello"
    expect(greeting).toBe("hello")
  })

  /**
   * 测试 2: 验证数字计算断言
   * 基础数学运算测试
   */
  test("should verify 1 + 1 equals 2", () => {
    const result = 1 + 1
    expect(result).toBe(2)
  })

  /**
   * 测试 3: 验证对象属性断言
   * 基础对象属性比较测试
   */
  test("should verify object property", () => {
    const obj = { message: "hello world", count: 42 }
    expect(obj.message).toBe("hello world")
    expect(obj.count).toBe(42)
  })
})
