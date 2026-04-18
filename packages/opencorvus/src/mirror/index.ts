/**
 * Mirror barrel — re-exports the IR schemas, shared utilities, and typed
 * errors. Deliberately zero side effects: no tool registration, no agent
 * wiring, no config mutations.
 *
 * Consumers (Phase 2 tool shims / skills / smoke scripts) import from here;
 * internal modules import directly from their neighbour (`./shared/...`,
 * `./ir/...`) to keep dependency direction explicit.
 */
export * as Shared from "./shared"
export * as IR from "./ir"
export * from "./errors"
