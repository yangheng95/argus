/**
 * @file hello.ts
 * @description Hello World 模块 - 提供简单的问候语生成功能
 * @module hello
 */

/**
 * 生成问候语字符串
 *
 * @param name - 要问候的对象名称，可选参数，默认为 'World'
 * @returns 格式化的问候字符串，格式为 'Hello, {name}!'
 *
 * @example
 * // 返回 'Hello, World!'
 * helloWorld()
 *
 * @example
 * // 返回 'Hello, Alice!'
 * helloWorld('Alice')
 */
export function helloWorld(name?: string): string {
  // 如果未提供 name 参数，使用默认值 'World'
  const greetingName = name ?? "World"

  // 返回格式化的问候字符串
  return `Hello, ${greetingName}!`
}
