# Agent: fidelity-review (attempt 1)
- Time: 2026-04-03T07:28:53.708Z
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


## goal_note_store: Implement NoteStore class with Note interface
Objective: Create src/note-store.ts containing: 1. Export interface Note with fields: id (string), title (string), done (boolean), created_at (number) 2. Export class NoteStore with a private Map<string, Note> backing store 3. Method create(title: string): trim the title, throw Error if empty after trim, generate id using crypto.randomUUID(), set done=false, created_at=Date.now(), store and return the Note 4. Method get(id: string): return Note | undefined from the Map 5. Method list(): return Array<Note> of all notes sorted by created_at ascending (oldest first) 6. Method toggle(id: string): find note by id, flip the done boolean, update in Map, return updated Note or undefined if not found 7. Method remove(id: string): delete note from Map, return true if existed and was deleted, false otherwise
Done Definition: src/note-store.ts exists, exports Note interface and NoteStore class, all methods implemented correctly per requirements, TypeScript compiles without errors
Owned Paths: src/note-store.ts
Priority: blocking
Kind: feature
Exports: interface Note { id: string; title: string; done: boolean; created_at: number }, class NoteStore { create(title: string): Note; get(id: string): Note | undefined; list(): Note[]; toggle(id: string): Note | undefined; remove(id: string): boolean }

## goal_note_store_tests: Implement NoteStore test suite
Objective: Create src/note-store.test.ts using bun:test that covers: 1. Test: create returns a complete Note with all required fields (id, title, done, created_at), verify done is false, created_at is a number, id is a string, title matches input 2. Test: empty title (or whitespace-only) throws an error - test both empty string and whitespace-only strings 3. Test: list preserves creation order - create multiple notes and verify list() returns them sorted by created_at ascending 4. Test: toggle flips done status - create a note, verify done is false, toggle it, verify done is true, toggle again, verify done is false 5. Test: remove deletes successfully - create a note, verify it exists with get(), remove it, verify remove returns true, verify get() returns undefined after removal Import Note and NoteStore from ./note-store. Use describe/it/expect patterns from bun:test.
Done Definition: src/note-store.test.ts exists, imports from ./note-store, uses bun:test, all 5 test cases implemented, running "bun test ./src/note-store.test.ts" passes
Owned Paths: src/note-store.test.ts
Priority: blocking
Kind: verification
Imports: interface Note, class NoteStore (from goal_note_store)

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
