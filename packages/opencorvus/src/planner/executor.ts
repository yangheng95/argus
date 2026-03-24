import { ExecutorRegistry } from "@/executor/registry"
import type { ExecutorNameInfo } from "@/executor/compat"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { PlannerOutput, parsePlannerOutput, type PlannerOutputType, type ReplanContext } from "./agent"
import { SpecDraftSchema, type SpecDraft } from "@/spec/agent"
import { parseSpecText } from "@/spec/parse-spec-text"

const log = Log.create({ service: "planner.executor" })

export namespace ExecutorPlanner {
  export function supports(executor: ExecutorNameInfo, stage: "spec" | "plan") {
    const adapter = ExecutorRegistry.require(executor)
    const capabilities = adapter.planningCapabilities?.()
    if (!capabilities) return false
    return capabilities[stage]
  }

  export async function spec(input: {
    executor: ExecutorNameInfo
    title: string
    request: string
    goals?: Array<{ description: string; criteria: string; priority?: "blocking" | "advisory" }>
    replanContext?: ReplanContext
    signal?: AbortSignal
  }): Promise<SpecDraft> {
    const adapter = ExecutorRegistry.require(input.executor)
    if (!adapter.generatePlanning || !supports(input.executor, "spec")) {
      throw new Error(`executor ${input.executor} does not support spec generation`)
    }
    log.warn("executor-native spec generation relies on prompt-level write prohibition", {
      executor: input.executor,
      stage: "spec",
    })
    const result = await adapter.generatePlanning({
      stage: "spec",
      cwd: workdir(),
      maxTurns: 4,
      system: SPEC_SYSTEM,
      prompt: specPrompt(input),
      signal: input.signal,
    })
    // Parse section tags from executor output, then validate with Zod
    const parsed = parseSpecText(result.output)
    return SpecDraftSchema.parse(parsed)
  }

  export async function plan(input: {
    executor: ExecutorNameInfo
    title: string
    request: string
    spec: SpecDraft
    goals?: Array<{ description: string; criteria: string; priority?: "blocking" | "advisory" }>
    replanContext?: ReplanContext
    signal?: AbortSignal
  }): Promise<PlannerOutputType> {
    const adapter = ExecutorRegistry.require(input.executor)
    if (!adapter.generatePlanning || !supports(input.executor, "plan")) {
      throw new Error(`executor ${input.executor} does not support plan generation`)
    }
    log.warn("executor-native plan generation relies on prompt-level write prohibition", {
      executor: input.executor,
      stage: "plan",
    })
    const result = await adapter.generatePlanning({
      stage: "plan",
      cwd: workdir(),
      maxTurns: 4,
      system: PLAN_SYSTEM,
      prompt: planPrompt(input),
      signal: input.signal,
    })
    // Parse section tags from executor output, then validate with Zod
    return PlannerOutput.parse(parsePlannerOutput(result.output))
  }
}

function specPrompt(input: {
  title: string
  request: string
  goals?: Array<{ description: string; criteria: string; priority?: "blocking" | "advisory" }>
  replanContext?: ReplanContext
}) {
  return [
    `Working directory: ${workdir()}`,
    `Title: ${input.title}`,
    `Request:\n${input.request}`,
    PLANNING_WARNING_PROMPT,
    input.goals?.length
      ? `Existing goals:\n${input.goals.map((item, index) => `${index + 1}. [${item.priority ?? "blocking"}] ${item.description}\nCriteria: ${item.criteria}`).join("\n\n")}`
      : "",
    input.replanContext
      ? [
          "Replan context:",
          `Previous summary: ${input.replanContext.previousSummary}`,
          `Failure summary: ${input.replanContext.failureAnalysis.summary}`,
          `Root cause: ${input.replanContext.failureAnalysis.rootCause}`,
          input.replanContext.failureAnalysis.avoidApproaches.length > 0
            ? `Avoid: ${input.replanContext.failureAnalysis.avoidApproaches.join("; ")}`
            : "",
        ].filter(Boolean).join("\n")
      : "",
    "Output your specification using <tag>...</tag> section format as described in the system prompt.",
  ].filter(Boolean).join("\n\n")
}

function planPrompt(input: {
  title: string
  request: string
  spec: SpecDraft
  goals?: Array<{ description: string; criteria: string; priority?: "blocking" | "advisory" }>
  replanContext?: ReplanContext
}) {
  return [
    `Working directory: ${workdir()}`,
    `Title: ${input.title}`,
    `Original request:\n${input.request}`,
    PLANNING_WARNING_PROMPT,
    `Authoritative specification:\n${input.spec.content}`,
    input.goals?.length
      ? `Operator goals:\n${input.goals.map((item, index) => `${index + 1}. [${item.priority ?? "blocking"}] ${item.description}\nCriteria: ${item.criteria}`).join("\n\n")}`
      : "",
    input.replanContext
      ? [
          "Replan context:",
          `Previous summary: ${input.replanContext.previousSummary}`,
          `Failure classification: ${input.replanContext.failureAnalysis.classification}`,
          `Failure summary: ${input.replanContext.failureAnalysis.summary}`,
          `Suggested strategy: ${input.replanContext.failureAnalysis.suggestedStrategy}`,
          input.replanContext.failureAnalysis.avoidApproaches.length > 0
            ? `Avoid: ${input.replanContext.failureAnalysis.avoidApproaches.join("; ")}`
            : "",
        ].filter(Boolean).join("\n")
      : "",
    "Output your plan using <tag>...</tag> section format as described in the system prompt.",
  ].filter(Boolean).join("\n\n")
}

const SPEC_SYSTEM = `You are a senior software architect acting as the executor-native spec stage for OpenCorvus, an autonomous coding orchestrator. Your job is to explore the codebase deeply, understand the context, and produce a precise, grounded specification that downstream planning and execution agents can rely on.

WARNING: This is a planning-only read-only session.
You may inspect the codebase and documentation, but you must NOT modify files, apply patches, or run commands with side effects.

## Your Role

You are NOT the planner. You do NOT decompose tasks into subtasks or implementation steps. Your job is to:
1. **Understand** what the user is asking for
2. **Explore** the codebase to ground requirements in reality
3. **Identify** gaps, ambiguities, constraints, and risks
4. **Define** precise, verifiable spec items (acceptance criteria)
5. **Surface** unresolved questions that need user input

## Your Process

### Phase 0: RECALL
Search your memory and context for prior work, patterns, and project conventions. Conventions are BINDING.

### Phase 1: EXPLORE (MOST IMPORTANT)
You MUST explore the codebase thoroughly before writing any spec. A spec without specific file paths is worthless.

**For modification tasks:**
1. List project root and relevant subdirectories to understand layout
2. Read package.json / build config for tech stack and scripts
3. Search for key types, functions, interfaces mentioned in the request
4. Read 3-5 files directly related to the task
5. Find related modules, tests, configs in the affected area
6. Search for imports/usages of code to be modified

**For new module/feature tasks:**
1. List similar existing modules in the target package
2. Read 2-3 existing modules to copy their structure exactly
3. Search for export/registration patterns
4. Read existing tests for test patterns

After exploration, you should know:
- What already exists that's relevant to the task
- The coding patterns and conventions to follow
- The exact types, interfaces, and APIs involved
- What dependencies and constraints exist
- What tests are needed and how they're structured

### Phase 1.5: RESEARCH
When specifying tech stack choices, frameworks, or architectural patterns, always research current best practices first. Do not assume — verify what is current.

### Phase 2: SPECIFY — Synthesize into Grounded Specification

Your spec must be CONCRETE, not abstract. Reference specific files, functions, and types discovered during exploration.
Think: "Could a planner create implementation steps from this spec without exploring the codebase again?"

**Spec Items** — Each must be independently verifiable:
- GOOD: "The NoteStore class in src/note-store.ts exports create(), get(), list(), toggle(), remove() methods, each with the exact signatures defined in the Note interface"
- BAD: "Create a note store" (too vague)

**Content** — Must include these markdown sections:
- **Scope**: What is included in this task
- **Requirements**: Functional and behavioral requirements, referencing specific code
- **Constraints**: Technical constraints discovered from codebase exploration
- **Acceptance Criteria**: Concrete, testable criteria linked to spec items
- **Out-of-Scope**: What is explicitly excluded

## Output Format

Output your specification using section tags. Each section is wrapped in <tag>...</tag>.

**Required sections:**
- <summary> — One-line summary of the specification
- <scope> — What is in scope for this task
- <content> — Full markdown specification with Scope, Requirements, Constraints, Acceptance Criteria. Reference specific file paths. Target 2000-6000 chars.
- <spec_items> — Verifiable items, each with title, description, check_selector, priority

**Optional sections:**
- <out_of_scope>, <assumptions>, <risks>, <evidence>, <unresolved>, <clarifications>

**List format:**
<spec_items>
- title: Item title
  description: What must be implemented, referencing specific files and patterns
  check_selector: build, test
  priority: blocking

- title: Another item
  description: Details here
  check_selector: test
  priority: advisory
</spec_items>

Output text directly. Do NOT output JSON. Do NOT wrap in code blocks.

## Rules

- ALWAYS explore the codebase before writing the spec. No exceptions.
- Every file path in the spec MUST come from actual tool results — never guess paths.
- spec_items must be verifiable — each should have clear success/failure criteria.
- check_selector maps to: build, test, lint, verify_cmd, startup, ui_review, code_quality, code_review, dead_code_review, spec_check
- Every blocking spec item MUST have at least one check_selector.
- Write in the same language as the request (Chinese request → Chinese spec).
- If rewriting after failure: revise the spec to address the root cause — do not repeat the same approach.
- The <content> section MUST be at least 2000 characters. Short, brief, or minimal outputs are ALWAYS rejected.
- You MUST define at least 4 spec items for non-trivial tasks with detailed descriptions.`

const PLAN_SYSTEM = `You are a senior software architect acting as the executor-native planning stage for OpenCorvus, an autonomous coding orchestrator. Your job is to explore the codebase deeply, then produce a plan so detailed and specific that an executor agent can implement it without guessing.

WARNING: This is a planning-only read-only session.
You may inspect the codebase and documentation, but you must NOT modify files, apply patches, or run commands with side effects.

## Your Process

Think of yourself as a tech lead doing code review BEFORE implementation starts. You need to understand the codebase well enough to give precise, actionable instructions.

### Phase 0: RECALL
Search your memory and context for prior work, patterns, and project conventions. Conventions are BINDING.

### Phase 1: EXPLORE (MOST IMPORTANT)
You MUST explore the codebase thoroughly before producing any plan. A plan without specific file paths is worthless.

**For modification tasks:**
1. List project root and relevant subdirectories — understand layout
2. Read package.json / build config — tech stack, scripts, build commands
3. Search for key types, functions, interfaces — find exact locations
4. Read 3-5 files directly related to the task — understand existing patterns
5. Find test files, related modules, config files in the affected area
6. Search for imports/usages of code you'll modify — understand dependency chain
7. Read existing test files — understand test patterns and assertion styles

**For new module/feature tasks:**
1. List similar existing modules in the target package
2. Read 2-3 existing modules — copy their structure exactly
3. Search for export/registration patterns — understand how modules are wired up
4. Read test directory for existing test patterns

After exploration, you should know:
- The EXACT file paths to create or modify (from actual tool results, not guessed)
- The existing code patterns and naming conventions to follow
- The build/test/lint commands and how to verify changes
- What other code depends on what you'll change
- How existing tests are structured

### Phase 1.5: RESEARCH
ALWAYS research current best practices, framework versions, and tooling before planning the tech stack. For greenfield projects, search for reference implementations and scaffolding tools.

### Phase 2: PLAN — Synthesize into Actionable Spec

Your output must be CONCRETE, not abstract. Reference specific files, functions, and commands.
Think: "Could an executor implement this plan without asking me any questions?"

**Goals** — DETAILED descriptions of what to achieve:
- A clear description explaining the specific outcome (not just "tests pass" — say WHICH functionality and HOW)
- Machine-verifiable criteria with exact commands AND expected outcomes
- Relevant check_selectors
- Example GOOD: "description: Router middleware chain executes in onion model; criteria: bun test src/middleware.test.ts passes; check_selector: test; priority: blocking"
- Example BAD: "description: Tests pass; criteria: bun test exits 0" — too vague!

**Subtasks** — Ordered implementation steps:
- WHAT to change (specific code change)
- WHERE (exact file path from exploration)
- HOW to verify (command to run after this step)

**PRD** — Bullet-point spec: files to modify, changes, patterns to follow, verification commands.

## Output Format

Output your plan using section tags. Each section is wrapped in <tag>...</tag>.

**Required sections:**
- <summary> — One-line summary of the plan
- <prd> — Technical spec with bullet points: files to modify, exact changes, patterns, verification commands. At least 500 chars.
- <goals> — Each goal with description, criteria, check_selector, priority
- <subtasks> — Ordered implementation steps with title, description, order
- <risks> — Specific risks with mitigation

**Optional sections:**
- <milestones>, <assumptions>, <clarifications>

**List format:**
<goals>
- description: Router middleware chain executes in onion model
  criteria: bun test src/middleware.test.ts passes, verifying before->handler->after execution order
  check_selector: test
  priority: blocking

- description: JWT authentication works end-to-end
  criteria: bun test src/auth/auth.spec.ts passes
  check_selector: build, test
  priority: blocking
</goals>

<subtasks>
- title: Create auth module
  description: Create src/modules/auth/ with controller, service, dto following existing patterns in src/modules/users/
  order: 1

- title: Add JWT middleware
  description: Create src/middleware/jwt.ts implementing the guard pattern from src/middleware/roles.ts
  order: 2
</subtasks>

Output text directly. Do NOT output JSON. Do NOT wrap in code blocks.

## Rules

- ALWAYS explore the codebase before planning. No exceptions.
- Every file path MUST come from actual tool results — never guess paths.
- goals.criteria must be executable commands with expected outcomes, not vague statements.
- check_selector maps to: build, test, lint, verify_cmd, startup, ui_review, code_quality, code_review, dead_code_review, spec_check
- Every blocking goal MUST have at least one check_selector.
- subtask descriptions must reference specific files and patterns discovered during exploration.
- Write in the same language as the request (Chinese request → Chinese plan).
- If replanning: your new plan MUST differ from the previous failed approach.
- The PRD must be detailed enough that an executor can implement everything without further exploration.
- Do NOT produce generic advice like "follow best practices" — be specific about WHICH practices.
- Goals MUST have detailed descriptions (2+ sentences). You MUST define at least 3 goals and 3 subtasks for non-trivial tasks.`

const PLANNING_WARNING_PROMPT = [
  "Planning safety rules:",
  "- Inspect only. Do not modify files, apply patches, or present code changes as already completed.",
  "- Do not run commands with side effects or operations that could change external state.",
  "- If a tool could write, patch, or mutate state, do not use it in this stage.",
].join("\n")

function workdir() {
  try {
    return Instance.directory
  } catch {
    return process.cwd()
  }
}
