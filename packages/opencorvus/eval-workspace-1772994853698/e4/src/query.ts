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
  // Return empty object for null/undefined/empty input
  if (input == null || input === "") {
    return {};
  }

  // Strip leading '?' if present
  const queryString = input.startsWith("?") ? input.slice(1) : input;

  // Return empty object if query string is empty after stripping '?'
  if (queryString === "") {
    return {};
  }

  const result: Record<string, string | string[] | null> = {};

  // Split by '&' to get segments
  const segments = queryString.split("&");

  for (const segment of segments) {
    // Filter out empty segments (handles 'a=1&&b=2' case)
    if (segment === "") {
      continue;
    }

    let key: string;
    let value: string | null;

    // Check if '=' exists
    const equalsIndex = segment.indexOf("=");
    if (equalsIndex === -1) {
      // No '=' means key with null value: "key" -> { key: null }
      key = decodeURIComponent(segment);
      value = null;
    } else {
      // Split at first '=' only
      key = decodeURIComponent(segment.slice(0, equalsIndex));
      value = decodeURIComponent(segment.slice(equalsIndex + 1));
    }

    // Handle duplicate keys by converting to array
    if (key in result) {
      const existing = result[key];
      if (Array.isArray(existing)) {
        // Already an array, push new value
        existing.push(value === null ? "" : value);
      } else {
        // Convert single value to array
        result[key] = [existing === null ? "" : existing, value === null ? "" : value];
      }
    } else {
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
  const pairs: string[] = [];

  // Iterate over Object.entries
  for (const [key, value] of Object.entries(params)) {
    // Skip undefined values
    if (value === undefined) {
      continue;
    }

    // Encode key with encodeURIComponent
    const encodedKey = encodeURIComponent(key);

    if (value === null) {
      // null values produce bare keys: { key: null } -> "key"
      pairs.push(encodedKey);
    } else if (Array.isArray(value)) {
      // Array values produce repeated keys: { a: ["1", "2"] } -> "a=1&a=2"
      for (const item of value) {
        pairs.push(`${encodedKey}=${encodeURIComponent(item)}`);
      }
    } else {
      // String values (including empty string)
      // Empty string produces "key="
      pairs.push(`${encodedKey}=${encodeURIComponent(value)}`);
    }
  }

  // Join all pairs with '&'
  return pairs.join("&");
}