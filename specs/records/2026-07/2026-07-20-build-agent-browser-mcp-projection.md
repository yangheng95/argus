# Build Agent Browser MCP Projection

## Recall

### User request

The user confirmed that the build agent must also support the built-in Browser MCP (Model Context Protocol, 模型上下文协议).

### Acceptance criteria

- Every repository-authored dynamic Agent whose manifest projection declares `base_role: "build"` explicitly receives the canonical built-in Browser MCP tool set.
- The Browser MCP runtime remains core-owned; Expert Squad manifests remain the sole Agent-grant source.
- Non-build sibling Agents do not gain Browser MCP unless their own manifest projection already grants it.
- Tests exercise the real `PromptProfileResolver` projection and compare against `BrowserMCPBuiltin.ImportableToolRefs`.

### Hard constraints

- Do not add host-side role inference, fallback, compatibility logic, a gate, or a second capability source.
- Preserve explicit per-Agent Expert Squad capability projection.
- Update the generated Expert Squad payload from repository authoring sources before delivery.
- Commit subjects must start with `dsw-33987`; push the completed change to `legacy-remote/v0.0.12beta` without bypassing hooks.

### Read records

- `specs/current/architecture/04-extensions.md`: Browser MCP is core-owned, while the active Expert Squad projection determines which tools an Agent receives.
- `specs/records/2026-07/2026-07-20-multica-import-repair-dialog.md`: approved browser automation declarations converge on the existing Browser MCP projection rather than package-local browser servers.

### Full-repository grep result

`rg` over every repository Expert Squad manifest found four `base_role: "build"` projections:

| Projection | Current Browser MCP grant | Action |
| --- | --- | --- |
| `general/implementation-engineer` | Empty | Replace the empty `default_mcp_tool_refs` with the canonical importable Browser MCP refs. |
| `frontend-replica/frontend-replica-implementer` | Complete | Preserve. |
| `frontend-innovate/frontend-innovate-implementer` | Complete | Preserve. |
| `opentest/opentest-test-implementer` | Empty | Replace the empty `default_mcp_tool_refs` with the canonical importable Browser MCP refs. |

The same grep found existing non-build Browser MCP owners: General `interface-investigator` and `visual-reviewer`, both frontend visual reviewers, and `opentest-visual-reviewer`. These grants remain unchanged.

Relevant runtime/test call sites:

| Call site | Decision |
| --- | --- |
| `packages/opencorvus/src/config/config.ts::materializeBuiltinMcp` | Preserve the core-owned default server registration. |
| `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts::resolveWorkerCapability` | Preserve exact manifest-driven resolution; do not infer grants from `base_role`. |
| `packages/opencorvus/test/expert-squad/repository-dynamic-agent-packages.test.ts` | Expand real resolver assertions to both newly granted build Agents and retain negative sibling assertions. |
| `packages/opencorvus/test/expert-squad/general-package.test.ts` | Preserve General package identity/dispatch coverage; use the resolver-focused test for exact MCP grants. |

### Independent Agent feedback

None. The user did not request independent agents or parallel audit, so no sub-Agent was delegated.

## Implementation

1. Project `BrowserMCPBuiltin.ImportableToolRefs` through the two missing build Agent manifest declarations.
2. Update resolver regression coverage so every build owner and existing rendered-evidence owner receives the exact canonical list, while representative non-build siblings remain empty.
3. Regenerate the bundled Expert Squad payload from repository sources.

## Verification

- Run the focused real-resolver Browser MCP projection test.
- Run General and MirrorTest package tests affected by manifest projection changes.
- Run Expert Squad payload generation/checks required by the repository scripts.
- Run `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` plus applicable document-health tests.
- Run typecheck and pre-push hooks, then review the final diff before commit and push.

## Result

- General `implementation-engineer` and MirrorTest `opentest-test-implementer` now explicitly project the same 17 Browser MCP tools as the existing frontend build Agents.
- The resolver regression dynamically enumerates all repository-authored `base_role: "build"` declarations, asserts the four expected build identities, and validates their exact canonical tool projection together with existing rendered-evidence owners.
- Representative non-build siblings remain explicitly empty, proving that the capability does not leak through the base-role runtime.
- The generated Expert Squad payload was regenerated from repository authoring sources.
