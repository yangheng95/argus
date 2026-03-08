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
  // Return empty object for null, undefined, or empty string input
  if (!input) {
    return {};
  }

  // Strip leading '?' if present (both "?a=1" and "a=1" are valid)
  const query = input.startsWith('?') ? input.slice(1) : input;

  // Return empty object if query is empty after stripping '?'
  if (!query) {
    return {};
  }

  const result: Record<string, string | string[] | null> = {};

  // Split by '&' and process each segment
  const segments = query.split('&');
  for (const segment of segments) {
    // Skip empty segments (e.g., from "a=1&&b=2")
    if (!segment) {
      continue;
    }

    // Find the first '=' to split key and value
    const equalsIndex = segment.indexOf('=');
    let key: string;
    let value: string | null;

    if (equalsIndex === -1) {
      // No '=' found: key with no value (e.g., "key" -> { key: null })
      key = decodeURIComponent(segment);
      value = null;
    } else {
      // Split at '=' and decode both key and value
      // URI decoding handles %20 -> space, %2F -> /, etc.
      key = decodeURIComponent(segment.slice(0, equalsIndex));
      value = decodeURIComponent(segment.slice(equalsIndex + 1));
    }

    // Handle duplicate keys by aggregating into arrays
    // First occurrence: store as single value
    // Second occurrence: convert to array [first, second]
    // Subsequent occurrences: push to existing array
    // Note: arrays only contain string values per test expectations
    if (key in result) {
      const existing = result[key];
      if (Array.isArray(existing)) {
        // existing is string[], convert value to string if null
        const stringValue = value === null ? '' : (value as string);
        existing.push(stringValue);
      } else {
        // Convert single value to array: [existing, value]
        // Convert null to empty string for array consistency
        const stringValue = value === null ? '' : (value as string);
        result[key] = [existing as string, stringValue];
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
  const parts: string[] = [];

  // Iterate over all key-value pairs in the params object
  for (const [key, value] of Object.entries(params)) {
    // Skip undefined values entirely (they don't appear in the output)
    if (value === undefined) {
      continue;
    }

    // Encode the key for safe URL usage (handles spaces, special chars, etc.)
    const encodedKey = encodeURIComponent(key);

    // Handle null values: produce bare key without '=' (e.g., { key: null } -> "key")
    if (value === null) {
      parts.push(encodedKey);
    }
    // Handle array values: produce repeated keys (e.g., { a: ["1", "2"] } -> "a=1&a=2")
    else if (Array.isArray(value)) {
      for (const item of value) {
        // Encode each array item for safe URL usage
        parts.push(`${encodedKey}=${encodeURIComponent(item)}`);
      }
    }
    // Handle string values: produce key=value pair
    else {
      parts.push(`${encodedKey}=${encodeURIComponent(value)}`);
    }
  }

  // Join all parts with '&' to form the final query string
  return parts.join('&');
}