# Remove Private Gateway Built-ins

## Scope

User request: delete built-in private gateway code, documentation, and traces.

Repository recall found the private gateway was introduced as source-pinned hardcoded providers, with historical specs recording the private endpoint as evidence for image transport work. Those entries are now removed instead of kept as an empty hardcoded provider table.

## Call Point Inventory

| Reference                                                                   | Decision                                                                                                                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider source module for hardcoded test providers                         | Delete the module. The only remaining entries are private gateway providers.                                                                                        |
| `packages/opencorvus/src/provider/provider.ts`                              | Remove the hardcoded provider merge path and source tagging. `config.provider` remains the only source for custom same-name providers.                              |
| `packages/opencorvus/test/provider/provider.test.ts`                        | Replace built-in availability/override/disable expectations with assertions that the retired IDs are not auto-registered and that explicit user config still works. |
| Test file for hardcoded test provider table                                 | Delete the test because the module no longer exists.                                                                                                                |
| Live integration test for the removed private gateway                       | Delete the private-gateway-only test. It depends on the removed private gateway.                                                                                    |
| Historical image-transport spec                                             | Delete the historical spec because it embeds private gateway endpoints, credentials, and acceptance criteria.                                                       |
| Historical image-transport implementation brief                             | Delete the implementation brief for the same private-gateway-specific work.                                                                                         |
| Retired external note specs/records/2026-06/2026-06-04-remove-iwc-aime-provider.md | Delete the stale provider-removal spec because it references the deleted hardcoded-provider module.                                                                 |
| `packages/opencorvus/src/provider/transform.ts`                             | Remove private-gateway-specific explanatory wording while preserving the data URL behavior.                                                                         |
| `packages/opencorvus/script/mission-e2e.ts` and later benchmark specs       | Leave as task/model history unless they directly describe the built-in private gateway.                                                                             |
| `packages/opencorvus/src/provider/models-snapshot.ts`                       | Leave generated upstream model names such as public Kimi models; they are not the private built-in gateway.                                                         |

## Verification

- `bun test packages/opencorvus/test/provider/provider.test.ts`
- `rg` over source/docs/specs/tests for private gateway endpoints, tokens, removed module names, and built-in provider identifiers.
