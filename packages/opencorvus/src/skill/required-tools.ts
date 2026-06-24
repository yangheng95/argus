import z from "zod"
import { LEGACY_DUPLICATE_TOOL_ID_SET, legacyDuplicateToolMessage } from "@/tool/global-tools"

export const SkillRequiredTools = z
  .array(z.string())
  .optional()
  .default([])
  .superRefine((value, ctx) => {
    for (const [index, toolID] of value.entries()) {
      if (!LEGACY_DUPLICATE_TOOL_ID_SET.has(toolID)) continue
      ctx.addIssue({
        code: "custom",
        path: [index],
        message: legacyDuplicateToolMessage(toolID),
      })
    }
  })
