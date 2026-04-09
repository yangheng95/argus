# Agent: fidelity-review (attempt 1)
- Time: 2026-04-09T09:46:03.427Z
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
Objective: Implement the NoteStore class and Note interface in src/note-store.ts. Create a Note interface with id (string), title (string), done (boolean), and created_at (number) fields. Implement NoteStore class backed by an in-memory Map<string, Note>. The class must have these methods: 1) create(title: string) - trim the input title, throw Error if empty after trimming, generate id using crypto.randomUUID(), set done=false, set created_at=Date.now(), store in Map and return the Note. 2) get(id: string) - return Note | undefined from Map. 3) list() - return Array<Note> sorted by created_at in ascending order (oldest first). 4) toggle(id: string) - find note by id, flip its done boolean, return updated Note or undefined if not found. 5) remove(id: string) - delete note from Map and return boolean indicating success.
Done Definition: src/note-store.ts exists, exports interface Note and class NoteStore, NoteStore has create/get/list/toggle/remove methods with correct signatures, create throws on empty title, list returns notes sorted by created_at ascending, TypeScript compiles without errors
Owned Paths: src/note-store.ts
Priority: blocking
Kind: feature
Exports: interface Note { id: string; title: string; done: boolean; created_at: number }; class NoteStore { create(title: string): Note; get(id: string): Note | undefined; list(): Note[]; toggle(id: string): Note | undefined; remove(id: string): boolean }

## goal_notestore_tests: NoteStore Tests
Objective: Implement comprehensive tests for NoteStore in src/note-store.test.ts using bun:test. Import { describe, it, expect } from 'bun:test' and import { NoteStore } from './note-store'. Write test cases covering: 1) create returns a complete Note with all required fields (id, title, done, created_at). 2) empty title (after trim) throws an Error. 3) list() returns notes in creation order (sorted by created_at ascending). 4) toggle() flips the done flag from false to true and returns the updated note. 5) remove() deletes a note successfully and subsequent get() returns undefined. Use expect().toBe(), expect().toThrow(), expect().toBeUndefined() etc. for assertions.
Done Definition: src/note-store.test.ts exists and uses bun:test, all 5 test cases pass when running 'bun test ./src/note-store.test.ts'
Owned Paths: src/note-store.test.ts
Priority: blocking
Kind: verification
Imports: class NoteStore from goal_notestore_impl

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
