# Hexin Kimi K2.6 Image Capability

## Evidence

- The generated model snapshot already lists `kimi-k2.6`, `moonshotai/kimi-k2.6`, and `kimi/kimi-k2.6` as image-capable models.
- `hexin-discovery.ts` projects `profile.image_in` directly into `Provider.Model.capabilities.input.image`.
- `agent/runner.ts` filters image file parts when `capabilities.input.image` is false and adds a visible marker telling the model it cannot see image bytes.

## Decision

`hexin/kimi-k2.6` must be marked as accepting image attachments in the Hexin profile. This is a profile data fix, not a runner behavior change.

Keep PDF disabled for this Hexin profile until the exact Hexin route is verified for PDF input. The user-reported failure is image-specific.

## Validation

- Unit test `hexin-profiles.test.ts` must assert `attachment: true` and `image_in: true` for `kimi-k2.6`.
- Discovery test must assert `Provider.Model.capabilities.attachment` and `capabilities.input.image` are true for `kimi-k2.6`.
