# Agent: fidelity-review (attempt 1)
- Time: 2026-04-03T06:45:46.615Z
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


## goal_notestore_impl: Implement NoteStore class with full API
Objective: | Create src/note-store.ts implementing a complete NoteStore: 1. Export interface Note with exact fields:
Done Definition: 
Owned Paths: (none)
Priority: blocking
Kind: feature

## goal_notestore_tests: Implement comprehensive bun:test test suite
Objective: | Create src/note-store.test.ts with bun:test covering: Import { test, expect, describe } from 'bun:test' Import { NoteStore } from './note-store' Test cases (use describe/it or test blocks): 1. "create returns a complete Note" - Create NoteStore instance - Call create("Test Title") - Assert returned Note has: id (string), title === "Test Title", done === false, created_at (number) - Assert id is valid UUID format 2. "empty title throws" - Create NoteStore instance - Assert create("") throws - Assert create("   ") throws (whitespace only) 3. "list preserves creation order" - Create NoteStore instance - Create 3 notes with small delays or verify created_at ordering - Call list() - Assert notes are in ascending created_at order (oldest first) 4. "toggle flips done" - Create NoteStore instance - Create a note (done should be false) - Call toggle(noteId) - Assert returned note.done === true - Call toggle again - Assert returned note.done === false 5. "remove deletes successfully and get returns undefined" - Create NoteStore instance - Create a note, capture id - Call remove(id), assert returns true - Call get(id), assert returns undefined - Call remove(id) again, assert returns false Run tests with: bun test ./src/note-store.test.ts
Done Definition: | - File src/note-store.test.ts exists - Uses bun:test (import { test, expect } from 'bun:test') - Contains all 5 required test cases - All tests pass when running: bun test ./src/note-store.test.ts - No other files created
Owned Paths: src/note-store.test.ts
Priority: blocking
Kind: verification
Exports: | Test file passes: bun test ./src/note-store.test.ts
Imports: | class NoteStore (from goal_notestore_impl) interface Note (from goal_notestore_impl)

Now compare the goals against the user request and produce your fidelity verdict as JSON.

## Output

```json
{
  "verdict": "needs_correction",
  "issues": [
    { "type": "partial", "description": "goal_notestore_impl has a truncated objective that ends mid-sentence ('Export interface Note with exact fields:') - missing complete specification of the Note interface fields and all NoteStore methods" },
    { "type": "uncovered", "description": "goal_notestore_impl has an empty done_definition, providing no completion criteria" },
    { "type": "uncovered", "description": "goal_notestore_impl has no owned_paths specified, but should own src/note-store.ts" },
    { "type": "partial", "description": "goal_notestore_impl does not specify: Map<string, Note> backing store, create() trimming/throwing/UUID/timestamp behavior, get() return type, list() sorting behavior, toggle() return behavior, remove() return behavior" }
  ],
  "corrections": [
    { 
      "action": "modify", 
      "goalID": "goal_notestore_impl", 
      "reason": "Objective and done definition are incomplete/truncated, owned paths missing, and key implementation details from user requirements are not specified",
      "updates": { 
        "objective": "Create src/note-store.ts implementing a complete NoteStore:\n\n1. Export interface Note with exact fields: { id: string; title: string; done: boolean; created_at: number }\n\n2. Export class NoteStore:\n   - Backed by in-memory Map<string, Note>\n   - create(title: string): Note - trim the title, throw on empty input, use crypto.randomUUID() for id, set done=false and created_at=Date.now()\n   - get(id: string): Note | undefined - return the note or undefined if not found\n   - list(): Note[] - return all notes sorted by created_at ascending (oldest first)\n   - toggle(id: string): Note | undefined - flip done and return the updated note or undefined if not found\n   - remove(id: string): boolean - delete the note and return true if deleted, false if not found",
        "done_definition": "- File src/note-store.ts exists\n- Exports interface Note with fields: id (string), title (string), done (boolean), created_at (number)\n- Exports class NoteStore\n- NoteStore uses Map<string, Note> as backing store\n- create() trims title, throws on empty/whitespace-only input, generates UUID via crypto.randomUUID(), sets done=false and created_at=Date.now()\n- get() returns Note or undefined\n- list() returns notes sorted by created_at ascending\n- toggle() flips done and returns updated Note or undefined\n- remove() deletes and returns boolean",
        "owned_paths": ["src/note-store.ts"]
      } 
    }
  ],
  "missing_goals": []
}
```
