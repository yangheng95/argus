import { isCanonicalProjectRelativePath as isCanonicalPluginProjectRelativePath } from "@opencorvus-ai/plugin"

export const PROJECT_RELATIVE_PATH_CONTRACT = "must be an exact portable canonical forward-slash project-relative path"

export function isCanonicalProjectRelativePath(value: unknown): value is string {
  return isCanonicalPluginProjectRelativePath(value)
}

export function requireCanonicalProjectRelativePath(
  value: unknown,
  label: string,
  reject: (message: string) => never,
): string {
  if (!isCanonicalProjectRelativePath(value)) reject(`${label} ${PROJECT_RELATIVE_PATH_CONTRACT}`)
  return value
}
