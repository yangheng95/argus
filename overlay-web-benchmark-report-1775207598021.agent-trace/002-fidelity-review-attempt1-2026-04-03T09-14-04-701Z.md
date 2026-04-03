# Agent: fidelity-review (attempt 1)
- Time: 2026-04-03T09:14:04.701Z
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
Objective: Create src/note-store.ts that exports: 1. Interface Note with fields: id (string), title (string), done (boolean), created_at (number) 2. Class NoteStore with a private Map<string, Note> backing store 3. Method create(title: string): trims input, throws Error if empty after trim, generates id via crypto.randomUUID(), sets done=false and created_at=Date.now(), stores and returns the Note 4. Method get(id: string): returns Note | undefined from the Map 5. Method list(): returns Array<Note> sorted by created_at ascending (earliest first) 6. Method toggle(id: string): if note exists, flips done boolean, returns updated Note; otherwise returns undefined 7. Method remove(id: string): deletes note from Map, returns true if existed and was deleted, false otherwise Use TypeScript with strict typing. All methods must be public.
Done Definition: src/note-store.ts exists, exports Note interface and NoteStore class, all methods implemented per spec, TypeScript compiles without errors
Owned Paths: src/note-store.ts
Priority: blocking
Kind: feature
Exports: interface Note { id: string; title: string; done: boolean; created_at: number }, class NoteStore { create(title: string): Note; get(id: string): Note | undefined; list(): Note[]; toggle(id: string): Note | undefined; remove(id: string): boolean }

## goal_tests: Implement NoteStore tests
Objective: Create src/note-store.test.ts using bun:test that imports { Note, NoteStore } from './note-store.ts' and covers: 1. create returns a complete Note: verify returned object has id (string), title (matches input), done (false), created_at (number), and that get(id) returns the same note 2. empty title throws: verify that create('') and create('   ') (whitespace only) throw an Error 3. list preserves creation order: create multiple notes, verify list() returns them sorted by created_at ascending (creation order) 4. toggle flips done: create a note, call toggle(id), verify done changed from false to true, call toggle again, verify changed back to false 5. remove deletes successfully and get then returns undefined: create a note, verify remove(id) returns true, verify get(id) returns undefined afterward Use describe/it pattern from bun:test. All assertions should use expect().toBe(), .toEqual(), .toThrow(), etc.
Done Definition: src/note-store.test.ts exists, imports from note-store.ts, all 5 test cases implemented, running `bun test ./src/note-store.test.ts` passes
Owned Paths: src/note-store.test.ts
Priority: blocking
Kind: verification
Imports: interface Note, class NoteStore (from goal_notestore)

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
