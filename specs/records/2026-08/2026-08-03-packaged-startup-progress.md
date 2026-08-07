# Packaged Startup Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the desktop client immediately and present accurate sidecar extraction and backend-readiness progress until the main application is available.

**Architecture:** The existing bundled `index.html` becomes the single startup surface and listens for a typed Tauri startup event before the Solid application replaces it. The Rust host publishes phase and byte-count updates while its managed sidecar runs on a background thread, exposes retry and log-opening commands, and navigates to the normal app only after `/health` confirms readiness.

**Tech Stack:** Tauri 2 / Rust, embedded `tar.gz` sidecar payload, vanilla bootstrap HTML/CSS/JavaScript, existing Solid/Vite application.

## Global Constraints

- Desktop-only startup delivery; do not add responsive or mobile scope.
- Use one main Tauri window and one startup surface; do not introduce an iframe, synthetic message path, timer-based readiness, fallback startup route, or state-machine workflow.
- Progress must derive from actual extraction bytes and explicit backend readiness, not simulated time.
- The Loading page must provide retry and open-the-current-log actions on failure.
- Do not add, modify, or run UI automated tests. Validate UI through a real packaged client, manual interaction, screenshots, and second visual review.
- Add positive Rust contract tests for non-UI startup event payloads and sidecar readiness behavior.
- Preserve unrelated working-tree changes.

## Recall

| Item | Evidence |
| --- | --- |
| User request | Do not wait for extraction before opening the client; show an “extract and wait for backend” Loading page with a progress bar, retry, and log viewing on failure. |
| Acceptance criteria | The native window is visible before extraction completes; the loading surface displays real phase/progress; backend readiness transitions to the main client; failures permit retry and log opening. |
| Root cause | The packaged payload is embedded and synchronously unpacked by `ensure_embedded_server_path()` before `setup()` returns, while the main window remains hidden until `PageLoadEvent::Finished`. The Windows payload currently has 14,434 files / 521,940,128 bytes. |
| Hard constraints | Existing content-addressed payload lifecycle and leases remain canonical; no gate/fallback path; no UI test creation or execution; visual acceptance is manual on a real packaged client. |
| Sources read | `AGENTS.md`, `docs/packaging.md`, `packages/overlay/src-tauri/build.rs`, `packages/overlay/src-tauri/src/main.rs`, `packages/overlay/src/index.html`, `packages/overlay/src/services/tauri-transport.ts`, `specs/records/2026-07/2026-07-31-native-first-frame-window-reveal.md`, and `specs/records/2026-07/2026-07-21-sidecar-upgrade-startup-lease-boundary-repair.md`. |
| Whole-repository search | `rg` enumerated every embedded-payload, extraction, server-start, `show_window`, page-load, Tauri event, and native open-path call site. `start_server()` is the only runtime path that resolves the embedded payload; `overlay_open_path` is the existing native file-opening contract. |
| Independent agent feedback | None. The user did not request delegation and the active collaboration policy prohibits implicit subagent delegation. |

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/overlay/src-tauri/src/main.rs` | Startup event type and emitter, byte-progress payload extraction, asynchronous managed-server startup, `/health` readiness probe, retry/log commands, and positive Rust contracts. |
| `packages/overlay/src/index.html` | Initial visible startup page, event subscription, true progress rendering, failure actions, and transition to the Vite/Solid entrypoint. |
| `packages/overlay/src-tauri/tauri.conf.json` | Retain hidden construction but allow the completed bootstrap page to reveal immediately; no second window. |
| `specs/records/2026-08/README.md`, `specs/README.md` | Index this implementation record. |

## Call-site Disposition

| Surface | Disposition |
| --- | --- |
| `unpack_embedded_payload` | Replace archive-wide unpack with entry-by-entry extraction that emits cumulative actual payload bytes. |
| `ensure_embedded_server_path` | Keep content-addressed validation/publication/lease semantics; accept a progress reporter so only newly extracted payloads emit extraction progress. |
| `start_server` / `restart_server` | Retain ownership and process spawning; call from a background worker for initial startup and report server phases. |
| `setup` initial startup | Reveal the native window after the bootstrap page is loaded, then dispatch the background startup worker; do not synchronously block setup. |
| `index.html` initial surface | Replace spinner-only copy with a determinate progress bar and failure controls, then load `main.tsx` only after host emits ready. |
| `overlay_open_path` | Reuse as the one native file-open path for the current diagnostic or sidecar log. |

## Implementation Tasks

### Task 1: Define and test the non-UI startup progress contract

**Files:**

- Modify: `packages/overlay/src-tauri/src/main.rs`

**Interfaces:**

- Produces `StartupProgress { phase, completed_bytes, total_bytes, message, log_path }` serialized to `overlay:startup-progress`.

- [ ] Write Rust tests that assert a newly constructed extraction event has a non-empty extraction phase and total bytes, and a ready event reports completed bytes equal to total bytes.
- [ ] Run the focused Rust test and confirm it fails because the type/event constructors do not yet exist.
- [ ] Implement the serialized startup progress type and constructors; use one typed host event name shared by the worker and bootstrap page.
- [ ] Re-run the focused Rust test and confirm it passes.

### Task 2: Publish actual extraction and server-readiness progress without blocking the window

**Files:**

- Modify: `packages/overlay/src-tauri/src/main.rs`

**Interfaces:**

- Consumes `StartupProgress` from Task 1.
- Produces background initial-start and retry work that emits extraction, backend-starting, backend-ready, and failed facts, plus `overlay_startup_retry` and `overlay_startup_open_log`.

- [ ] Write a Rust test for the extracted-byte accumulator that verifies a sequence of actual archive-entry sizes produces the exact cumulative byte counts and final total.
- [ ] Run the focused test and confirm it fails before the accumulator exists.
- [ ] Replace `Archive::unpack` with archive-entry extraction that records the on-disk payload byte total and emits after each file is persisted; preserve atomic temporary-dir publication, completion verification, marker sync, and leases.
- [ ] Add a bounded `/health` probe after spawning the sidecar; emit ready only after a successful HTTP health response, or emit failure with the log path.
- [ ] Change initial setup to show the loaded bootstrap surface and spawn the managed-server work on a thread; route retry through the same worker and reuse `overlay_open_path` for the reported log file.
- [ ] Re-run the focused Rust tests and `cargo fmt --check`.

### Task 3: Render determinate startup, retry, and log controls

**Files:**

- Modify: `packages/overlay/src/index.html`

**Interfaces:**

- Consumes `overlay:startup-progress` from the Tauri event API and the two startup commands from Task 1.
- Loads `/main.tsx` only after receiving the backend-ready event.

- [ ] Replace the spinner-only startup markup with phase text, a semantic progress element, percent text, and initially hidden retry/log actions.
- [ ] Add small inline bootstrap JavaScript that subscribes before Solid is loaded, updates only from the emitted progress payload, invokes retry/open-log actions on user clicks, and appends the main module only after ready.
- [ ] Add accessible labels and reduced-motion-safe styling; keep the current main-surface visual language.
- [ ] Do not add or run a UI test. Build and launch the real packaged client, manually trigger cold start and failure/retry where safe, and capture screenshots for visual review.

### Task 4: Package, verify, review, and document

**Files:**

- Modify: this record, `specs/records/2026-08/README.md`, `specs/README.md`

- [ ] Update this record’s verification ledger with actual commands, startup evidence, screenshot locations, and unresolved facts if any.
- [ ] Run targeted Rust startup-contract tests, `cargo fmt --check`, Overlay typecheck/build, `git diff --check`, and all three required document-health tests.
- [ ] Build the Windows GUI installer/package and perform a real cold launch after clearing only the test installation’s payload directory; manually inspect the immediate Loading page, determinate extraction progress, ready transition, and a second warm launch.
- [ ] Perform a second manual screenshot review of the Loading surface and normal client handoff.
- [ ] Commit only task-owned files with a `dsw-33987` subject and push the active main delivery branch to `legacy-remote` without bypassing hooks.

## Verification Ledger

### Planning-boundary correction — 2026-08-03

The originally approved plan placed `overlay_startup_retry` and
`overlay_startup_open_log` both in Task 1's interface block and in Task 2's
implementation scope. A Task 1 review correctly identified that contradiction.
The user confirmed that Task 1 owns only the progress-event data contract and
Task 2 owns the complete background-start/retry/log command surface. This
record now reflects that single boundary.

Task 1 implementation commit: `9cd73f5e4b`.
