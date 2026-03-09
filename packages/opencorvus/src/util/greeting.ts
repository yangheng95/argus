/**
 * 生成问候语字符串
 *
 * @param name 要问候的名称
 * @returns 格式为 "Hello name" 的问候语字符串
 * @example
 * greet("World") // "Hello World"
 * greet("Alice") // "Hello Alice"
 */
export function greet(name: string): string {
  return `Hello ${name}`
}
