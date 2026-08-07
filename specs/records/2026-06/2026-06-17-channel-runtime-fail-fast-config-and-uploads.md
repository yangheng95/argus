# Channel Runtime Fail Fast Config And Uploads

## Problem

Channel runtime still had several quiet fallback paths. Invalid queue limits
were converted back to defaults, malformed config content became an empty config,
unknown permission profiles became `standard`, and URL-upload channels silently
retried through binary uploads after `uploadImageUrl` failed. Those behaviors
hide operator mistakes and make channel delivery failures hard to diagnose.

## Call Points

| Surface                    | File                                                                             | Decision                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Queue limit parsing        | `packages/channel-runtime/src/channel-policy.ts`                                 | Keep the default only when the env var is absent; reject malformed configured values.                       |
| Queue limit consumer       | `packages/channel-runtime/src/core.ts`                                           | Continue reading the single `queueLimit()` helper from the channel runtime loop.                            |
| Runtime config parsing     | `packages/channel-runtime/src/runtime-config.ts`                                 | Reject malformed `OPENCORVUS_CONFIG_CONTENT` instead of substituting `{}`.                                  |
| Permission profile parsing | `packages/channel-runtime/src/permission-profile.ts`                             | Return the explicit profile or throw for unknown values; no invalid-profile state object.                   |
| Runtime bootstrap          | `packages/channel-runtime/src/main.ts`                                           | Log the selected explicit profile from `resolveRuntimeConfig`.                                              |
| URL attachment upload      | `packages/channel-runtime/src/core.ts`                                           | If an adapter owns `uploadImageUrl`, publish and upload by URL only; propagate URL upload errors.           |
| URL-capable adapters       | `packages/channel-runtime/src/adapters/{dingtalk,googlechat,line,msteams,qq}.ts` | Keep adapter-specific URL upload implementations as the single URL delivery path.                           |
| Tests                      | `packages/channel-runtime/test/*.test.ts`                                        | Assert invalid config/profile/limit values throw and URL upload failures do not fall back to binary upload. |

## Implementation

1. Keep defaults only for absent optional configuration.
2. Throw on configured invalid values so startup or message delivery fails at
   the real cause.
3. Remove the URL-upload catch block; binary upload remains only for adapters
   that do not implement `uploadImageUrl`.
4. Make test fetch mocks implement Bun's full `fetch` shape, including
   `preconnect`, so typecheck validates the real global contract.

## Verification

- `bun run --cwd packages/channel-runtime typecheck`
- `bun test packages/channel-runtime/test/core-channel-protocol.test.ts packages/channel-runtime/test/channel-policy.test.ts packages/channel-runtime/test/runtime-config.test.ts packages/channel-runtime/test/permission-profile.test.ts`
- `bun run check:sdk-imports`
- `bunx turbo run typecheck`
