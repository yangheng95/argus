import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import type { ContractIR, TypeSpec, ValueDomain } from "@/architect/contract-ir"
import { parseContractSymbols } from "@/architect/linker"
import { resolveTrigger, type AcceptanceSpec, type ContractAuditScorer } from "./types"

export type ContractAuditStatus = "passed" | "failed" | "skipped"

export interface ContractAuditGoal {
  id: string
  imports: string[]
  exports: string[]
  owned_paths: string[]
}

export interface ContractAuditCriteriaResult {
  name: string
  label: string
  family: "contract_audit"
  status: ContractAuditStatus
  evidence: string
}

interface AuditableField {
  contractName: string
  fieldName: string
  expectedValues: string[]
}

interface Finding {
  file: string
  line: number
  fieldName: string
  literal: string
  expectedValues: string[]
}

export function contractAuditCriteriaName(spec: AcceptanceSpec, scorer: ContractAuditScorer): string {
  return `acceptance:${spec.id}:${scorer.name}`
}

export function contractAuditRequired(spec: AcceptanceSpec, scorer: ContractAuditScorer): boolean {
  return spec.severity === "essential" && resolveTrigger(spec, scorer) === "on_goal"
}

export function contractAuditBoundarySymbols(goal: Pick<ContractAuditGoal, "imports" | "exports">): string[] {
  return [...new Set([
    ...parseContractSymbols(goal.imports),
    ...parseContractSymbols(goal.exports),
  ])]
}

export function runContractAudit(input: {
  workDir: string
  index: Map<string, ContractIR>
  goal: ContractAuditGoal
  spec: AcceptanceSpec
  scorer: ContractAuditScorer
}): ContractAuditCriteriaResult {
  const boundarySymbols = contractAuditBoundarySymbols(input.goal)
  if (boundarySymbols.length === 0) {
    return {
      name: contractAuditCriteriaName(input.spec, input.scorer),
      label: `${input.spec.title} / ${input.scorer.name}`,
      family: "contract_audit",
      status: "skipped",
      evidence: `goal=${input.goal.id}; no imports/exports declared, contract_audit no-op`,
    }
  }

  const requestedSymbols = input.scorer.spec.symbols?.length ? input.scorer.spec.symbols : boundarySymbols
  const fields = auditFieldsForSymbols({
    index: input.index,
    symbols: requestedSymbols.filter((symbol) => boundarySymbols.includes(symbol)),
  })
  if (fields.length === 0) {
    return {
      name: contractAuditCriteriaName(input.spec, input.scorer),
      label: `${input.spec.title} / ${input.scorer.name}`,
      family: "contract_audit",
      status: "skipped",
      evidence: `goal=${input.goal.id}; symbols=${requestedSymbols.join(",")}; no literal_union/ref-resolved/branded-resolved fields to audit`,
    }
  }

  const files = collectSourceFiles(input.workDir, input.goal.owned_paths)
  if (files.length === 0) {
    return {
      name: contractAuditCriteriaName(input.spec, input.scorer),
      label: `${input.spec.title} / ${input.scorer.name}`,
      family: "contract_audit",
      status: "failed",
      evidence: `goal=${input.goal.id}; no TypeScript source files found in owned_paths=${input.goal.owned_paths.join(",")}`,
    }
  }

  const findings: Finding[] = []
  let observedAssignments = 0
  for (const file of files) {
    const sourceText = fs.readFileSync(file, "utf8")
    const sourceFile = ts.createSourceFile(
      file,
      sourceText,
      scriptTargetForPath(file),
      true,
      scriptKindForPath(file),
    )
    const relativeFile = path.relative(input.workDir, file).replaceAll("\\", "/")
    const fieldByName = new Map(fields.map((field) => [field.fieldName, field]))
    visitStringLiteralAssignments(sourceFile, (fieldName, literal, node) => {
      const field = fieldByName.get(fieldName)
      if (!field) return
      observedAssignments++
      if (field.expectedValues.includes(literal)) return
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      findings.push({
        file: relativeFile,
        line: position.line + 1,
        fieldName,
        literal,
        expectedValues: field.expectedValues,
      })
    })
  }

  if (findings.length > 0) {
    return {
      name: contractAuditCriteriaName(input.spec, input.scorer),
      label: `${input.spec.title} / ${input.scorer.name}`,
      family: "contract_audit",
      status: "failed",
      evidence: findings.map((finding) =>
        `${finding.file}:${finding.line} field=${finding.fieldName} literal=${JSON.stringify(finding.literal)} expected=${finding.expectedValues.map((value) => JSON.stringify(value)).join("|")}`,
      ).join("\n"),
    }
  }

  if (observedAssignments === 0) {
    return {
      name: contractAuditCriteriaName(input.spec, input.scorer),
      label: `${input.spec.title} / ${input.scorer.name}`,
      family: "contract_audit",
      status: "failed",
      evidence: `goal=${input.goal.id}; no string literal assignments found for audited fields=${fields.map((field) => `${field.contractName}.${field.fieldName}`).join(",")}`,
    }
  }

  return {
    name: contractAuditCriteriaName(input.spec, input.scorer),
    label: `${input.spec.title} / ${input.scorer.name}`,
    family: "contract_audit",
    status: "passed",
    evidence: `goal=${input.goal.id}; audited_assignments=${observedAssignments}; fields=${fields.map((field) => `${field.contractName}.${field.fieldName}`).join(",")}`,
  }
}

function auditFieldsForSymbols(input: {
  index: Map<string, ContractIR>
  symbols: string[]
}): AuditableField[] {
  const fields: AuditableField[] = []
  for (const symbol of input.symbols) {
    const contract = input.index.get(symbol)
    if (!contract) continue
    if (contract.kind === "type") {
      for (const field of contract.fields) {
        const values = closedStringValues(field.valueDomain, input.index)
        if (values) fields.push({ contractName: contract.name, fieldName: field.name, expectedValues: values })
      }
      continue
    }
    if (contract.kind === "function") {
      for (const param of contract.params) {
        const values = closedStringValues(param.valueDomain, input.index)
        if (values) fields.push({ contractName: contract.name, fieldName: param.name, expectedValues: values })
      }
      const returnValues = closedStringValues(contract.returns.valueDomain, input.index)
      if (returnValues) fields.push({ contractName: contract.name, fieldName: "return", expectedValues: returnValues })
    }
  }
  return fields
}

function closedStringValues(domain: ValueDomain, index: Map<string, ContractIR>): string[] | undefined {
  if (domain.kind === "literal_union") return domain.values
  if (domain.kind === "ref") return closedStringValuesFromContract(index.get(domain.contractName))
  if (domain.kind === "branded") return closedStringValuesFromContract(index.get(domain.brand))
  return undefined
}

function closedStringValuesFromContract(contract: ContractIR | undefined): string[] | undefined {
  if (!contract) return undefined
  if (contract.kind === "enum") return contract.variants.map((variant) => variant.value)
  if (contract.kind === "type" && contract.fields.length === 1) {
    return closedStringValues(contract.fields[0].valueDomain, new Map([[contract.name, contract]]))
  }
  return undefined
}

function collectSourceFiles(workDir: string, ownedPaths: readonly string[]): string[] {
  const files: string[] = []
  for (const ownedPath of ownedPaths) {
    const absolute = path.resolve(workDir, ownedPath)
    if (!fs.existsSync(absolute)) continue
    const stat = fs.statSync(absolute)
    if (stat.isFile() && isSourceFile(absolute)) {
      files.push(absolute)
      continue
    }
    if (stat.isDirectory()) {
      collectSourceFilesFromDirectory(absolute, files)
    }
  }
  return [...new Set(files)]
}

function collectSourceFilesFromDirectory(directory: string, files: string[]) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".opencorvus") continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      collectSourceFilesFromDirectory(absolute, files)
      continue
    }
    if (entry.isFile() && isSourceFile(absolute)) files.push(absolute)
  }
}

function isSourceFile(file: string): boolean {
  return /\.(ts|tsx|js|jsx)$/.test(file)
}

function scriptKindForPath(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX
  if (file.endsWith(".js")) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function scriptTargetForPath(_file: string): ts.ScriptTarget {
  return ts.ScriptTarget.ES2022
}

function visitStringLiteralAssignments(
  sourceFile: ts.SourceFile,
  onAssignment: (fieldName: string, literal: string, node: ts.Node) => void,
) {
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.initializer)) {
      const name = propertyNameText(node.name, sourceFile)
      if (name) onAssignment(name, node.initializer.text, node.initializer)
    } else if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      onAssignment(node.name.text, node.initializer.text, node.initializer)
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isStringLiteralLike(node.right)
    ) {
      const name = assignmentLeftName(node.left, sourceFile)
      if (name) onAssignment(name, node.right.text, node.right)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function propertyNameText(name: ts.PropertyName, sourceFile: ts.SourceFile): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text
  return undefined
}

function assignmentLeftName(node: ts.Expression, sourceFile: ts.SourceFile): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text
  }
  if (ts.isIdentifier(node)) return node.text
  return undefined
}
