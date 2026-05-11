import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import type { SourceCoverageEntry } from "./fidelity"
import type { ContractIR, FieldSpec, ValueDomain } from "./contract-ir"

export interface LinkGoal {
  id: string
  depends_on: string[]
  exports: string[]
  imports: string[]
}

export interface LinkContract {
  ir: ContractIR
  goalIDs: string[]
}

export type LinkIssueKind =
  | "unresolved_symbol"
  | "undeclared_export"
  | "dependency_cycle"
  | "producer_not_dependency"
  | "extraction_failed"

export interface LinkIssue {
  kind: LinkIssueKind
  goalID?: string
  symbol?: string
  detail: string
}

export interface LinkContractsInput {
  goals: LinkGoal[]
  contracts: LinkContract[]
  sourceCoverage: SourceCoverageEntry[]
  workDir: string
}

export interface LinkResult {
  issues: LinkIssue[]
  index: Map<string, ContractIR>
}

interface ExtractedContract {
  ir: ContractIR
  aliases: string[]
}

export function linkContracts(input: LinkContractsInput): LinkResult {
  const issues: LinkIssue[] = []
  const index = new Map<string, ContractIR>()

  for (const contract of input.contracts) {
    index.set(normalizeSymbol(contract.ir.name), contract.ir)
  }

  for (const row of input.sourceCoverage) {
    if (row.action !== "reuse") continue
    for (const coveragePath of row.paths) {
      const absolutePath = path.resolve(input.workDir, coveragePath)
      if (!/\.(tsx|ts)$/.test(absolutePath)) continue
      try {
        for (const extracted of extractExportedContracts(absolutePath)) {
          for (const alias of extracted.aliases) {
            index.set(normalizeSymbol(alias), extracted.ir)
          }
        }
      } catch (error) {
        issues.push({
          kind: "extraction_failed",
          detail: `Reuse extraction failed for ${coveragePath}: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }
  }

  const goalsByID = new Map(input.goals.map((goal) => [goal.id, goal]))
  const producerBySymbol = new Map<string, Set<string>>()
  for (const goal of input.goals) {
    for (const symbol of parseContractSymbols(goal.exports)) {
      const normalized = normalizeSymbol(symbol)
      const producers = producerBySymbol.get(normalized) ?? new Set<string>()
      producers.add(goal.id)
      producerBySymbol.set(normalized, producers)
      if (!index.has(normalized)) {
        issues.push({
          kind: "undeclared_export",
          goalID: goal.id,
          symbol,
          detail: `Goal ${goal.id} exports "${symbol}" but no ContractIR with that name is registered or extracted.`,
        })
      }
    }
  }

  for (const goal of input.goals) {
    const ancestors = collectAncestors(goal, goalsByID)
    for (const symbol of parseContractSymbols(goal.imports)) {
      const normalized = normalizeSymbol(symbol)
      if (!index.has(normalized)) {
        issues.push({
          kind: "unresolved_symbol",
          goalID: goal.id,
          symbol,
          detail: `Goal ${goal.id} imports "${symbol}" but no ContractIR with that name is registered or extracted.`,
        })
        continue
      }
      const producers = producerBySymbol.get(normalized)
      if (!producers || producers.size === 0) continue
      const producerInAncestors = [...producers].some((producer) => ancestors.has(producer))
      if (!producerInAncestors) {
        issues.push({
          kind: "producer_not_dependency",
          goalID: goal.id,
          symbol,
          detail: `Goal ${goal.id} imports "${symbol}", but its producer goal(s) ${[...producers].join(", ")} are not in depends_on ancestry.`,
        })
      }
    }
  }

  for (const cycle of findDependencyCycles(input.goals)) {
    issues.push({
      kind: "dependency_cycle",
      detail: `Goal dependency cycle: ${cycle.join(" -> ")}`,
    })
  }

  return { issues, index }
}

export function parseContractSymbols(entries: readonly string[]): string[] {
  const symbols: string[] = []
  for (const entry of entries) {
    const beforeFrom = entry.split(/\s+from\s+/i)[0] ?? entry
    const cleaned = beforeFrom
      .replace(/^import\s+type\s+/i, "")
      .replace(/^import\s+/i, "")
      .replace(/^export\s+type\s+/i, "")
      .replace(/^export\s+/i, "")
      .replace(/[{}]/g, "")
      .trim()
    for (const rawPart of cleaned.split(",")) {
      const part = rawPart.trim()
      if (!part) continue
      const aliasSource = part.split(/\s+as\s+/i)[0]?.trim() ?? part
      const token = aliasSource.match(/[A-Za-z_$][\w$]*/)?.[0]
      if (token) symbols.push(token)
    }
  }
  return [...new Set(symbols)]
}

export function extractExportedContracts(filePath: string): ExtractedContract[] {
  if (!fs.existsSync(filePath)) {
    throw new Error("file does not exist")
  }
  const program = ts.createProgram([filePath], {
    allowJs: false,
    declaration: false,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  })
  const sourceFile = program.getSourceFile(filePath)
  if (!sourceFile) throw new Error("TypeScript program did not load source file")
  const diagnostics = ts.getPreEmitDiagnostics(program, sourceFile)
  const blocking = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
  if (blocking.length > 0) {
    const first = blocking[0]
    throw new Error(ts.flattenDiagnosticMessageText(first.messageText, "\n"))
  }

  const checker = program.getTypeChecker()
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
  if (!moduleSymbol) return []
  const contracts: ExtractedContract[] = []
  for (const exportSymbol of checker.getExportsOfModule(moduleSymbol)) {
    const symbol = resolveAlias(checker, exportSymbol)
    const declarations = symbol.getDeclarations() ?? exportSymbol.getDeclarations() ?? []
    const declaration = declarations[0]
    if (!declaration) continue
    const exportName = exportSymbol.getName()
    const declarationName = symbol.getName()
    const aliases = [...new Set([exportName, declarationName].filter((name) => name && name !== "__type"))]

    if (ts.isInterfaceDeclaration(declaration)) {
      const name = declaration.name.text
      const fields = fieldsFromType(checker, checker.getTypeAtLocation(declaration), declaration)
      if (fields.length > 0) contracts.push({ ir: { kind: "type", name, fields }, aliases: [...aliases, name] })
      continue
    }
    if (ts.isTypeAliasDeclaration(declaration)) {
      const name = declaration.name.text
      const union = literalUnionFromTypeNode(declaration.type)
      if (union.length > 0) {
        contracts.push({
          ir: { kind: "enum", name, variants: union.map((value) => ({ value, meaning: value })) },
          aliases: [...aliases, name],
        })
        continue
      }
      const type = checker.getTypeAtLocation(declaration)
      const fields = fieldsFromType(checker, type, declaration)
      if (fields.length > 0) contracts.push({ ir: { kind: "type", name, fields }, aliases: [...aliases, name] })
      continue
    }
    if (ts.isFunctionDeclaration(declaration) && declaration.name) {
      const signature = checker.getSignatureFromDeclaration(declaration)
      const params: FieldSpec[] = signature
        ? signature.getParameters().map((param) => {
          const paramDeclaration = param.valueDeclaration ?? declaration
          const type = checker.getTypeOfSymbolAtLocation(param, paramDeclaration)
          return {
            name: param.getName(),
            typeExpr: checker.typeToString(type),
            valueDomain: valueDomainFromType(type, checker),
          }
        })
        : []
      const returnType = signature ? checker.getReturnTypeOfSignature(signature) : checker.getTypeAtLocation(declaration)
      const name = declaration.name.text
      contracts.push({
        ir: {
          kind: "function",
          name,
          params,
          returns: {
            typeExpr: checker.typeToString(returnType),
            valueDomain: valueDomainFromType(returnType, checker),
          },
        },
        aliases: [...aliases, name],
      })
      continue
    }
    if (ts.isEnumDeclaration(declaration)) {
      const name = declaration.name.text
      const variants = declaration.members.map((member) => {
        const literal = member.initializer && ts.isStringLiteral(member.initializer)
          ? member.initializer.text
          : member.name.getText(sourceFile)
        return { value: literal, meaning: member.name.getText(sourceFile) }
      })
      contracts.push({ ir: { kind: "enum", name, variants }, aliases: [...aliases, name] })
    }
  }
  return contracts
}

function fieldsFromType(checker: ts.TypeChecker, type: ts.Type, location: ts.Node): FieldSpec[] {
  return checker.getPropertiesOfType(type).map((property) => {
    const declaration = property.valueDeclaration ?? location
    const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration)
    return {
      name: property.getName(),
      typeExpr: checker.typeToString(propertyType),
      valueDomain: valueDomainFromType(propertyType, checker),
    }
  })
}

function valueDomainFromType(type: ts.Type, checker: ts.TypeChecker): ValueDomain {
  const literals = stringLiteralValuesFromType(type)
  if (literals.length > 0) {
    return { kind: "literal_union", values: literals }
  }
  if (isNumberLike(type)) return { kind: "open", reason: "Extracted TypeScript number type has no declared numeric range." }
  const text = checker.typeToString(type)
  return { kind: "open", reason: `Extracted TypeScript type ${text} is not a closed literal domain.` }
}

function literalUnionFromTypeNode(node: ts.TypeNode): string[] {
  const values: string[] = []
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) return [node.literal.text]
  if (!ts.isUnionTypeNode(node)) return []
  for (const member of node.types) {
    if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal)) return []
    values.push(member.literal.text)
  }
  return [...new Set(values)]
}

function stringLiteralValuesFromType(type: ts.Type): string[] {
  if (type.isStringLiteral()) return [type.value]
  if (!type.isUnion()) return []
  const values: string[] = []
  for (const member of type.types) {
    if (!member.isStringLiteral()) return []
    values.push(member.value)
  }
  return [...new Set(values)]
}

function isNumberLike(type: ts.Type): boolean {
  return Boolean(type.flags & ts.TypeFlags.Number || type.flags & ts.TypeFlags.NumberLiteral)
}

function resolveAlias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  if (symbol.flags & ts.SymbolFlags.Alias) return checker.getAliasedSymbol(symbol)
  return symbol
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim()
}

function collectAncestors(goal: LinkGoal, goalsByID: Map<string, LinkGoal>): Set<string> {
  const ancestors = new Set<string>()
  const visit = (goalID: string) => {
    if (ancestors.has(goalID)) return
    ancestors.add(goalID)
    const parent = goalsByID.get(goalID)
    if (!parent) return
    for (const dep of parent.depends_on) visit(dep)
  }
  for (const dep of goal.depends_on) visit(dep)
  return ancestors
}

function findDependencyCycles(goals: LinkGoal[]): string[][] {
  const goalsByID = new Map(goals.map((goal) => [goal.id, goal]))
  const cycles: string[][] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []

  const visit = (goalID: string) => {
    if (visiting.has(goalID)) {
      const start = stack.indexOf(goalID)
      cycles.push([...stack.slice(start), goalID])
      return
    }
    if (visited.has(goalID)) return
    visiting.add(goalID)
    stack.push(goalID)
    const goal = goalsByID.get(goalID)
    if (goal) {
      for (const dep of goal.depends_on) visit(dep)
    }
    stack.pop()
    visiting.delete(goalID)
    visited.add(goalID)
  }

  for (const goal of goals) visit(goal.id)
  return cycles
}
