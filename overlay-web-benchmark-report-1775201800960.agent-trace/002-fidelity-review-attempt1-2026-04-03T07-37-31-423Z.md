# Agent: fidelity-review (attempt 1)
- Time: 2026-04-03T07:37:31.423Z
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


## goal_note_store: Implement NoteStore class and Note interface
Objective: | Create src/note-store.ts that exports: 1. Interface Note { id: string; title: string; done: boolean; created_at: number } 2. Class NoteStore with private Map<string, Note> storage Implement these methods on NoteStore: - create(title: string): Trim the title input. Throw an error if title is empty after trimming. Use crypto.randomUUID() for id, set done=false, created_at=Date.now(). Return the created Note. - get(id: string): Return Note | undefined from the Map. - list(): Return all notes as an array sorted by created_at in ascending order (oldest first). - toggle(id: string): Find note by id, flip the done boolean, return the updated Note or undefined if not found. - remove(id: string): Delete the note from Map, return true if deleted, false if not found. Use proper TypeScript types. The class should be exported as default or named export.
Done Definition: | - src/note-store.ts exists and exports Note interface - src/note-store.ts exports NoteStore class - NoteStore uses Map<string, Note> internally - All methods have correct signatures and implementations - TypeScript compiles without errors
Owned Paths: src/note-store.ts
Priority: blocking
Kind: feature
Exports: | interface Note { id: string; title: string; done: boolean; created_at: number } class NoteStore { create(title: string): Note get(id: string): Note | undefined list(): Note[] toggle(id: string): Note | undefined remove(id: string): boolean }

## goal_note_store_tests: Implement NoteStore test suite
Objective: | Create src/note-store.test.ts using bun:test (import { describe, test, expect } from 'bun:test'). Write exactly these 5 test cases: 1. "create returns a complete Note": Create a note, verify it has id (string), title (trimmed), done=false, created_at (number) 2. "empty title throws": Call create with empty string or whitespace-only, expect it to throw 3. "list preserves creation order": Create multiple notes, call list(), verify returned array is sorted by created_at ascending 4. "toggle flips done": Create a note, toggle it, verify done changed from false to true, toggle again verify it changes back 5. "remove deletes successfully and get then returns undefined": Create a note, remove it (verify returns true), then get same id and verify returns undefined All tests must pass when running `bun test ./src/note-store.test.ts`.
Done Definition: | - src/note-store.test.ts exists and uses bun:test - All 5 required test cases are implemented - Tests import from ../src/note-store.ts or ./note-store.ts - Running `bun test ./src/note-store.test.ts` passes
Owned Paths: src/note-store.test.ts
Priority: blocking
Kind: verification
Imports: | interface Note { id: string; title: string; done: boolean; created_at: number } class NoteStore from goal_note_store

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
