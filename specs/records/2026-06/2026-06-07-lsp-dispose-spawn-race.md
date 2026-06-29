# LSP dispose/spawn race fix

## Evidence

- Live Windows process tree showed repeated `opencorvus-process-supervisor.exe -> bash -> bun x typescript-language-server --stdio -> node cli.mjs -> tsserver.js` chains.
- Recent supervisor request files under `%TEMP%\opencorvus-supervisor-*` point at task goal worktrees for `tsk_e9e385cad001`, including `gol_e9e804c3d003`, `gol_e9e804c3d006`, `gol_e9e804c3d007`, `gol_e9e804c3d008`, and `gol_e9e804c3d021`.
- `read.ts`, `write.ts`, `edit.ts`, `apply_patch.ts`, and the explicit `lsp` tool can call `LSP.touchFile`.
- `read.ts` intentionally does not await `LSP.touchFile(filepath, false)`, so LSP spawn can overlap with worktree cleanup.
- `Instance.dispose()` calls `State.dispose()`, and the current LSP dispose callback only shuts down `state.clients`.
- In-flight `state.spawning` promises are not awaited by disposal. A client created after the clients snapshot can survive disposal and keep the supervised TypeScript server process tree alive.

## Fix

`LSP` instance state owns both registered clients and in-flight spawns. Disposal marks the state disposed, waits for all in-flight spawns to settle, shuts down any client produced by those spawns, clears the spawning map, and prevents newly-created clients from being added after disposal starts.

This directly removes the orphan source. It does not add memory gates, restart thresholds, or process-kill policy outside the existing LSP ownership path.
