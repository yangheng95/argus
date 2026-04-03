# Agent: fidelity-review (attempt 1)
- Time: 2026-04-03T07:46:13.181Z
- Sequence: 2
- goalCount: 2
- model: kimi-k2.5

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


## goal_notestore: Implement NoteStore class and Note interface
Objective: | Create src/note-store.ts with: 1. Export interface Note { id: string; title: string; done: boolean; created_at: number } 2. Export class NoteStore with a private Map<string, Note> storage 3. create(title: string): - Trim the input title - Throw an error if title is empty after trimming - Generate id using crypto.randomUUID() - Set done=false, created_at=Date.now() - Store and return the Note 4. get(id: string): Return Note | undefined from the Map 5. list(): Return all notes as an array sorted by created_at ascending (oldest first) 6. toggle(id: string): Find note by id, flip the done boolean, return updated Note or undefined if not found 7. remove(id: string): Delete note from Map, return true if deleted, false if not found Use strict TypeScript with proper types. The Map should be private/internal to the class.
Done Definition: | - src/note-store.ts exists and exports both Note interface and NoteStore class - Note interface has all 4 required fields with correct types - NoteStore has all 5 methods (create, get, list, toggle, remove) with correct signatures - create properly trims title, throws on empty, uses crypto.randomUUID(), sets done=false and created_at=Date.now() - get returns Note | undefined - list returns Note[] sorted by created_at ascending - toggle flips done and returns updated Note | undefined - remove deletes and returns boolean
Owned Paths: src/note-store.ts
Priority: blocking
Kind: feature
Exports: | interface Note { id: string; title: string; done: boolean; created_at: number } class NoteStore { create(title: string): Note get(id: string): Note | undefined list(): Note[] toggle(id: string): Note | undefined remove(id: string): boolean }

## goal_tests: Implement NoteStore tests with bun:test
Objective: | Create src/note-store.test.ts using bun:test that covers: 1. create returns a complete Note: - Create a note with a valid title - Assert the returned object has id (string), title (matching input), done=false, created_at (number) 2. empty title throws: - Try to create with empty string "" - Assert an error is thrown - Try to create with whitespace-only "   " - Assert an error is thrown (after trim) 3. list preserves creation order: - Create multiple notes with different titles - Call list() - Assert returned array is sorted by created_at ascending (oldest first) 4. toggle flips done: - Create a note - Call toggle with the note's id - Assert returned note has done=true - Call toggle again - Assert returned note has done=false 5. remove deletes successfully and get then returns undefined: - Create a note - Call remove with the note's id - Assert returns true - Call get with the same id - Assert returns undefined Use describe/it pattern from bun:test. Import NoteStore from ./note-store.
Done Definition: | - src/note-store.test.ts exists and uses bun:test (import { describe, it, expect } from "bun:test") - All 5 test cases are implemented and pass - Tests properly import from ./note-store - Running `bun test ./src/note-store.test.ts` passes
Owned Paths: src/note-store.test.ts
Priority: blocking
Kind: verification
Imports: | interface Note { id: string; title: string; done: boolean; created_at: number } class NoteStore { create(title: string): Note; get(id: string): Note | undefined; list(): Note[]; toggle(id: string): Note | undefined; remove(id: string): boolean }

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
