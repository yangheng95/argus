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
  // Handle null/undefined/empty input
  if (!input) {
    return {};
  }

  // Strip leading '?'
  const queryString = input.startsWith('?') ? input.slice(1) : input;

  // Handle empty string after stripping '?'
  if (!queryString) {
    return {};
  }

  const result: Record<string, string | string[] | null> = {};

  // Split by '&' to get segments
  const segments = queryString.split('&');

  for (const segment of segments) {
    // Skip empty segments (e.g., from "a=1&&b=2")
    if (!segment) {
      continue;
    }

    // Find first '=' index
    const eqIndex = segment.indexOf('=');

    let key: string;
    let value: string | null;

    if (eqIndex === -1) {
      // No '=' found: key=segment, value=null
      key = decodeURIComponent(segment);
      value = null;
    } else if (eqIndex === segment.length - 1) {
      // '=' at end: key=before, value=""
      key = decodeURIComponent(segment.slice(0, eqIndex));
      value = '';
    } else {
      // Normal case: split by first '='
      key = decodeURIComponent(segment.slice(0, eqIndex));
      value = decodeURIComponent(segment.slice(eqIndex + 1));
    }

    // Accumulate values: single value → string, multiple → string[]
    if (key in result) {
      const existing = result[key];
      if (Array.isArray(existing)) {
        // Already an array, push new value
        existing.push(value as string);
      } else {
        // Convert single value to array
        result[key] = [existing as string, value as string];
      }
    } else {
      // First occurrence
      result[key] = value;
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
  const parts: string[] = [];

  // Iterate over entries (preserves insertion order in modern JavaScript)
  for (const [key, value] of Object.entries(params)) {
    // Skip undefined values
    if (value === undefined) {
      continue;
    }

    // Encode the key
    const encodedKey = encodeURIComponent(key);

    if (value === null) {
      // null values produce bare keys
      parts.push(encodedKey);
    } else if (Array.isArray(value)) {
      // Array values produce repeated keys
      for (const v of value) {
        parts.push(`${encodedKey}=${encodeURIComponent(v)}`);
      }
    } else {
      // String values (including empty string)
      parts.push(`${encodedKey}=${encodeURIComponent(value)}`);
    }
  }

  // Join all parts with '&'
  return parts.join('&');
}