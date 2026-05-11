import z from "zod"

const unknownOpenReason = /\b(tbd|unknown|unsure|unclear|n\/a|todo)\b/i

export const ValueDomainSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("open"),
    reason: z.string().min(10).refine((value) => !unknownOpenReason.test(value), {
      message: "open valueDomain requires a concrete reason; unknown/TBD is not a valid domain",
    }),
  }),
  z.object({
    kind: z.literal("literal_union"),
    values: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal("branded"),
    brand: z.string().min(1),
    examples: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal("numeric_range"),
    min: z.number().optional(),
    max: z.number().optional(),
  }).refine((value) => value.min !== undefined || value.max !== undefined, {
    message: "numeric_range requires min or max",
  }),
  z.object({
    kind: z.literal("ref"),
    contractName: z.string().min(1),
  }),
])

export type ValueDomain = z.infer<typeof ValueDomainSchema>

export const TypeSpecSchema = z.object({
  typeExpr: z.string().min(1),
  valueDomain: ValueDomainSchema,
  semantic: z.string().min(1).optional(),
})
export type TypeSpec = z.infer<typeof TypeSpecSchema>

export const FieldSpecSchema = TypeSpecSchema.extend({
  name: z.string().min(1),
})
export type FieldSpec = z.infer<typeof FieldSpecSchema>

export const ContractIRSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("type"),
    name: z.string().min(1),
    fields: z.array(FieldSpecSchema).min(1),
  }),
  z.object({
    kind: z.literal("function"),
    name: z.string().min(1),
    params: z.array(FieldSpecSchema),
    returns: TypeSpecSchema,
  }),
  z.object({
    kind: z.literal("enum"),
    name: z.string().min(1),
    variants: z.array(z.object({
      value: z.string().min(1),
      meaning: z.string().min(1),
    })).min(1),
  }),
])

export type ContractIR = z.infer<typeof ContractIRSchema>
export type ContractCategory = "type_contract" | "function_contract" | "enum_contract"

export function contractCategory(ir: ContractIR): ContractCategory {
  if (ir.kind === "type") return "type_contract"
  if (ir.kind === "function") return "function_contract"
  return "enum_contract"
}

export function renderContractIR(ir: ContractIR): string {
  const lines: string[] = []
  if (ir.kind === "type") {
    lines.push(`type ${ir.name}`)
    for (const field of ir.fields) {
      lines.push(`- ${field.name}: ${field.typeExpr}; domain=${renderValueDomain(field.valueDomain)}${field.semantic ? `; semantic=${field.semantic}` : ""}`)
    }
    return lines.join("\n")
  }
  if (ir.kind === "function") {
    lines.push(`function ${ir.name}`)
    lines.push("params:")
    for (const param of ir.params) {
      lines.push(`- ${param.name}: ${param.typeExpr}; domain=${renderValueDomain(param.valueDomain)}${param.semantic ? `; semantic=${param.semantic}` : ""}`)
    }
    lines.push(`returns: ${ir.returns.typeExpr}; domain=${renderValueDomain(ir.returns.valueDomain)}${ir.returns.semantic ? `; semantic=${ir.returns.semantic}` : ""}`)
    return lines.join("\n")
  }
  lines.push(`enum ${ir.name}`)
  for (const variant of ir.variants) {
    lines.push(`- ${variant.value}: ${variant.meaning}`)
  }
  return lines.join("\n")
}

function renderValueDomain(domain: ValueDomain): string {
  if (domain.kind === "open") return `open(reason=${domain.reason})`
  if (domain.kind === "literal_union") return `literal_union(${domain.values.map((value) => JSON.stringify(value)).join(" | ")})`
  if (domain.kind === "branded") return `branded(${domain.brand}; examples=${domain.examples.map((value) => JSON.stringify(value)).join(", ")})`
  if (domain.kind === "numeric_range") return `numeric_range(min=${domain.min ?? "-inf"}, max=${domain.max ?? "+inf"})`
  return `ref(${domain.contractName})`
}
