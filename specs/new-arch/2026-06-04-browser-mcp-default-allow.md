# Browser MCP Default-Allow Permission Plan

- Date: 2026-06-04
- Status: Implemented in this change

## Request

Set MCP permissions to be enabled by default.

## Evidence Sweep

| Surface                                                           | Evidence                                                                                                                                                            | Decision                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/opencorvus/src/mcp/browser/permission-plan.ts`          | `BROWSER_MCP_PERMISSION_BASELINE` sets browser MCP permissions; most entries were `ask`.                                                                            | Change every baseline browser MCP permission to `allow`.                          |
| `packages/opencorvus/src/session/loop.ts`                         | Browser MCP tools call `PermissionNext.ask()` with `PermissionNext.merge(BROWSER_MCP_PERMISSION_BASELINE, input.agent.permission, input.session.permission ?? [])`. | Keep merge order so explicit agent/session `ask` or `deny` remains authoritative. |
| `packages/opencorvus/src/permission/next.ts`                      | `evaluate()` uses `findLast`; unmatched permissions already default to `allow`.                                                                                     | No permission engine change needed.                                               |
| `packages/opencorvus/test/session/browser-mcp-permission.test.ts` | Tests covered permission plan metadata but not baseline action resolution.                                                                                          | Add assertions for default allow plus explicit override behavior.                 |
| `docs/product/*/opencorvus/permissions.md`                        | Default-allow documentation only mentioned built-in agent tools.                                                                                                    | Document browser MCP default allow.                                               |
| `specs/new-arch/2026-05-29-browser-mcp-runtime.md`                | Historical draft still said browser MCP sensitive categories ask by default.                                                                                        | Update the permission policy section to the current default-allow decision.       |

## Implementation

Use the existing permission ruleset as the single source. Do not add host-side gates, bypasses, or route-specific decision logic.
