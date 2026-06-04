import z from "zod"
import { KeybindOverrides } from "@/cli/cmd/tui/config/keybind"

export const TuiOptions = z.object({
  scroll_speed: z.number().min(0.001).optional().describe("TUI scroll speed"),
  scroll_acceleration: z
    .object({
      enabled: z.boolean().describe("Enable scroll acceleration"),
    })
    .optional()
    .describe("Scroll acceleration settings"),
  diff_style: z
    .enum(["auto", "stacked"])
    .optional()
    .describe("Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column"),
  prompt: z
    .object({
      max_height: z.number().int().positive().optional().describe("Prompt textarea max height"),
      max_width: z
        .union([z.number().int().positive(), z.literal("auto")])
        .optional()
        .describe("Home prompt max width: a positive integer for a fixed cap, or 'auto' to scale with terminal width"),
    })
    .optional()
    .describe("Prompt size settings"),
})

export const TuiInfo = z
  .object({
    $schema: z.string().optional(),
    theme: z.string().optional(),
    keybinds: KeybindOverrides.optional(),
    leader_timeout: z.number().int().positive().optional().describe("Leader key timeout in milliseconds"),
  })
  .extend(TuiOptions.shape)
  .strict()
