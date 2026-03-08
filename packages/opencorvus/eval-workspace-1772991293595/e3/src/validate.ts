/**
 * 验证 name 为非空字符串
 * @param value - 待验证的值，类型为 unknown
 * @returns trim 后的字符串
 * @throws 如果 value 不是字符串或 trim 后为空，抛出 "Name is required and must be a non-empty string" 错误
 */
export function validateName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Name is required and must be a non-empty string");
  }
  return value.trim();
}

/**
 * 验证 email 为包含 @ 的字符串
 * @param value - 待验证的值，类型为 unknown
 * @returns trim 后的字符串
 * @throws 如果 value 不是字符串或不包含 @，抛出 "Email must be a valid email address" 错误
 */
export function validateEmail(value: unknown): string {
  if (typeof value !== "string" || !value.includes("@")) {
    throw new Error("Email must be a valid email address");
  }
  return value.trim();
}

/**
 * 验证 age 为 0-150 的数字
 * @param value - 待验证的值，类型为 unknown
 * @returns 验证通过的数字
 * @throws 如果 value 不是数字或不在 0-150 范围内，抛出 "Age must be a number between 0 and 150" 错误
 */
export function validateAge(value: unknown): number {
  if (typeof value !== "number" || value < 0 || value > 150) {
    throw new Error("Age must be a number between 0 and 150");
  }
  return value;
}
