/**
 * 将字符串的首字母大写
 *
 * 如果字符串为空或首字符不是字母，则返回原字符串
 * 支持 Unicode 字符处理
 *
 * @param str - 要处理的字符串
 * @returns 首字母大写后的字符串
 * @example
 * capitalizeFirst("hello") // "Hello"
 * capitalizeFirst("world") // "World"
 * capitalizeFirst("") // ""
 * capitalizeFirst("123abc") // "123abc"
 */
export function capitalizeFirst(str: string): string {
  if (str.length === 0) {
    return str
  }

  const firstChar = str[0]
  const uppercased = firstChar.toUpperCase()

  // 如果首字符大写后没有变化（非字母字符），返回原字符串
  if (firstChar === uppercased) {
    return str
  }

  return uppercased + str.slice(1)
}
