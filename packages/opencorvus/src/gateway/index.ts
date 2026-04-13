/**
 * Gateway namespace — public surface for the daemon-layer dialog dispatcher.
 *
 * Phase 2 exports the agent + tooling so callers (Phase 5 ChannelIngress, the
 * overlay HTTP route, integration tests) can drive `handleMessage` without
 * touching internals. The notifier remains intentionally inert until Phase 4.
 */

export { Gateway } from "./agent"
export { ensureGatewaySession } from "./session"
export { createGatewayTools } from "./tools"
export { readCwd, writeCwd } from "./cwd-state"
export { subscribe as subscribeGatewayNotifier } from "./notifier"
