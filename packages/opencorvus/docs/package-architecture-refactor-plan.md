# Package Architecture Refactor Plan

Status: in_progress

This document defines the package-level cleanup plan for `packages/opencorvus`.

The goal is not "rename files until they look nicer". The goal is a codebase that is:
- structurally legible
- package-bounded
- consistently named
- free of dead compatibility layers
- testable without hidden path or naming conventions

## Non-Negotiable Rules

1. A directory owns one runtime concern.
2. File names describe the module's primary responsibility, not its call site.
3. Public names use one vocabulary only; no mixed variants such as `Adaptor` and `Adapter`.
4. Compatibility layers must be explicitly scoped and temporary.
5. Synthetic fallback behavior is not allowed in correctness-critical paths.
6. Stale files must be deleted, not kept "just in case".

## Current Structural Problems

### Naming drift

- Mixed vocabulary:
  - `adaptors` vs `adapters`
  - `compat` used as a catch-all name instead of a bounded legacy bridge
  - `experimental-*` route files mixed into stable route namespaces
- Generic filenames:
  - many `index.ts` files that hide the actual responsibility
  - files named by implementation detail instead of domain responsibility

### Path drift

- Control-plane, orchestrator, session, server, and channel concerns are split correctly at a high level, but some subpaths still expose implementation history instead of package boundaries.
- Route helper modules and live-event glue are mixed with route definitions.

### Dead or aging compatibility surfaces

- Residual "compat" naming where the code is no longer a temporary bridge.
- Remaining non-control-plane `Bus` usage that is still broad and easy to overreach.
- "experimental" route files that now function as durable product surfaces.

### Package health risks

- Inconsistent names make refactors harder to grep safely.
- Directory meaning is not always obvious to new contributors.
- Hidden boundary crossings encourage more ad-hoc imports.

## Target Package Shape

`src/` should converge toward these package classes:

- `runtime/`
  - process startup and global runtime wiring only
- `protocol/`
  - durable event/inbox/stream primitives
- `orchestrator/`
  - task/run/interaction state machine and actors
- `session/`
  - conversational runtime only
- `server/`
  - HTTP transport only
- `channel/`
  - external messaging/channel integration only
- `executor/`
  - executor abstraction and provider implementations
- `storage/`
  - database client, schema, DDL, migration only
- `util/`
  - small reusable primitives, no domain state

## Naming Rules

### Directories

- Use lowercase kebab-case for directories only when the package name is already established by routing or protocol shape.
- Prefer single clear nouns: `adapter`, `protocol`, `runtime`, `storage`, `server`.
- Avoid plural aliases unless the directory contains interchangeable implementations by design.

### Files

- Use lowercase kebab-case for multi-word filenames.
- Avoid bare `index.ts` except as a deliberate package entrypoint.
- Avoid vague names such as `compat.ts`, `shared.ts`, `helper.ts` unless the module is genuinely a boundary or shared contract.

### Types and functions

- Prefer one canonical noun:
  - `Adapter`, not `Adaptor`
  - `Provider`, not `CompatProvider`
  - `Route`, not `ExperimentalRoute` once it is productized
- Constructors and factories must describe ownership:
  - `getAdapter`
  - `createRunActor`
  - `appendEvent`
  - `subscribeEvents`

## Stale File Policy

Delete a file when all three are true:
- no production imports remain
- no test imports remain
- its behavior is covered by a current module or explicitly dropped

Do not keep:
- old schema wrappers after storage cutover
- route fallbacks after durable protocol cutover
- alternate names that only preserve historical spelling

## Refactor Phases

### Phase A: Naming and Path Hygiene

Status: complete

- [x] Document package-level naming and boundary rules
- [x] Remove spelling drift in package/module names
- [x] Replace misleading compatibility names with bounded domain names
- [x] Consolidate route helper files into explicit subpackages where appropriate

Completed in this phase:
- `control-plane/adaptors` renamed to `control-plane/adapters`
- `Adaptor/getAdaptor/WorktreeAdaptor` renamed to `Adapter/getAdapter/WorktreeAdapter`
- `executor/compat.ts` renamed to `executor/contracts.ts`
- experimental route modules moved under `server/routes/experimental/`
- session management route modules moved under `server/routes/session-management/`

### Phase B: Boundary Tightening

Status: pending

- [ ] Make `server/routes` transport-only
- [ ] Move route-only event helper code under route-local subpackages
- [ ] Reduce cross-package imports from `server -> session/orchestrator/channel`

### Phase C: Legacy Surface Removal

Status: in_progress

- [x] Rename or delete misleading `compat` modules that are no longer temporary
- [x] Review `experimental-*` routes and either delete, stabilize, or move them
- [ ] Delete obsolete files made redundant by Protocol V2 and actor runtime

### Phase D: Final Package Health Gate

Status: pending

- [ ] No known dead files in active packages
- [ ] No mixed naming vocabularies for the same concept
- [ ] No control-plane correctness depending on `Bus`
- [ ] Path layout matches domain boundaries
- [ ] Focused regression suites pass after each rename batch

## Acceptance Gates

The refactored package layout is considered healthy only if:
- naming is internally consistent
- package boundaries are grep-able and predictable
- stale files are removed rather than shadow-retained
- route files no longer carry protocol or runtime fallback baggage
- every rename batch is covered by focused tests

This plan targets a verifiably healthy package architecture. It does not claim infallibility; health is proven by boundary clarity, deletion of stale paths, and passing regression gates.
