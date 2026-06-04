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
