/** Returns `input` as a plain object, or `{}` if it's not a non-array object. */
export function dict(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

/** Returns `input` as a plain object, or `undefined` if it's not a non-array object. */
export function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined
}

export function entries<T extends Record<string, unknown>>(input: T) {
  return Object.entries(input) as Array<[Extract<keyof T, string>, T[Extract<keyof T, string>]]>
}

export function values<T extends Record<string, unknown>>(input: T) {
  return Object.values(input) as Array<T[Extract<keyof T, string>]>
}
