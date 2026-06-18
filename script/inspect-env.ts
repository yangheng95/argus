export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Set ${name} before running this inspect script.`)
  }
  return value
}

export function requiredEnvList(name: string): string[] {
  const values = requiredEnv(name)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  if (values.length === 0) {
    throw new Error(`Set ${name} to at least one comma-separated value.`)
  }
  return values
}
