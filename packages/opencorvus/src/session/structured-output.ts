import { jsonSchema, tool, type Tool as AITool } from "ai"

export const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling it
- This tool provides your final answer - no further actions are taken after calling it`

export const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

export function createStructuredOutputTool(input: {
  schema: Record<string, unknown>
  onSuccess: (output: unknown) => void
}): AITool {
  const schema = { ...input.schema }
  delete schema.$schema

  return tool({
    id: "StructuredOutput" as any,
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(schema as any),
    async execute(args) {
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput(result) {
      return {
        type: "text",
        value: result.output,
      }
    },
  })
}
