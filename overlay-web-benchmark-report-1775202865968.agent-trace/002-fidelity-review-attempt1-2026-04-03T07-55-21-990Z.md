# Agent: fidelity-review (attempt 1)
- Time: 2026-04-03T07:55:21.990Z
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
Objective: | Create src/note-store.ts with: 1. Export interface Note { id: string; title: string; done: boolean; created_at: number } 2. Export class NoteStore with private Map<string, Note> storage 3. create(title: string): Trim the title using String.trim(). If trimmed title is empty, throw an Error. Otherwise create a Note with id=crypto.randomUUID(), done=false, created_at=Date.now(), and the trimmed title. Store and return the Note. 4. get(id: string): Return the Note from the Map or undefined if not found. 5. list(): Return all notes as an array sorted by created_at in ascending order (oldest first). 6. toggle(id: string): Find the note by id. If found, flip the done boolean (true->false, false->true), update in Map, and return the updated Note. Return undefined if not found. 7. remove(id: string): Delete the note from the Map using Map.delete(). Return true if a note was deleted, false otherwise. Use TypeScript with strict typing. The class should be stateful with the Map persisting across method calls.
Done Definition: | - src/note-store.ts exists and exports both Note interface and NoteStore class - TypeScript compiles without errors - All methods behave according to specifications
Owned Paths: src/note-store.ts
Priority: blocking
Kind: feature
Exports: | interface Note { id: string; title: string; done: boolean; created_at: number } class NoteStore { create(title: string): Note get(id: string): Note | undefined list(): Note[] toggle(id: string): Note | undefined remove(id: string): boolean }

## goal_tests: Implement NoteStore tests
Objective: | Create src/note-store.test.ts using bun:test (import { describe, test, expect } from "bun:test"). Import Note and NoteStore from "./note-store.ts". Write 5 test cases: 1. "create returns a complete Note": Create a note with title "Test Note", verify returned object has id (string), title ("Test Note"), done (false), and created_at (number). Verify the note is stored by calling get() with the returned id. 2. "empty title throws": Call create with "   " (whitespace only), expect it to throw an Error. 3. "list preserves creation order": Create 3 notes with different titles in sequence. Call list() and verify the returned array has 3 items in the same order as creation (ascending created_at). 4. "toggle flips done": Create a note, verify done is false. Call toggle() with the note's id, verify returned note has done=true. Call toggle() again, verify done=false. 5. "remove deletes successfully and get then returns undefined": Create a note, call remove() with its id, verify it returns true. Call get() with the same id, verify it returns undefined. Also verify remove() returns false for non-existent id. Use expect().toBe(), expect().toBeDefined(), expect().toThrow() as appropriate.
Done Definition: | - src/note-store.test.ts exists with all 5 test cases - Running `bun test ./src/note-store.test.ts` passes all tests
Owned Paths: src/note-store.test.ts
Priority: blocking
Kind: verification
Imports: | type Note (from goal_notestore) class NoteStore (from goal_notestore)

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
