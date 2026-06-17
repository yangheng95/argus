export function decodeProjectDirectory(raw: string) {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
