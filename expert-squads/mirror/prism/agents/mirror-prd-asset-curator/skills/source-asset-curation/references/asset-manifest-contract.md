# Asset discovery and manifest contract

## Accepted candidate input

Consume the Task-wide observation packet for every applicable exact delivery-plan entry and its assigned-surface static-markup, stylesheet, manifest,
source-set, inline Scalable Vector Graphics, font, background, favicon, and material dynamic-state
asset candidates. Preserve failed and blocked observations. Do not reopen the source or treat a
full-page screenshot as a reusable decorative asset.

## Identity and storage

Use one global monotonically increasing `A001`, `A002`, ... identity sequence across routes. Keep the
original extension when valid and use stable filesystem-safe names. Materialize each identity as
one atomic `.mirror/prd/assets/A###/` directory containing `asset.<extension>` and
`provenance.json`, only through the approved package tool. An exact retry verifies and reuses that
directory; changed provenance or bytes is a conflict and never overwrites an existing identity.

Maintain `.mirror/prd/assets/MANIFEST.md` with one row per asset:

`asset_id | route_id | source_layer | asset_type | source_url_or_inline_ref | trigger_state |
rights_decision | filename | local_path | media_type | bytes | sha256 | acquisition_method |
status | failure_or_risk`

Asset types are logo, favicon, icon, image, svg, background, font or decorative. Screenshots use
separate `S###` identities and are referenced by the Product Requirements screenshot ledger.

## Limits and failures

Keep the Task contract's materialization boundary. When accepted evidence does not authorize a
candidate, preserve it as unmaterialized with the exact reason. For an individual failure, record
the attempted materialization method and exact cause; never replace missing bytes with an unrelated
asset.

## Outputs

Produce the full manifest/process report and persist its path, digest, asset/screenshot counts, byte
total, identities by route/type, failures, rights blockers, budget status, and input provenance in
`prism/asset-ledger`. The visible final message is natural narration and does not transport the
manifest path or ledger body.
