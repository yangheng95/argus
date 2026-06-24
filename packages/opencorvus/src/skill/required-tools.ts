import z from "zod"
import { AgentToolPool } from "@/agent/tool-pool-contract"
import { LEGACY_DUPLICATE_TOOL_ID_SET, legacyDuplicateToolMessage } from "@/tool/global-tools"

export const SkillRequiredTools = z
  .array(z.string())
  .optional()
  .default([])
  .superRefine((value, ctx) => {
    const canonicalToolIDs = AgentToolPool.canonicalToolIDs()
    for (const [index, toolID] of value.entries()) {
      if (LEGACY_DUPLICATE_TOOL_ID_SET.has(toolID)) {
        ctx.addIssue({
          code: "custom",
          path: [index],
          message: legacyDuplicateToolMessage(toolID),
        })
        continue
      }
      if (!canonicalToolIDs.has(toolID)) {
        ctx.addIssue({
          code: "custom",
          path: [index],
          message: `${toolID} is not a canonical OpenCorvus tool ID`,
        })
      }
    }
  })
