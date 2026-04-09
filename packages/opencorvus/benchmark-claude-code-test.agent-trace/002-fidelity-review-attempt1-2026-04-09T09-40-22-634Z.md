# Agent: fidelity-review (attempt 1)
- Time: 2026-04-09T09:40:22.635Z
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
Objective: Implement the NoteStore class in src/note-store.ts. Export interface Note with fields: id (string), title (string), done (boolean), created_at (number). Implement NoteStore class backed by an in-memory Map<string, Note> with methods: create(title) - trim title, throw Error on empty string, use crypto.randomUUID() for id, set done=false and created_at=Date.now(); get(id) - return Note | undefined; list() - return Note[] sorted by created_at ascending; toggle(id) - flip the done boolean, return updated Note or undefined if not found; remove(id) - delete from Map, return boolean indicating success. All methods must be properly typed with TypeScript.
Done Definition: src/note-store.ts compiles without errors, exports Note interface and NoteStore class with all 5 methods working correctly, and can be imported by test file
Owned Paths: src/note-store.ts
Priority: blocking
Kind: feature
Exports: interface Note { id: string; title: string; done: boolean; created_at: number }; class NoteStore { create(title: string): Note; get(id: string): Note | undefined; list(): Note[]; toggle(id: string): Note | undefined; remove(id: string): boolean }

## goal_notestore_tests: NoteStore Test Suite
Objective: Implement comprehensive tests for NoteStore in src/note-store.test.ts using bun:test. Import NoteStore from ./note-store.ts. Write 5 test cases: 1) create returns a complete Note with all required fields; 2) empty title throws an error; 3) list preserves creation order (sorted by created_at ascending); 4) toggle flips the done boolean correctly; 5) remove deletes successfully and subsequent get returns undefined. Use describe/it pattern or test() function as appropriate for bun:test.
Done Definition: bun test ./src/note-store.test.ts passes all 5 test cases with no failures
Owned Paths: src/note-store.test.ts
Priority: blocking
Kind: verification
Imports: class NoteStore; interface Note from ./note-store.ts

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
