import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

const sessionRoute = path.join(import.meta.dir, "../../src/cli/cmd/tui/routes/session/index.tsx")

describe("OpenCode-derived inline tool row", () => {
  test("renders inline tools through the OpenCode row structure", () => {
    const source = readFileSync(sessionRoute, "utf8")

    expect(source).toContain("const INLINE_TOOL_ICON_WIDTH = 2")
    expect(source).toContain("export function InlineToolRow")
    expect(source).toContain('id={`tool-inline-${props.subagent ? "subagent-" : ""}${props.part.id}`}')
    expect(source).toContain("width={INLINE_TOOL_ICON_WIDTH}")
    expect(source).toContain("flexGrow={1}")
    expect(source).toContain("previous?.id.startsWith(\"tool-block-\")")
    expect(source).toContain("previous?.id.startsWith(\"tool-inline-\")")
    expect(source).toContain("props.separateAfter?.(previous?.id)")
  })

  test("keeps OpenCode error and denial display semantics", () => {
    const source = readFileSync(sessionRoute, "utf8")

    expect(source).toContain("const [errorExpanded, setErrorExpanded] = createSignal(false)")
    expect(source).toContain('error()?.includes("QuestionRejectedError")')
    expect(source).toContain('error()?.includes("rejected permission")')
    expect(source).toContain('error()?.includes("specified a rule")')
    expect(source).toContain('error()?.includes("user dismissed")')
    expect(source).toContain("const failed = createMemo(() => Boolean(error() && !denied()))")
    expect(source).toContain("setErrorExpanded((value) => !value)")
    expect(source).toContain("props.failed && props.errorExpanded")
    expect(source).toContain("TextAttributes.STRIKETHROUGH")
  })
})
