# Agent: fidelity-review (attempt 1)
- Time: 2026-04-03T07:50:42.228Z
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


## goal_notestore_impl: NoteStore Implementation
Objective: | Implement src/note-store.ts with: 1. Export interface Note { id: string; title: string; done: boolean; created_at: number } 2. Export class NoteStore backed by private Map<string, Note> 3. create(title: string): trim the input title, throw Error if empty after trim, generate id using crypto.randomUUID(), set done=false, set created_at=Date.now(), store and return the Note 4. get(id: string): lookup in Map, return Note | undefined 5. list(): extract all notes from Map, sort by created_at ascending (oldest first), return array 6. toggle(id: string): find note by id, if found flip done boolean, update in Map, return updated Note; if not found return undefined 7. remove(id: string): delete from Map using id, return true if existed and was deleted, false otherwise Use strict TypeScript types. The class should be instantiable with `new NoteStore()`.
Done Definition: | - src/note-store.ts exists and exports Note interface and NoteStore class - All methods (create, get, list, toggle, remove) are implemented with correct signatures - create() trims title and throws on empty input - list() returns notes sorted by created_at ascending - toggle() flips done status and returns updated note - remove() returns boolean indicating success
Owned Paths: src/note-store.ts
Priority: blocking
Kind: feature
Exports: | interface Note { id: string; title: string; done: boolean; created_at: number } class NoteStore { create(title: string): Note get(id: string): Note | undefined list(): Note[] toggle(id: string): Note | undefined remove(id: string): boolean }

## goal_notestore_tests: NoteStore Tests
Objective: | Implement src/note-store.test.ts using bun:test with comprehensive test coverage: 1. Test that create returns a complete Note with all required fields (id, title, done, created_at) - Verify id is a string - Verify title matches input (after trim) - Verify done is false initially - Verify created_at is a number 2. Test that empty title throws an error - Test with empty string "" - Test with whitespace-only string "   " - Verify appropriate error is thrown 3. Test that list preserves creation order (sorted by created_at ascending) - Create multiple notes with different titles - Verify list() returns them in order of creation (oldest first) 4. Test that toggle flips the done status - Create a note - Toggle it, verify done becomes true - Toggle again, verify done becomes false - Verify toggle returns the updated note 5. Test that remove deletes successfully - Create a note, remember its id - Remove it, verify returns true - Verify get(id) returns undefined after removal Import { describe, it, expect } from "bun:test" Import Note and NoteStore from "./note-store.ts"
Done Definition: | - src/note-store.test.ts exists and uses bun:test - All 5 test cases pass when running `bun test ./src/note-store.test.ts` - Tests cover: create returns complete Note, empty title throws, list order, toggle flips done, remove deletes
Owned Paths: src/note-store.test.ts
Priority: blocking
Kind: verification
Imports: | interface Note { id: string; title: string; done: boolean; created_at: number } class NoteStore { create(title: string): Note; get(id: string): Note | undefined; list(): Note[]; toggle(id: string): Note | undefined; remove(id: string): boolean } (from goal_notestore_impl)

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
