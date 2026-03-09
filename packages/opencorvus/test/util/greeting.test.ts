import { describe, expect, test } from "bun:test"
import { greet } from "../../src/util/greeting"

describe("util.greeting", () => {
  test("should return greeting with normal name", () => {
    expect(greet("World")).toBe("Hello World")
    expect(greet("Alice")).toBe("Hello Alice")
    expect(greet("Bob")).toBe("Hello Bob")
  })

  test("should handle empty string", () => {
    expect(greet("")).toBe("Hello ")
  })

  test("should handle whitespace", () => {
    expect(greet(" ")).toBe("Hello  ")
    expect(greet("  ")).toBe("Hello   ")
  })

  test("should handle special characters", () => {
    expect(greet("!@#$%")).toBe("Hello !@#$%")
    expect(greet("<>&")).toBe("Hello <>&")
  })

  test("should handle multilingual names", () => {
    expect(greet("世界")).toBe("Hello 世界")
    expect(greet("🌍")).toBe("Hello 🌍")
    expect(greet("こんにちは")).toBe("Hello こんにちは")
    expect(greet("Привет")).toBe("Hello Привет")
  })

  test("should handle long strings", () => {
    const longName = "A".repeat(1000)
    expect(greet(longName)).toBe(`Hello ${longName}`)
  })

  test("should handle numeric strings", () => {
    expect(greet("123")).toBe("Hello 123")
    expect(greet("0")).toBe("Hello 0")
  })

  test("should handle emoji", () => {
    expect(greet("👋")).toBe("Hello 👋")
    expect(greet("😀🎉🚀")).toBe("Hello 😀🎉🚀")
  })
})
