export const TOOL_RESULT_PARK_METADATA_KEY = "opencorvusParkAfterToolResult"

export function shouldParkAfterToolResult(metadata: unknown): boolean {
  return (
    !!metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>)[TOOL_RESULT_PARK_METADATA_KEY] === true
  )
}
