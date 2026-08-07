# Multica remote MCP import

## Recall

### User requirement

The user requires a reliable implementation of Multica MCP import rather than a speculative explanation. A successful Multica Squad import must preserve MCP capability when the source configuration is safely portable; unsupported or secret-bearing configurations must fail visibly instead of being silently discarded.

### Acceptance criteria

1. Parse Multica's Claude-compatible `mcpServers` object with one strict source contract. Do not treat `mcp_config` as opaque presence metadata.
2. Import only remote MCP definitions whose transport and endpoint are explicit and whose configuration contains no embedded credentials, command execution, environment, dynamic header helper, user info, query token, or fragment.
3. Before preview succeeds, connect to every portable MCP endpoint through OpenCorvus's existing MCP client, enumerate all paginated tools, prompts, and resources, and preserve their exact names as the package declaration.
4. Include discovered MCP capabilities in the immutable source digest. Import refetches Multica and re-inspects MCP, so configuration or capability drift rejects before any project write.
5. Generate one agent-owned `agents/<agent>/mcp/*.jsonc` declaration per imported source server and project it through that agent's `package_mcp_server_refs`. Validate through `ExpertSquadRegistry`, install only through `ExpertSquadPackageManager`, and leave the package inactive.
6. `mcp_config_redacted`, local `stdio`, static headers, OAuth material, malformed/unknown configuration, unsafe URLs, failed authentication/connection, pagination defects, duplicate capability names, and empty capability sets are explicit preview blockers. No MCP entry is silently omitted.
7. Generated packages contain no Multica personal access token or MCP credential material. Preview/reporting exposes server identity and discovered capability names but never source secret values.
8. Focused tests prove strict success, projection through Registry/Resolver, pagination, capability/config drift, and zero-write rejection paths.

### Hard constraints

- No fallback, compatibility alias, name guessing, capability sanitization, partial MCP import, secret copying, automatic activation, second active Squad field, or second MCP runtime.
- `PromptProfileResolver` remains the sole runtime projection owner. `ExpertSquadRegistry` remains the package MCP schema authority.
- Package MCP remains remote-only. This task does not weaken the existing rejection of package-owned local processes.
- Existing unrelated dirty-worktree changes are user-owned and must not be reset, overwritten, staged, or committed.
- No running OpenCorvus or Overlay process may be restarted, refreshed, stopped, or used as a mutable test target.

### Sources read before implementation

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-14-multica-expert-squad-import.md`
- `specs/records/2026-07/2026-07-15-multica-import-agent-responsibility-and-installed-skill-action.md`
- `specs/records/2026-07/2026-07-15-multica-mission-multi-squad-parallel-import.md`
- `opencorvus-expert-squad-creator` Skill and its complete checklist
- Multica official issue and merged PR: `multica-ai/multica#1111` and `#1168`
- Multica current `server/internal/handler/agent.go` and draft secret-redaction contract `#2387`
- Claude Code official MCP configuration documentation
- MCP specification 2025-03-26 transport, tools, prompts, and resources chapters

### Whole-repository search evidence

- `rg -n --hidden -S "mcp_config|mcp_config_redacted|McpDefinition|package_mcp_server_refs|default_mcp_server_refs|mcpServers|multica_preview|MulticaPreview|MulticaAgent" packages specs`
- `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad.jsonc|prompt_profile.active|active_skill_projection|capability_projection" packages specs`
- `rg -n "loadEmbeddedPackage|loadPackage|loadSourcePackage|importDirectory|importArchive|exportArchive|payload|seed|release" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "scopedTool|scopedPrompt|scopedResource|listTools|listPrompts|listResources|createRemoteTransport" packages/opencorvus/src/mcp packages/opencorvus/test/mcp`
- Current call points inspected directly: Multica adapter, Orchestrator tools, expert-squad REST routes, Registry MCP definition, Resolver package MCP materialization, MCP scoped client, and focused adapter/Registry/Resolver/route tests.

### Independent-agent feedback

No new sub-agent was used. The user did not request delegation. Earlier read-only Multica audits established the existing strict adapter/Registry/Manager path; the primary Agent owns this implementation and second review.

## Root cause

The source agent schema currently accepts `mcp_config` as `unknown`, preview reduces it to `mcp_config=present`, generated projections leave every MCP reference empty, and the generated README declares all MCP state non-portable. OpenCorvus itself already has a remote package MCP declaration, scoped client lifecycle, and Resolver projection path. The missing layer is a strict Multica-to-package conversion plus capability discovery; MCP protocol incompatibility is not the cause.

## Single implementation contract

`MulticaExpertSquadImport` parses and classifies the source configuration, delegates remote capability inspection to the existing scoped MCP client, incorporates the resulting immutable capability inventory into preview/digest/package generation, and uses the existing Registry/Manager/Resolver chain. Unsupported source entries contribute blockers, so package generation remains all-or-nothing.

This record supersedes only the earlier assumption that every Multica MCP configuration is non-portable. It does not supersede the remote-only package boundary, secret-redaction boundary, exact Squad identity rules, or Mission-owned multi-Squad dispatch design.

## Call-point disposition

| Call point                                                     | Disposition                                                                                                                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/mcp/index.ts`                         | Add one scoped, paginated, read-only capability inspection operation using the existing connection/timeout/cleanup path.                                                     |
| `packages/opencorvus/src/expert-squad/multica-import.ts`       | Replace opaque MCP presence handling with strict parsing, portability/security classification, discovery evidence, digest binding, package files, and agent projection refs. |
| `packages/opencorvus/src/orchestrator/multica-import-tools.ts` | Bind preview to the current project directory needed by scoped MCP inspection; retain the existing three-tool surface.                                                       |
| `packages/opencorvus/src/server/routes/expert-squad.ts`        | Bind preview to `Instance.directory`; request bodies still cannot choose a path.                                                                                             |
| Registry/Manager/Resolver                                      | Retain schemas and runtime ownership; exercise them through generated package tests.                                                                                         |
| Multica Skill and generated payload                            | Update the canonical instructions to review MCP evidence/blockers; regenerate from the single Skill source.                                                                  |
| Focused tests and generated API surfaces                       | Add exact success/rejection/drift coverage and regenerate only canonical derived outputs required by the changed response schema.                                            |

## Verification plan

1. MCP scoped-inspection tests cover pagination, tools/prompts/resources, timeout/error handling, and connection cleanup.
2. Multica adapter tests cover public remote MCP import, agent-owned projection, Registry/Resolver availability, redaction, local process, credentials, malformed config, unreachable endpoint, and capability drift with zero writes.
3. Multica Orchestrator tool and REST route tests prove exact project-directory binding.
4. Run focused Registry/Manager/Resolver and built-in Skill freshness tests, OpenCorvus typecheck, generated API checks, historical/document health tests, and `git diff --check`.
5. Perform a separate final diff/security review before a scoped `dsw-33987` commit and `legacy-remote` push.

## Verification results

- `bun test packages/opencorvus/test/expert-squad/multica-import.test.ts`: 18 passed; includes real Streamable HTTP discovery, full pagination, Registry/Resolver projection, redacted/local/credential/malformed/unreachable rejection, capability drift, repeated cursor, duplicate capability, and zero-write blockers.
- Isolated REST case `Multica catalog, preview, and import routes keep project ownership and strict bodies`: 1 passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/skill/multica-import-skill.test.ts packages/opencorvus/test/expert-squad/multica-import.test.ts`: 40 passed after the final duplicate-capability addition is included in the focused suite count.
- `bun run typecheck`: 10 workspace packages passed.
- `bun run api:routes-check`: generated/tracked OpenAPI and SDK route inventory passed after canonical SDK generation.
- `bun run docs:check`: 255 operations across 24 groups passed.
- `git diff --check`: passed before final staging review.
