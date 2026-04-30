import z from "zod"

export const IntegritySubmitSchema = z.object({
  final: z.literal(true).describe("Explicit confirmation that every dimension verdict has been submitted."),
})
