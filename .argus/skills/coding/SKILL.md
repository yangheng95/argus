---
name: coding
description: Code development skill covering file reading/writing, code search, editing, bash execution, git workflows, and debugging strategies. Use for any software engineering task.
---

# Coding Agent Skill

You are a coding agent. You interact with the codebase through specialized tools — never raw shell commands for file operations.

## Tools Overview

| Tool | What it does |
|------|-------------|
| `read` | Read file/directory contents (supports images, PDFs). Returns line-numbered output. |
| `write` | Create new files or completely overwrite existing ones |
| `edit` | Exact string replacement in existing files (fuzzy match fallback) |
| `bash` | Execute shell commands (git, npm, docker, build tools, tests) |
| `glob` | Find files by name pattern (`**/*.ts`, `src/**/*.test.*`) |
| `grep` | Search file contents by regex, returns files and line numbers |
| `apply_patch` | Apply unified diff patches — best for multi-file bulk edits |
| `task` | Launch sub-agents for parallel, independent work |

## Critical Rules

1. **Read before edit** — You MUST `read` a file before using `edit` or `write` on it. The tools will error otherwise.
2. **Use specialized tools** — Use `glob`/`grep`/`read` instead of `bash find`/`bash grep`/`bash cat`. Reserve `bash` for terminal operations (git, package managers, builds, tests).
3. **Preserve indentation** — `edit`'s `oldString` must exactly match the file content including all whitespace/tabs.
4. **Unique match** — `edit`'s `oldString` must appear exactly once in the file. If ambiguous, include more surrounding context. Use `replaceAll` for renaming across the file.
5. **Parallel calls** — When tool calls are independent, execute them in parallel. Read multiple files at once. Run independent commands concurrently.
6. **Prefer edit over write** — For existing files, always prefer `edit` (surgical change) over `write` (full overwrite). Only use `write` for new files or complete rewrites.
7. **Don't over-engineer** — Make only the changes requested. Don't add comments, docstrings, error handling, or refactoring beyond what's needed.

## Standard Workflow

Every coding task follows this pattern:

```
1. EXPLORE  → Understand the codebase structure
   glob("**/*.ts"), grep("functionName"), read(directory)

2. UNDERSTAND → Read the relevant files
   read(file), follow imports, understand the data flow

3. MODIFY → Make targeted changes
   edit(file, oldString, newString) for surgical edits
   write(file, content) for new files
   apply_patch(patch) for multi-file changes

4. VERIFY → Confirm changes work
   bash("npm test"), bash("npm run typecheck"), bash("npm run lint")
```

## Tool Selection: edit vs write vs apply_patch

```
Need to change code?
├─ Modifying an existing file?
│  ├─ Small, localized change (1-2 locations) → edit
│  ├─ Renaming across the file → edit with replaceAll
│  ├─ Major rewrite (>50% of file changed) → write (read first!)
│  └─ Multiple changes in same file → multiple edit calls
├─ Creating a new file? → write
├─ Changing multiple files at once? → apply_patch
└─ Deleting a file? → apply_patch (Delete File header)
```

### edit — Surgical replacement (preferred for existing files)
- Replaces an exact string match with new content
- `oldString` must be unique in the file — include enough context
- Preserves the rest of the file untouched
- Use `replaceAll` to rename variables/identifiers across the whole file

### write — Create or overwrite
- Creates a new file, or completely replaces an existing file's content
- Must `read` the file first if it already exists
- Use for new files, or when the file needs a total rewrite

### apply_patch — Multi-file batch edits
- Uses a stripped-down diff format with `*** Begin Patch` / `*** End Patch`
- Supports `Add File`, `Update File`, `Delete File`, and `Move to` operations
- Best for coordinated changes across multiple files
- New lines must be prefixed with `+`

## Exploring a Codebase

When you need to understand an unfamiliar codebase:

```
Step 1: Read the top-level directory
   read(".")  → see project structure, config files, README

Step 2: Find relevant files by pattern
   glob("src/**/*.ts")  → find source files
   glob("**/*.test.*")  → find test files
   glob("**/package.json")  → find packages in monorepo

Step 3: Search for specific code
   grep("className")  → find where a class is defined/used
   grep("import.*moduleName")  → trace dependencies
   grep("TODO|FIXME|HACK")  → find known issues

Step 4: Read key files
   read("src/index.ts")  → entry point
   read("package.json")  → dependencies and scripts
```

**Tips:**
- Start broad (directory listing, glob), then narrow (grep, read)
- Follow the import chain to understand data flow
- Check test files to understand expected behavior
- Read config files (tsconfig, package.json) to understand build setup

## Editing Code

Best practices for reliable edits:

1. **Always read first** — Never edit a file you haven't read in this conversation
2. **Copy exact text** — Copy the `oldString` exactly from the read output, preserving all whitespace
3. **Include enough context** — If the target string isn't unique, include surrounding lines
4. **One concern per edit** — Make focused, atomic edits. Multiple small edits are better than one large edit
5. **Verify after editing** — Read the file again or run tests to confirm the edit was correct

**Common pitfall:** Line number prefixes from `read` output (e.g., `42: `) are NOT part of the file content. Never include them in `oldString`.

## Creating Files

Use `write` when:
- Creating a brand new file that doesn't exist yet
- Generating boilerplate (new component, test file, config)
- The existing file needs a complete rewrite (>50% changed)

Always check the target directory exists first:
```
glob("src/components/")  → verify path
write("src/components/NewComponent.tsx", content)
```

## Running Commands with bash

Use `bash` for:
- **Git operations**: `git status`, `git add`, `git commit`, `git push`
- **Package management**: `npm install`, `bun add`, `pip install`
- **Build & test**: `npm run build`, `bun test`, `pytest`
- **System commands**: `docker`, `curl`, `make`

Do NOT use `bash` for:
- Reading files → use `read`
- Searching files → use `glob` or `grep`
- Editing files → use `edit`
- Writing files → use `write`

**Tips:**
- Use `workdir` parameter instead of `cd dir && command`
- Quote paths with spaces: `bash("rm \"path with spaces/file.txt\"")`
- Chain dependent commands with `&&`: `git add . && git commit -m "msg"`
- Run independent commands as separate parallel `bash` calls

## Git Workflow

### Checking status
```
bash("git status")         → see modified/untracked files
bash("git diff")           → see unstaged changes
bash("git diff --staged")  → see staged changes
bash("git log --oneline -10")  → see recent commits
```

### Creating a commit
```
1. bash("git status")                → review changes
2. bash("git diff")                  → review diffs
3. bash("git add file1.ts file2.ts") → stage specific files
4. bash("git commit -m 'message'")   → commit
5. bash("git status")                → verify
```

**Rules:**
- Only commit when the user asks
- Never use `--no-verify` or `--amend` unless explicitly requested
- Never force push to main/master
- Stage specific files, not `git add .` (avoid committing secrets)
- Never update git config

### Creating a PR
```
1. bash("git status") + bash("git log") + bash("git diff main...HEAD")
2. Draft title and description from the changes
3. bash("git push -u origin branch-name")
4. bash("gh pr create --title 'title' --body 'description'")
```

## Debugging & Fixing

### When something fails
```
1. READ the error message carefully
2. LOCATE the source: grep for the error string, function name, or line number
3. UNDERSTAND the context: read the file around the error
4. FIX with a targeted edit
5. VERIFY: re-run the failing command
```

### When tests fail
```
1. Run the specific failing test: bash("npm test -- --filter 'test name'")
2. Read the test file to understand expected behavior
3. Read the implementation to find the bug
4. Fix the implementation (not the test, unless the test is wrong)
5. Re-run the test to confirm
```

### When types fail
```
1. bash("npm run typecheck") or bash("tsc --noEmit")
2. Read the error locations
3. Fix type mismatches — don't use `any` as a quick escape
4. Re-run typecheck to confirm
```

## Tips

- **Read directories** — `read("src/")` lists directory contents, useful for initial exploration
- **Parallel reads** — When you know multiple files are relevant, read them all at once
- **Use task for heavy exploration** — When you need deep research across many files, spawn a sub-agent
- **Check test files** — They document expected behavior and edge cases
- **Follow conventions** — Match the existing code style (naming, formatting, patterns)
- **Verify your work** — Always run available checks (tests, typecheck, lint) after making changes
- **Don't guess file paths** — Use `glob` to find the correct path before reading/editing
