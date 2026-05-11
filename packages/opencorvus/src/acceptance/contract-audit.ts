import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import {
  auditEligibleFieldsForSymbols,
  type AuditEligibleField,
  type ContractIR,
} from "@/architect/contract-ir"
import { parseContractSymbols } from "@/architect/linker"
import { resolveTrigger, type AcceptanceSpec, type ContractAuditScorer } from "./types"

export type ContractAuditStatus = "passed" | "failed" | "skipped" | "inconclusive"

export interface ContractAuditGoal {
  id: string
  kind?: string
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

interface Finding {
  file: string
  line: number
  fieldName: string
  literal: string
  expectedValues: string[]
}

interface InconclusiveFinding {
  file: string
  line: number
  fieldName: string
  identifierName: string
  reason: string
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
  if (input.goal.kind === "bootstrap") {
    return {
      name: contractAuditCriteriaName(input.spec, input.scorer),
      label: `${input.spec.title} / ${input.scorer.name}`,
      family: "contract_audit",
      status: "skipped",
      evidence: `goal=${input.goal.id}; bootstrap goal - contract_audit not applicable because bootstrap declares contracts and does not consume them`,
    }
  }

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
  const fields = auditEligibleFieldsForSymbols({
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
      status: "skipped",
      evidence: `goal=${input.goal.id}; no TypeScript source files found in owned_paths=${input.goal.owned_paths.join(",")}`,
    }
  }

  const findings: Finding[] = []
  const inconclusiveFindings = new Map<string, InconclusiveFinding>()
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
    visitStringLiteralAssignments(
      sourceFile,
      (fieldName, literal, node) => {
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
      },
      (fieldName, node, identifierName, reason) => {
        if (!fieldByName.has(fieldName)) return
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        const finding: InconclusiveFinding = {
          file: relativeFile,
          line: position.line + 1,
          fieldName,
          identifierName,
          reason,
        }
        inconclusiveFindings.set(
          `${finding.file}:${finding.line}:${finding.fieldName}:${finding.identifierName}:${finding.reason}`,
          finding,
        )
      },
    )
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
    if (inconclusiveFindings.size > 0) {
      return {
        name: contractAuditCriteriaName(input.spec, input.scorer),
        label: `${input.spec.title} / ${input.scorer.name}`,
        family: "contract_audit",
        status: "inconclusive",
        evidence: inconclusiveEvidence({
          goalID: input.goal.id,
          fields,
          findings: [...inconclusiveFindings.values()],
        }),
      }
    }
    return {
      name: contractAuditCriteriaName(input.spec, input.scorer),
      label: `${input.spec.title} / ${input.scorer.name}`,
      family: "contract_audit",
      status: "passed",
      evidence: passEvidence({
        goalID: input.goal.id,
        fields,
        observedAssignments,
        note: "no assignments observed; audit had no opportunity to find violations",
      }),
    }
  }

  return {
    name: contractAuditCriteriaName(input.spec, input.scorer),
    label: `${input.spec.title} / ${input.scorer.name}`,
    family: "contract_audit",
    status: "passed",
    evidence: passEvidence({
      goalID: input.goal.id,
      fields,
      observedAssignments,
      inconclusiveFindings: [...inconclusiveFindings.values()],
    }),
  }
}

function passEvidence(input: {
  goalID: string
  fields: AuditEligibleField[]
  observedAssignments: number
  inconclusiveFindings?: InconclusiveFinding[]
  note?: string
}): string {
  const inconclusiveFields = [...new Set((input.inconclusiveFindings ?? [])
    .map((finding) => finding.fieldName))]
    .sort()
  const parts = [
    `goal=${input.goalID}`,
    `fields=${input.fields.map((field) => `${field.contractName}.${field.fieldName}`).join(",")}`,
    `observed_assignments=${input.observedAssignments}`,
    "all compliant",
    `static_inference_inconclusive_for=${inconclusiveFields.length > 0 ? inconclusiveFields.join(",") : "none"}`,
  ]
  if (input.note) parts.push(input.note)
  return parts.join("; ")
}

function inconclusiveEvidence(input: {
  goalID: string
  fields: AuditEligibleField[]
  findings: InconclusiveFinding[]
}): string {
  const lines = [
    `goal=${input.goalID}`,
    `audited_fields=${input.fields.map((field) => `${field.contractName}.${field.fieldName}`).join(",")}`,
    "unable_to_statically_audit:",
    ...input.findings.map((finding) =>
      `- field=${finding.fieldName} at ${finding.file}:${finding.line}: Identifier '${finding.identifierName}' ${finding.reason}`,
    ),
    "suggestion:",
    "- inline literal values into the PropertyAssignment to enable static audit, for example { field: 'AllowedValue' }",
    "- remove this contract_audit scorer if static audit is not required for this contract boundary",
    "- add an llm_judge scorer alongside this audit for Tier 2 semantic review",
  ]
  return lines.join("\n")
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
  onInconclusive: (fieldName: string, node: ts.Node, identifierName: string, reason: string) => void,
) {
  const bindings = collectStringLiteralBindings(sourceFile)
  const assignLiteralValues = (fieldName: string, values: LiteralValue[]) => {
    for (const value of values) onAssignment(fieldName, value.value, value.node)
  }
  const traceFailureReason = "was assigned via expression that is not currently traceable (could be ternary across control flow, cross-function return, computed expression, or cross-file value flow)"
  const visit = (node: ts.Node) => {
    const propertyAssignmentName = ts.isPropertyAssignment(node) ? propertyNameText(node.name, sourceFile) : undefined
    if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.initializer)) {
      const name = propertyNameText(node.name, sourceFile)
      if (name) onAssignment(name, node.initializer.text, node.initializer)
    } else if (ts.isPropertyAssignment(node) && ts.isConditionalExpression(unwrapExpression(node.initializer))) {
      const name = propertyAssignmentName
      const values = flattenConditionalLiterals(node.initializer)
      if (name && values !== "inconclusive") assignLiteralValues(name, values)
      else if (name) onInconclusive(name, node.initializer, closestIdentifierName(node.initializer), traceFailureReason)
    } else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.initializer)) {
      const name = propertyAssignmentName
      if (name) {
        const values = resolveIdentifierLiteralValues(node.initializer, bindings)
        if (values === "inconclusive") onInconclusive(name, node.initializer, node.initializer.text, traceFailureReason)
        else assignLiteralValues(name, values)
      }
    } else if (ts.isPropertyAssignment(node) && propertyAssignmentName) {
      onInconclusive(propertyAssignmentName, node.initializer, closestIdentifierName(node.initializer), traceFailureReason)
    } else if (ts.isShorthandPropertyAssignment(node)) {
      const name = node.name.text
      const values = resolveIdentifierLiteralValues(node.name, bindings)
      if (values === "inconclusive") onInconclusive(name, node.name, node.name.text, traceFailureReason)
      else assignLiteralValues(name, values)
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
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isConditionalExpression(unwrapExpression(node.right))
    ) {
      const name = assignmentLeftName(node.left, sourceFile)
      const values = flattenConditionalLiterals(node.right)
      if (name && values !== "inconclusive") assignLiteralValues(name, values)
      else if (name) onInconclusive(name, node.right, closestIdentifierName(node.right), traceFailureReason)
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.right)
    ) {
      const name = assignmentLeftName(node.left, sourceFile)
      if (name) {
        const values = resolveIdentifierLiteralValues(node.right, bindings)
        if (values === "inconclusive") onInconclusive(name, node.right, node.right.text, traceFailureReason)
        else assignLiteralValues(name, values)
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const name = assignmentLeftName(node.left, sourceFile)
      if (name) onInconclusive(name, node.right, closestIdentifierName(node.right), traceFailureReason)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

interface LiteralValue {
  value: string
  node: ts.Node
}

interface StringLiteralBinding {
  name: string
  pos: number
  literals: LiteralValue[]
  inconclusiveNodes: ts.Node[]
}

function collectStringLiteralBindings(sourceFile: ts.SourceFile): Map<string, StringLiteralBinding> {
  const bindings = new Map<string, StringLiteralBinding>()
  const ensureBinding = (name: string, pos: number) => {
    const binding = bindings.get(name)
    if (binding) return binding
    const next: StringLiteralBinding = { name, pos, literals: [], inconclusiveNodes: [] }
    bindings.set(name, next)
    return next
  }
  const addLiteral = (name: string, pos: number, literal: LiteralValue) => {
    const binding = ensureBinding(name, pos)
    binding.literals.push(literal)
    binding.pos = Math.min(binding.pos, pos)
  }
  const addInconclusive = (name: string, pos: number, node: ts.Node) => {
    const binding = ensureBinding(name, pos)
    binding.inconclusiveNodes.push(node)
    binding.pos = Math.min(binding.pos, pos)
  }
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const pos = node.name.getStart(sourceFile)
      ensureBinding(node.name.text, pos)
      if (node.initializer && ts.isStringLiteralLike(node.initializer)) {
        addLiteral(node.name.text, pos, { value: node.initializer.text, node: node.initializer })
      } else if (node.initializer) {
        const values = flattenConditionalLiterals(node.initializer)
        if (values === "inconclusive") addInconclusive(node.name.text, pos, node.initializer)
        else for (const literal of values) addLiteral(node.name.text, pos, literal)
      }
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      const pos = node.name.getStart(sourceFile)
      ensureBinding(node.name.text, pos)
      if (node.initializer && ts.isStringLiteralLike(node.initializer)) {
        addLiteral(node.name.text, pos, { value: node.initializer.text, node: node.initializer })
      } else if (node.initializer) {
        const values = flattenConditionalLiterals(node.initializer)
        if (values === "inconclusive") addInconclusive(node.name.text, pos, node.initializer)
        else for (const literal of values) addLiteral(node.name.text, pos, literal)
      } else {
        addInconclusive(node.name.text, pos, node.name)
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      const pos = node.left.getStart(sourceFile)
      const values = flattenConditionalLiterals(node.right)
      if (values === "inconclusive") addInconclusive(node.left.text, pos, node.right)
      else for (const literal of values) addLiteral(node.left.text, pos, literal)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return bindings
}

function resolveIdentifierLiteralValues(
  identifier: ts.Identifier,
  bindings: Map<string, StringLiteralBinding>,
): LiteralValue[] | "inconclusive" {
  const position = identifier.getStart()
  const binding = bindings.get(identifier.text)
  if (!binding || binding.pos >= position) return "inconclusive"
  if (binding.inconclusiveNodes.some((node) => node.getStart() < position)) return "inconclusive"
  const values = binding.literals.filter((literal) => literal.node.getStart() < position)
  if (values.length === 0) return "inconclusive"
  return values
}

function flattenConditionalLiterals(expr: ts.Expression): LiteralValue[] | "inconclusive" {
  const unwrapped = unwrapExpression(expr)
  if (ts.isStringLiteralLike(unwrapped)) return [{ value: unwrapped.text, node: unwrapped }]
  if (!ts.isConditionalExpression(unwrapped)) return "inconclusive"
  const whenTrue = flattenConditionalLiterals(unwrapped.whenTrue)
  const whenFalse = flattenConditionalLiterals(unwrapped.whenFalse)
  if (whenTrue === "inconclusive" || whenFalse === "inconclusive") return "inconclusive"
  return [...whenTrue, ...whenFalse]
}

function unwrapExpression(expr: ts.Expression): ts.Expression {
  let current = expr
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function closestIdentifierName(node: ts.Node): string {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) return node.expression.text
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  let found: string | undefined
  const visit = (child: ts.Node) => {
    if (found) return
    if (ts.isIdentifier(child)) {
      found = child.text
      return
    }
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  return found ?? "<expression>"
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
