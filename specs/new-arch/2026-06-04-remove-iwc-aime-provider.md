# Remove iwc-aime Built-in Provider

## Scope

User request: delete the `iwc-aime` interface.

Repository search shows `iwc-aime` is not an HTTP route. It is a built-in test provider entry in `packages/opencorvus/src/provider/builtin-test-providers.ts` plus tests/spec references.

## Call Point Inventory

| Reference | Decision |
| --- | --- |
| `packages/opencorvus/src/provider/builtin-test-providers.ts` | Delete the `iwc-aime` provider entry and remove IWC/AIME abbreviation comments. |
| `packages/opencorvus/test/provider/provider.test.ts` parse-model invalid reference case | Replace `iwc-aime/` with another provider-shaped invalid reference so parser coverage remains. |
| `packages/opencorvus/test/provider/provider.test.ts` built-in provider availability case | Update expectations from three built-ins to `glm51` and `kimik26`; assert `iwc-aime` is absent. |
| `packages/opencorvus/test/provider/provider.test.ts` same-name override case | Update sibling assertion to only `kimik26`. |
| `packages/opencorvus/test/provider/provider.test.ts` disabled built-in case | Update sibling assertion to only `glm51` and assert `iwc-aime` remains absent. |
| `packages/opencorvus/test/provider/builtin-test-providers.test.ts` | Keep existing kimik26 capability coverage; add absence assertion for retired `iwc-aime`. |
| `specs/new-arch/2026-05-23-image-attachment-transport-and-capability.md` | Remove `iwc-aime` from the historical planned integration gateway list. |
| `glm-5.1-fp8` stale references found after the first pass | Replace parser/config test examples with a neutral bare model name and remove the obsolete drift row from the historical spec. |

## Verification

Run the provider test files touched by this change:

- `bun test packages/opencorvus/test/provider/provider.test.ts packages/opencorvus/test/provider/builtin-test-providers.test.ts`
