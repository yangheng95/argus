# Agent: fidelity-review (attempt 1)
- Time: 2026-04-08T13:51:44.915Z
- Sequence: 2
- goalCount: 2
- model: claude-sonnet-4-6

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


## goal_note_store: Implement NoteStore (src/note-store.ts)
Objective: Create src/note-store.ts implementing the full NoteStore module.

Export the following interface exactly:
  export interface Note { id: string; title: string; done: boolean; created_at: number }

Export a class NoteStore backed by a private in-memory Map&lt;string, Note&gt;.

Implement these methods:

1. create(title: string): Note
   - Trim the title string before processing.
   - If the trimmed title is empty, throw an error (e.g., new Error("Title must not be empty")).
   - Generate a unique id via crypto.randomUUID().
   - Set done = false.
   - Set created_at = Date.now().
   - Store the note in the Map and return it.

2. get(id: string): Note | undefined
   - Return the Note for the given id, or undefined if not found.

3. list(): Note[]
   - Return all notes as an array sorted by created_at ascending (oldest first).

4. toggle(id: string): Note | undefined
   - Look up the note by id; if not found return undefined.
   - Flip its done field (true → false, false → true).
   - Persist the mutation and return the updated Note.

5. remove(id: string): boolean
   - Delete the note from the Map.
   - Return true if it existed and was deleted, false if it was not found.

Use TypeScript strict mode (already configured in tsconfig.json). Do NOT create any other files. The project already has package.json and tsconfig.json — do not modify them.
Done Definition: src/note-store.ts exists, exports the Note interface and NoteStore class with all 5 methods (create, get, list, toggle, remove) matching the specified signatures. TypeScript compilation produces no errors under the existing tsconfig.json strict config.
Owned Paths: src/note-store.ts
Priority: blocking
Kind: feature
Exports: export interface Note { id: string; title: string; done: boolean; created_at: number }; export class NoteStore { create(title: string): Note; get(id: string): Note | undefined; list(): Note[]; toggle(id: string): Note | undefined; remove(id: string): boolean }

## goal_note_store_tests: Implement NoteStore tests (src/note-store.test.ts)
Objective: Create src/note-store.test.ts using bun:test to test the NoteStore class from src/note-store.ts.

Import { describe, test, expect, beforeEach } from "bun:test" and { NoteStore } (and Note if needed) from "./note-store".

Structure the file with a describe block (or flat test calls) covering exactly these 5 cases:

1. "create returns a complete Note"
   - Call store.create("Hello").
   - Assert the returned object has: a string id (truthy), title === "Hello", done === false, created_at is a number (> 0).

2. "empty title throws"
   - Use expect(() => store.create("")).toThrow() or toThrow(Error).
   - Also verify that a whitespace-only title ("   ") throws (since create trims before checking).

3. "list preserves creation order"
   - Create at least 2 notes sequentially (e.g., "A" then "B").
   - Call store.list() and assert the notes appear in insertion/created_at ascending order.
   - Assert list() returns an array sorted by created_at ascending.

4. "toggle flips done"
   - Create a note; assert its initial done === false.
   - Call toggle(id); assert the returned note's done === true.
   - Call toggle(id) again; assert done flips back to false.
   - Assert toggle on a non-existent id returns undefined.

5. "remove deletes successfully and get returns undefined"
   - Create a note, then call remove(id).
   - Assert remove returned true.
   - Assert store.get(id) returns undefined after removal.
   - Assert remove on an already-deleted id returns false.

Use a fresh NoteStore instance per test (beforeEach or per-test instantiation).

Import style: use ESM imports ("bun:test", "./note-store"). Do NOT create any other files. Do NOT modify package.json or tsconfig.json.
Done Definition: src/note-store.test.ts exists and `bun test ./src/note-store.test.ts` exits with code 0 with all 5 test cases passing: (1) create returns a complete Note, (2) empty title throws, (3) list preserves creation order, (4) toggle flips done, (5) remove deletes and get returns undefined.
Owned Paths: src/note-store.test.ts
Priority: blocking
Kind: verification
Imports: export interface Note { id: string; title: string; done: boolean; created_at: number }; export class NoteStore { create(title: string): Note; get(id: string): Note | undefined; list(): Note[]; toggle(id: string): Note | undefined; remove(id: string): boolean }

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
