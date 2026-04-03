# Agent: fidelity-review (attempt 1)
- Time: 2026-04-03T07:20:10.043Z
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


## goal_note_store: Implement NoteStore class
Objective: | Create src/note-store.ts with: 1. Export interface Note { id: string; title: string; done: boolean; created_at: number } 2. Export class NoteStore with a private Map<string, Note> storage 3. Implement create(title: string): trim the input title, throw Error if empty after trimming, generate id using crypto.randomUUID(), set done=false, created_at=Date.now(), store and return the Note 4. Implement get(id: string): return Note | undefined from the Map 5. Implement list(): return Array.from(map.values()) sorted by created_at ascending (use sort with a - b comparison) 6. Implement toggle(id: string): find note by id, if found flip the done boolean, update in Map, return the updated Note; return undefined if not found 7. Implement remove(id: string): delete the note from Map using map.delete(id), return the boolean result of delete operation Use ES module syntax (export). The file should compile with strict TypeScript settings.
Done Definition: | - src/note-store.ts exists and exports Note interface and NoteStore class - NoteStore has all required methods: create, get, list, toggle, remove - TypeScript compiles without errors - All methods behave as specified (create validates input, uses crypto.randomUUID, etc.)
Owned Paths: src/note-store.ts
Priority: blocking
Kind: feature
Exports: | interface Note { id: string; title: string; done: boolean; created_at: number } class NoteStore { create(title: string): Note get(id: string): Note | undefined list(): Note[] toggle(id: string): Note | undefined remove(id: string): boolean }

## goal_note_store_tests: Implement NoteStore tests
Objective: | Create src/note-store.test.ts using bun:test (import { describe, it, expect } from 'bun:test'). Write tests covering: 1. create returns a complete Note: verify create() returns an object with id, title, done, created_at fields; verify done is false, created_at is a number, id is a string, title matches input 2. empty title throws: verify create('') throws an error, verify create('   ') (whitespace only) throws after trimming 3. list preserves creation order: create multiple notes with different titles, call list() and verify they are returned in order of creation (ascending created_at) 4. toggle flips done: create a note, verify done is false, call toggle with the note's id, verify returned note has done=true, call toggle again, verify done=false 5. remove deletes successfully and get then returns undefined: create a note, verify remove returns true, verify get returns undefined for that id, verify remove returns false for non-existent id All tests must pass when running `bun test ./src/note-store.test.ts`.
Done Definition: | - src/note-store.test.ts exists and uses bun:test - All 5 test cases are implemented and pass - Command `bun test ./src/note-store.test.ts` exits with code 0
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
