# Agent: fidelity-review (attempt 1)
- Time: 2026-04-09T11:20:19.580Z
- Sequence: 2
- goalCount: 1
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

# Goal Contracts (1 goals)


## goal_note_store: Implement NoteStore with tests
Objective: Create a minimal NoteStore implementation in src/note-store.ts with a comprehensive test suite in src/note-store.test.ts. 

For src/note-store.ts:
- Export interface Note { id: string; title: string; done: boolean; created_at: number }
- Export class NoteStore backed by an in-memory Map<string, Note>
- Implement create(title: string): trim the title string, throw an error if empty after trimming, generate id using crypto.randomUUID(), set done=false and created_at=Date.now()
- Implement get(id: string): return Note | undefined from the internal Map
- Implement list(): return all notes as an array sorted by created_at in ascending order (oldest first)
- Implement toggle(id: string): flip the done boolean for the note with given id, return the updated Note or undefined if not found
- Implement remove(id: string): delete the note from the Map, return boolean indicating success

For src/note-store.test.ts:
- Import { describe, it, expect } from "bun:test"
- Test case 1: create returns a complete Note with all required fields (id, title, done, created_at)
- Test case 2: creating a note with empty/whitespace-only title throws an error
- Test case 3: list() returns notes in creation order (sorted by created_at ascending)
- Test case 4: toggle(id) flips the done boolean from false to true or true to false
- Test case 5: remove(id) deletes the note and subsequent get(id) returns undefined

Ensure all TypeScript types are correct and the module uses ES module syntax.
Done Definition: bun test ./src/note-store.test.ts passes with all 5 test cases succeeding
Owned Paths: src/note-store.ts, src/note-store.test.ts
Priority: blocking
Kind: feature
Exports: interface Note { id: string; title: string; done: boolean; created_at: number }; class NoteStore { create(title: string): Note; get(id: string): Note | undefined; list(): Note[]; toggle(id: string): Note | undefined; remove(id: string): boolean }

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
