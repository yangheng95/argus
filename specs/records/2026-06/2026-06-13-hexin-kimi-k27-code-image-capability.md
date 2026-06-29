# Hexin Kimi K2.7 Code Image Capability

## Evidence

- Runtime provider output on 7878 exposed `hexin/kimi-k2.7-code` with
  `attachment: false` and `input.image: false`.
- Direct Hexin OpenAI-compatible API probe on 2026-06-13 accepted a
  `data:image/png;base64,...` image payload for `model: "kimi-k2.7-code"` and
  returned `content: "red"` for a red 32x32 PNG.
- The same probe showed `temperature` must be `1` for this model.
- The response carried `reasoning_content`, so it needs the same interleaved
  reasoning contract used by other Moonshot thinking models.
- `agent/runner.ts` filters image file parts when
  `model.capabilities.input.image` is false and appends a visible marker saying
  the model cannot see the file bytes. Therefore the wrong capability label
  directly prevents image reading in normal agent runs.

## Decision

Add an exact Hexin profile for `kimi-k2.7-code`.

- Mark image attachments as accepted.
- Keep PDF disabled until the exact Hexin route is separately verified for PDF.
- Use fixed sampling by marking `temperature: false`, which routes requests
  through the existing Hexin Moonshot temperature normalization.
- Preserve `reasoning_content` via the existing interleaved reasoning profile
  contract.

This is a profile-data correction. It does not add a fallback path or change
runner attachment filtering.

## Validation

- Profile unit test asserts Kimi K2.7 Code image, sampling, reasoning, and
  interleaved reasoning fields.
- Discovery test asserts `Provider.Model.capabilities.attachment` and
  `capabilities.input.image` are true for `kimi-k2.7-code`.
- Provider-list test asserts the `/config/providers` path receives the same
  image-capable Kimi K2.7 Code model after `Provider.list()` initializes state.
