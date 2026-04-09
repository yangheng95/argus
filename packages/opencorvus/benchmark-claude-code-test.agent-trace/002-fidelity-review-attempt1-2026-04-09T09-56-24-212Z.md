# Agent: fidelity-review (attempt 1)
- Time: 2026-04-09T09:56:24.212Z
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
Objective: Implement the NoteStore class in src/note-store.ts. This includes:
1. Export interface Note with fields: id (string), title (string), done (boolean), created_at (number)
2. Export class NoteStore with a private Map<string, Note> storage
3. Implement constructor that initializes the Map
4. Implement create(title: string): trim the input title (remove leading/trailing whitespace), throw an Error if empty after trimming, generate UUID via crypto.randomUUID(), set done=false, set created_at=Date.now(), store and return the new Note
5. Implement get(id: string): return Note | undefined from the Map
6. Implement list(): return all notes as an array sorted by created_at ascending (oldest first)
7. Implement toggle(id: string): find note by id, flip its done boolean, return the updated Note or undefined if not found
8. Implement remove(id: string): delete note from Map, return true if deleted (existed) or false if not found

The code must compile with strict TypeScript settings and use ES2022 features.
Done Definition: src/note-store.ts exists with exported Note interface and NoteStore class containing all 5 methods (create, get, list, toggle, remove) that compile without TypeScript errors and match the specified behavior
Owned Paths: src/note-store.ts
Priority: blocking
Kind: feature
Exports: interface Note { id: string; title: string; done: boolean; created_at: number }; class NoteStore { constructor(); create(title: string): Note; get(id: string): Note | undefined; list(): Note[]; toggle(id: string): Note | undefined; remove(id: string): boolean }

## goal_notestore_tests: NoteStore Tests
Objective: Implement comprehensive tests in src/note-store.test.ts using bun:test framework. Import { test, expect, describe } from 'bun:test' and import { NoteStore } from './note-store'. Create a describe('NoteStore') block with these 5 test cases:

1. 'create returns a complete Note': Instantiate NoteStore, call create('Test Title'), verify returned Note has id (string), title='Test Title', done=false, created_at (number). Verify stored note via get() matches.

2. 'empty title throws': Instantiate NoteStore, call create('') and expect Error to be thrown. Also test create('   ') (whitespace only) throws after trimming.

3. 'list preserves creation order': Create 3 notes with different titles, call list(), verify array length is 3, verify notes are sorted by created_at ascending (oldest first), verify order matches creation sequence.

4. 'toggle flips done': Create a note, verify done=false, call toggle(note.id), verify returned note has done=true, verify get(note.id).done=true, toggle again, verify done=false.

5. 'remove deletes successfully and get returns undefined': Create a note, verify get returns it, call remove(note.id) and expect true, verify get(note.id) returns undefined, call remove('nonexistent') and expect false.

All tests must pass when running 'bun test ./src/note-store.test.ts'.
Done Definition: src/note-store.test.ts exists with 5 passing tests covering create, empty title validation, list ordering, toggle, and remove functionality as verified by running bun test ./src/note-store.test.ts
Owned Paths: src/note-store.test.ts
Priority: blocking
Kind: verification
Imports: class NoteStore (from goal_notestore_impl)

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
