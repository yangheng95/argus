/**
 * 数学工具模块
 * 提供基础的数学运算函数
 */

/**
 * 加法运算
 * @param a - 第一个加数
 * @param b - 第二个加数
 * @returns 两数之和
 */
export function add(a: number, b: number): number {
  return a + b;
}

/**
 * 减法运算
 * @param a - 被减数
 * @param b - 减数
 * @returns 两数之差 (a - b)
 */
export function subtract(a: number, b: number): number {
  return a - b;
}

/**
 * 乘法运算
 * @param a - 被乘数
 * @param b - 乘数
 * @returns 两数之积
 */
export function multiply(a: number, b: number): number {
  return a * b;
}

/**
 * 除法运算
 * @param a - 被除数
 * @param b - 除数
 * @returns 两数之商 (a / b)
 * @throws Error 当除数为 0 时抛出 'Division by zero' 错误
 */
export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  return a / b;
}

/**
 * 将值限制在指定范围内
 * @param value - 需要限制的值
 * @param min - 最小值边界
 * @param max - 最大值边界
 * @returns 限制后的值，确保在 [min, max] 范围内
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
