/**
 * Parse a URL query string into a key-value map.
 *
 * Requirements:
 * - Input: "?key1=value1&key2=value2" or "key1=value1&key2=value2" (leading ? is optional)
 * - Decode URI-encoded values (%20 -> space, etc.)
 * - Support array values: "a=1&a=2" -> { a: ["1", "2"] }
 * - Support empty values: "key=" -> { key: "" }
 * - Support no-value keys: "key" -> { key: null }
 * - Ignore empty segments: "a=1&&b=2" -> { a: "1", b: "2" }
 * - Return empty object for empty/null/undefined input
 */
export function parseQuery(input: string | null | undefined): Record<string, string | string[] | null> {
  // 处理空输入：null、undefined 或空字符串直接返回空对象
  if (!input) {
    return {};
  }

  // 去除开头的 ?（如果存在）
  const queryString = input.startsWith('?') ? input.slice(1) : input;

  // 如果去除 ? 后为空，也返回空对象
  if (!queryString) {
    return {};
  }

  // 按 & 分割成多个 segment，并过滤掉空 segment（处理 "a=1&&b=2" 这种情况）
  const segments = queryString.split('&').filter(seg => seg.length > 0);

  // 使用临时对象收集所有键值对，先用 (string | null)[] 类型收集
  const tempResult: Record<string, (string | null)[]> = {};

  for (const seg of segments) {
    // 找到第一个 = 的位置来分割 key 和 value
    const eqIdx = seg.indexOf('=');
    let key: string;
    let value: string | null;

    if (eqIdx === -1) {
      // 没有 = 号，key 为整个 segment，value 为 null
      key = seg;
      value = null;
    } else {
      // 有 = 号，分割 key 和 value
      key = seg.slice(0, eqIdx);
      // value 部分需要 URI 解码，空字符串保持为空字符串
      value = decodeURIComponent(seg.slice(eqIdx + 1));
    }

    // 收集到临时对象中（使用数组形式以便处理重复 key）
    if (tempResult[key]) {
      tempResult[key].push(value);
    } else {
      tempResult[key] = [value];
    }
  }

  // 将临时结果转换为最终格式：单值转为 string 或 null，多值转为 string[]
  const result: Record<string, string | string[] | null> = {};
  for (const [key, values] of Object.entries(tempResult)) {
    if (values.length === 1) {
      // 单个值：如果是 null 保持 null，否则是 string
      result[key] = values[0];
    } else {
      // 多个值：转为 string[]，过滤掉 null 值（理论上不应该出现，但为了类型安全）
      // 实际上如果同一个 key 多次出现且都是无值情况，应该转为数组
      // 但类型定义要求 string[]，所以需要将 null 转换为空字符串或其他处理
      // 根据常见实践，我们将 null 转为空字符串
      result[key] = values.map(v => v === null ? '' : v);
    }
  }

  return result;
}

/**
 * Serialize a key-value map back into a query string (without leading ?).
 *
 * Requirements:
 * - Encode special characters in keys and values
 * - Array values produce repeated keys: { a: ["1", "2"] } -> "a=1&a=2"
 * - null values produce bare keys: { key: null } -> "key"
 * - Empty string values produce "key="
 * - Skip undefined values
 */
export function stringifyQuery(params: Record<string, string | string[] | null | undefined>): string {
  const result: string[] = [];

  // 遍历所有键值对
  for (const [key, value] of Object.entries(params)) {
    // 跳过 undefined 值
    if (value === undefined) {
      continue;
    }

    // 对 key 进行 URI 编码
    const encodedKey = encodeURIComponent(key);

    if (value === null) {
      // null 值：只输出编码后的 key，不带 =
      result.push(encodedKey);
    } else if (Array.isArray(value)) {
      // 数组值：对每个元素输出 encodedKey=encodedValue
      for (const item of value) {
        result.push(`${encodedKey}=${encodeURIComponent(item)}`);
      }
    } else {
      // 字符串值：输出 encodedKey=encodedValue
      result.push(`${encodedKey}=${encodeURIComponent(value)}`);
    }
  }

  // 用 & 连接所有 segment
  return result.join('&');
}