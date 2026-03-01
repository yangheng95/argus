---
name: plan
description: Structured planning workflow for complex tasks. Load before executing
  when scope is uncertain, the task spans multiple subsystems, or upfront research
  is needed to avoid wrong assumptions.
---

# Plan Skill

Use this skill when a task is complex enough that jumping straight to execution
risks wasted work or wrong assumptions. Planning first clarifies scope, identifies
the right files, and produces a verifiable execution checklist.

## When to Load This Skill

**Load plan skill when:**
- Task touches 5+ files across multiple directories
- Scope is uncertain (e.g. "refactor the auth system")
- Multiple valid approaches exist and the choice matters
- Large architectural change or new feature with non-obvious dependencies
- The user's request is ambiguous about what exactly should change

**Skip planning and execute directly when:**
- Single file change with clear instructions
- Typo fix, small rename, simple config update
- You've already explored and understand the full scope

## Planning Process

### Phase 1 — Explore in Parallel

Launch up to 3 `task` sub-agents simultaneously, each with a focused search
mission. Never do sequential exploration when parallel is possible.

Example parallel breakdown for "refactor session handling":
- Agent 1: Find all session-related files, trace the data model
- Agent 2: Find all callers/consumers of the session API
- Agent 3: Find test coverage, check patterns used in similar refactors

**Exploration goals:**
- Identify every file that needs to change
- Understand existing patterns before proposing a replacement
- Find test files that document expected behavior
- Check for gotchas: circular dependencies, shared state, platform differences

### Phase 2 — Decompose with PlannerTool

After exploration, use `planner` to build the task tree before writing any code:

```
planner.add_task("Root goal: <the overall task>")
planner.add_task("Step 1: <first logical unit>", parentId=root)
planner.add_task("Step 2: <second logical unit>", parentId=root)
...
```

**Task decomposition rules:**
- Each task = one independently verifiable unit of work
- Order by dependency: tasks that others depend on come first
- Include a verification task at the end ("run tests, typecheck, grep for residuals")
- Aim for 3–8 tasks; if more, group into phases

Use `planner.scratchpad_write` to record key findings from exploration:
- Critical files and their roles
- Gotchas and constraints
- Chosen approach and why (vs alternatives considered)

### Phase 3 — Alignment Check

Before executing, verify:

1. **Scope is complete** — every affected file is in the task list
2. **Approach is right** — re-read the user's request, confirm nothing was missed
3. **Risks are noted** — list in scratchpad: backwards compat concerns, test gaps,
   files you're uncertain about
4. **Verification plan exists** — know exactly how you'll confirm correctness
   (which test command, which grep, which typecheck)

If anything is still unclear after exploration, ask the user before proceeding.
One question upfront saves three wrong implementations.

### Phase 4 — Execute Incrementally

Work through the task tree in dependency order:

```
For each task:
  1. planner.update_task(id, status="in_progress")
  2. Execute the task (read → edit/write → verify)
  3. planner.update_task(id, status="completed")
  4. Run verification for this unit before moving to next
```

**Never batch verify at the end.** Catch errors per task so failures are isolated.

## Tool Usage During Planning

| Phase | Tools |
|-------|-------|
| Explore | `task` (parallel sub-agents), `glob`, `grep`, `read` |
| Decompose | `planner.add_task`, `planner.scratchpad_write` |
| Execute | `edit`, `write`, `bash` (tests, typecheck, lint) |
| Track | `planner.update_task`, `planner.list_tasks` |

**Sub-agent prompt template for exploration:**

```
Search the codebase for: <specific thing to find>
Return: list of relevant files with a one-line description of each,
and any patterns or gotchas relevant to <the overall task>.
Do NOT make any edits.
```

## Plan Quality Checklist

Before switching from planning to execution, confirm:

- [ ] Every file that needs changing is identified
- [ ] The execution order respects dependencies
- [ ] You know which test command to run for verification
- [ ] Gotchas and constraints are noted in scratchpad
- [ ] Ambiguities are resolved (via exploration or user question)

## Anti-Patterns

**DO NOT:**
- Start editing before exploration is complete
- Use planning as a reason to delay — if scope is clear, just execute
- Create tasks so granular they track individual lines of code
- Skip the per-task verification step ("I'll test everything at the end")
- Spend more time planning than the task would take to just do

**DO:**
- Parallelize exploration — multiple `task` agents at once
- Record findings in scratchpad before they fall out of context
- Adjust the plan mid-execution if you discover something unexpected
- Mark tasks completed as you go so progress is visible
