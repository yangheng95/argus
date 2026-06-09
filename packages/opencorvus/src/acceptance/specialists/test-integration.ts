import fs from "node:fs/promises"
import path from "node:path"
import ts from "typescript"
import {
  createAcceptanceSpecialistReview,
  type AcceptanceReviewFinding,
  type AcceptanceSpecialistReview,
} from "../specialist-review"
import type { AcceptanceCheckResult, AcceptanceRequiredCheck } from "../manifest"
import type { AcceptanceSurfaceManifest } from "../surface-detector"

type GoalForTestReview = {
  id: string
  requirement_ids: string[]
  acceptance_spec_count?: number
}

const WALK_EXCLUDED = new Set([
  ".git",
  ".opencorvus",
  ".opencorvus-worktrees",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "build",
  "node_modules",
  "out",
])

export async function runTestIntegrationReview(input: {
  taskID?: string
  runID?: string
  acceptanceID?: string
  projectRoot: string
  surfaceManifest: AcceptanceSurfaceManifest
  requiredChecks: AcceptanceRequiredCheck[]
  checkResults: AcceptanceCheckResult[]
  goals: GoalForTestReview[]
}): Promise<AcceptanceSpecialistReview | undefined> {
  if (!input.surfaceManifest.surfaces.includes("test_integration")) return undefined
  if (!input.taskID || !input.runID || !input.acceptanceID) return undefined

  const pkg = await readPackage(input.projectRoot)
  const testFiles = await listTestFiles(input.projectRoot)
  const testFileTexts = await Promise.all(
    testFiles.map(async (file) => ({
      file,
      text: await fs.readFile(path.join(input.projectRoot, file), "utf8").catch(() => ""),
    })),
  )
  const findings: AcceptanceReviewFinding[] = []
  const evidenceRefs = new Set<string>()
  const testScript = pkg?.scripts?.test

  if (testScript) evidenceRefs.add("package.json#scripts.test")
  for (const file of testFiles.slice(0, 12)) evidenceRefs.add(file)

  const failedTestChecks = input.checkResults.filter((result) => result.name === "test" && result.status !== "passed")
  for (const result of failedTestChecks) {
    findings.push({
      proposedSeverity: "blocking",
      category: "test_quality",
      claim: `Required test command failed: ${result.command}`,
      evidence: [
        {
          kind: "command",
          ref: result.command,
          excerpt: result.outputExcerpt || result.failureReason || "test command failed",
        },
      ],
      affectedRequirementIDs: requirementIDs(input.goals),
    })
  }

  if (testScript && isNoOpTestScript(testScript)) {
    findings.push({
      proposedSeverity: "blocking",
      category: "test_quality",
      claim: "The package test script is a no-op success signal, not a real test run.",
      evidence: [
        {
          kind: "command",
          ref: "package.json#scripts.test",
          excerpt: testScript,
        },
      ],
      affectedRequirementIDs: requirementIDs(input.goals),
    })
  }

  if (testFiles.length === 0) {
    findings.push({
      proposedSeverity: "blocking",
      category: "test_quality",
      claim: "The acceptance requires test integration evidence, but no test files were found.",
      evidence: [
        {
          kind: "file",
          ref: input.projectRoot,
          excerpt: "no test, tests, e2e, integration, regression, *.test.*, or *.spec.* files found",
        },
      ],
      affectedRequirementIDs: requirementIDs(input.goals),
    })
  }

  for (const item of testFileTexts) {
    const analysis = analyzeTestFile(item.file, item.text)
    if (analysis.empty) {
      findings.push({
        proposedSeverity: "blocking",
        category: "test_quality",
        claim: `Test file ${item.file} is empty.`,
        evidence: [{ kind: "file", ref: item.file, excerpt: "empty or comment-only test file" }],
        affectedRequirementIDs: requirementIDs(input.goals),
      })
      continue
    }
    if (!analysis.hasTestCase) {
      findings.push({
        proposedSeverity: "blocking",
        category: "test_quality",
        claim: `Test file ${item.file} does not contain an executable test case.`,
        evidence: [{ kind: "file", ref: item.file, excerpt: item.text.slice(0, 300) }],
        affectedRequirementIDs: requirementIDs(input.goals),
      })
    } else if (analysis.assertionCount === 0) {
      findings.push({
        proposedSeverity: "blocking",
        category: "test_quality",
        claim: `Test file ${item.file} contains test cases without observable assertions.`,
        evidence: [{ kind: "file", ref: item.file, excerpt: item.text.slice(0, 300) }],
        affectedRequirementIDs: requirementIDs(input.goals),
      })
    } else if (analysis.assertionCount === analysis.snapshotAssertionCount) {
      findings.push({
        proposedSeverity: "blocking",
        category: "test_quality",
        claim: `Test file ${item.file} only checks snapshots and does not assert behavior.`,
        evidence: [{ kind: "file", ref: item.file, excerpt: item.text.slice(0, 300) }],
        affectedRequirementIDs: requirementIDs(input.goals),
      })
    }
  }

  const requiredIDs = requirementIDs(input.goals)
  if (requiredIDs.length > 0 && testFileTexts.length > 0 && !mentionsAnyRequirement(testFileTexts, requiredIDs)) {
    findings.push({
      proposedSeverity: "major",
      category: "test_quality",
      claim: "Tests do not reference any requirement ID covered by the acceptance goals.",
      evidence: testFileTexts.slice(0, 3).map((item) => ({
        kind: "file" as const,
        ref: item.file,
        excerpt: item.text.slice(0, 300),
      })),
      affectedRequirementIDs: requiredIDs,
    })
  }

  if (evidenceRefs.size === 0) {
    evidenceRefs.add(input.projectRoot)
  }

  return createAcceptanceSpecialistReview({
    taskId: input.taskID,
    runId: input.runID,
    acceptanceId: input.acceptanceID,
    reviewer: "test_integration",
    executionStatus: "completed",
    summary:
      findings.length === 0
        ? `Test integration review passed with ${testFiles.length} test file(s).`
        : `Test integration review found ${findings.length} issue(s).`,
    findings,
    evidenceRefs: [...evidenceRefs].sort(),
    reviewedSurfaces: ["test_integration"],
  })
}

function requirementIDs(goals: GoalForTestReview[]) {
  return [...new Set(goals.flatMap((goal) => goal.requirement_ids))].sort()
}

async function readPackage(root: string): Promise<{ scripts?: Record<string, string> } | undefined> {
  const raw = await fs.readFile(path.join(root, "package.json"), "utf8").catch(() => undefined)
  if (!raw) return undefined
  return JSON.parse(raw)
}

async function listTestFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string) {
    if (out.length >= 500) return
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (WALK_EXCLUDED.has(entry.name)) continue
      const absolute = path.join(dir, entry.name)
      const relative = path.relative(root, absolute).replaceAll("\\", "/")
      if (entry.isDirectory()) {
        await walk(absolute)
      } else if (isTestFile(relative)) {
        out.push(relative)
      }
      if (out.length >= 500) return
    }
  }
  await walk(root)
  return out.sort()
}

function isTestFile(file: string) {
  return /(^|\/)(test|tests|e2e|integration|regression)\//.test(file) || /\.(spec|test|e2e)\.[cm]?[jt]sx?$/.test(file)
}

function isNoOpTestScript(script: string) {
  const tokens = shellTokens(script)
  if (tokens.length === 0) return true
  const first = tokens[0]?.toLowerCase()
  if (first === "true") return true
  if (first === "exit" && tokens[1] === "0") return true
  if (first === "echo") return true
  if ((first === "bun" || first === "node") && tokens[1] === "-e") {
    const inline = tokens[2] ?? ""
    const analysis = analyzeTestFile("inline-test-script.js", inline)
    return !analysis.hasTestCase && analysis.assertionCount === 0
  }
  if (tokens.some((token, index) => token === "||" && (tokens[index + 1] === "true" || tokens[index + 1] === "exit"))) {
    return true
  }
  if (first === "test" || first === "[") return true
  if (first === "grep") return true
  return false
}

function shellTokens(input: string) {
  const tokens: string[] = []
  let current = ""
  let quote: "'" | '"' | undefined
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!
    if (quote) {
      if (char === quote) {
        quote = undefined
      } else {
        current += char
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === "|" && input[index + 1] === "|") {
      if (current) {
        tokens.push(current)
        current = ""
      }
      tokens.push("||")
      index += 1
      continue
    }
    if (/\s/.test(char) || char === ";" || char === "&" || char === "|") {
      if (current) {
        tokens.push(current)
        current = ""
      }
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

function analyzeTestFile(file: string, text: string) {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file))
  let hasTestCase = false
  let assertionCount = 0
  let snapshotAssertionCount = 0
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const name = calledName(node.expression)
      if (name === "test" || name === "it") {
        hasTestCase = true
      }
      const matcher = expectMatcherName(node.expression)
      if (matcher) {
        assertionCount += 1
        if (matcher === "toMatchSnapshot" || matcher === "toMatchInlineSnapshot") {
          snapshotAssertionCount += 1
        }
      }
      if (name?.startsWith("assert")) {
        assertionCount += 1
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return {
    empty: sourceFile.statements.length === 0,
    hasTestCase,
    assertionCount,
    snapshotAssertionCount,
  }
}

function scriptKind(file: string) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX
  if (file.endsWith(".ts") || file.endsWith(".mts") || file.endsWith(".cts")) return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}

function calledName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) {
    const left = calledName(expression.expression)
    return left ? `${left}.${expression.name.text}` : expression.name.text
  }
  return undefined
}

function expectMatcherName(expression: ts.Expression): string | undefined {
  if (!ts.isPropertyAccessExpression(expression)) return undefined
  if (!containsExpectCall(expression.expression)) return undefined
  return expression.name.text
}

function containsExpectCall(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "expect") {
    return true
  }
  let found = false
  ts.forEachChild(node, (child) => {
    if (!found && containsExpectCall(child)) found = true
  })
  return found
}

function mentionsAnyRequirement(tests: Array<{ text: string }>, requirementIds: string[]) {
  const combined = tests.map((item) => item.text).join("\n")
  return requirementIds.some((id) => combined.includes(id))
}
