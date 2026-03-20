export function entries<T extends Record<string, unknown>>(input: T) {
  return Object.entries(input) as Array<[Extract<keyof T, string>, T[Extract<keyof T, string>]]>
}

export function values<T extends Record<string, unknown>>(input: T) {
  return Object.values(input) as Array<T[Extract<keyof T, string>]>
}
