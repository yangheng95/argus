# Agent: fidelity-review (attempt 1)
- Time: 2026-04-03T06:57:54.774Z
- Sequence: 2
- goalCount: 2
- model: glm-5

## System Prompt

````
You are a fidelity reviewer for OpenCorvus, an autonomous coding orchestrator.

Your job is to verify that a set of goal contracts faithfully covers the ORIGINAL user request.
You compare goals against the raw user input — NOT against any intermediate specification.

## What to Check

1. **Coverage**: Every distinct requirement in the user request must be addressed by at least one goal
2. **Fidelity**: Goals must not distort or reinterpret what the user asked for
3. **Completeness**: Goals must not merge unrelated requirements (losing granularity)
4. **No hallucination**: Goals must not add requirements the user didn't ask for

## Output Format (JSON)

```json
{
  "verdict": "faithful" | "needs_correction",
  "issues": [
    { "type": "uncovered" | "partial" | "distorted" | "merged_incorrectly", "description": "..." }
  ],
  "corrections": [
    { "action": "modify" | "split" | "remove", "goalID": "...", "reason": "...",
      "updates": { "title": "...", "objective": "...", "done_definition": "..." } }
  ],
  "missing_goals": [
    { "title": "...", "objective": "...", "done_definition": "...", "owned_paths": [],
      "kind": "feature", "priority": "blocking", "reason": "..." }
  ]
}
```

If all requirements are covered faithfully, return `{ "verdict": "faithful", "issues": [], "corrections": [], "missing_goals": [] }`.
````

## Messages (1)

### Message 1 [user]

# User Request (ORIGINAL — this is the ground truth)

Title: Overlay Web Benchmark NoteStore

Implement a minimal NoteStore.

Only create or modify these files:
- src/note-store.ts
- src/note-store.test.ts

Do not add package.json, tsconfig.json, README files, docs, or any other files unless they are strictly required.
The Bun runtime and bun:test are already available, and the project scaffold is ready.

Requirements for src/note-store.ts:
- export interface Note { id: string; title: string; done: boolean; created_at: number }
- export class NoteStore backed by an in-memory Map<string, Note>
- create(title: string): trim the title, throw on empty input, use crypto.randomUUID(), set done=false and created_at=Date.now()
- get(id: string): return Note | undefined
- list(): return all notes sorted by created_at ascending
- toggle(id: string): flip done and return the updated note or undefined
- remove(id: string): delete the note and return boolean

Requirements for src/note-store.test.ts:
- use bun:test
- cover these cases:
  1. create returns a complete Note
  2. empty title throws
  3. list preserves creation order
  4. toggle flips done
  5. remove deletes successfully and get then returns undefined

Acceptance:
- run bun test ./src/note-store.test.ts
- that command must pass

# Goal Contracts (2 goals)


## goal_notestore_impl: Implement NoteStore class
Objective: | Create src/note-store.ts with the following implementation: 1. Export interface Note with exact shape: { id: string; title: string; done: boolean; created_at: number } 2. Export class NoteStore: - Private property: notes = new Map<string, Note>() - create(title: string): Note * Trim the title using title.trim() * Throw Error if trimmed title is empty (length === 0) * Generate id using crypto.randomUUID() * Set done = false * Set created_at = Date.now() * Store in Map and return the complete Note - get(id: string): Note | undefined * Return the note from Map or undefined - list(): Note[] * Convert Map values to array * Sort by created_at ascending (oldest first) * Return sorted array - toggle(id: string): Note | undefined * Find note by id * If found, flip done (done = !done) and update Map * Return updated note or undefined if not found - remove(id: string): boolean * Delete from Map * Return true if deleted, false if not found Use proper TypeScript types for all method signatures.
Done Definition: | - src/note-store.ts exists and exports Note interface and NoteStore class - TypeScript compiles without errors (strict mode) - All 5 methods (create, get, list, toggle, remove) are implemented - create throws on empty/whitespace-only title - crypto.randomUUID() is used for ID generation
Owned Paths: src/note-store.ts
Priority: blocking
Kind: feature
Exports: | interface Note { id: string; title: string; done: boolean; created_at: number } class NoteStore { create(title: string): Note; get(id: string): Note | undefined; list(): Note[]; toggle(id: string): Note | undefined; remove(id: string): boolean }

## goal_notestore_tests: Implement NoteStore test suite
Objective: | Create src/note-store.test.ts using bun:test with comprehensive test coverage: Import { test, describe, expect } from "bun:test" Import { Note, NoteStore } from "./note-store" Create a describe block for NoteStore with these test cases: 1. "create returns a complete Note" - Create new NoteStore instance - Call create("Test Title") - Assert returned note has: * id that is a valid UUID string * title equal to "Test Title" * done equal to false * created_at that is a number close to Date.now() 2. "empty title throws" - Create new NoteStore instance - Assert create("") throws error - Assert create("   ") throws error (whitespace only) - Use expect(() => store.create("")).toThrow() 3. "list preserves creation order" - Create new NoteStore instance - Create 3 notes with small delays or track timestamps - Call list() - Assert notes are sorted by created_at ascending (first created first) 4. "toggle flips done" - Create new NoteStore instance - Create a note, capture its id - Assert note.done === false - Call toggle(id) - Assert returned note has done === true - Call toggle(id) again - Assert returned note has done === false - Assert toggle("non-existent-id") returns undefined 5. "remove deletes successfully and get returns undefined" - Create new NoteStore instance - Create a note, capture its id - Call remove(id), assert returns true - Call get(id), assert returns undefined - Call remove(id) again, assert returns false - Call remove("non-existent-id"), assert returns false Each test should be self-contained (create new NoteStore instance).
Done Definition: | - src/note-store.test.ts exists - All 5 test cases are implemented with descriptive names - Each test case verifies the expected behavior - Running "bun test ./src/note-store.test.ts" passes all tests - Tests import correctly from ./note-store
Owned Paths: src/note-store.test.ts
Priority: blocking
Kind: verification
Exports: Test file that validates NoteStore implementation
Imports: | interface Note (from goal_notestore_impl) class NoteStore (from goal_notestore_impl)

Now compare the goals against the user request and produce your fidelity verdict as JSON.

## Output

```json
{
  "verdict": "faithful",
  "issues": [],
  "corrections": [],
  "missing_goals": []
}
```
