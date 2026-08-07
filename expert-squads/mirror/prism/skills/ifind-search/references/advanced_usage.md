# iFind projected tool contract

The only executable iFind contract is the projected `prism/shared/ifind-search` package tool described by the parent `SKILL.md`.

Every call supplies exactly `query`, `channels`, and `size`. The configuration is an immutable tool-only package asset compiled into the projected tool closure; it is not a project input and has no caller-selectable path.

Use `news`, `report`, and `announcement` for China company evidence; `news`, `report`, and `usnotice` for United States company evidence; `teleconference` for earnings calls; `interact` for investor Q&A; `knowledge` and `yike` for provider concepts; `en_paper` for academic evidence; and `web` for international product, industry, policy, and general web evidence. Each call must still declare the exact nonempty unique channel list chosen for its evidence need.

The result contains the exact request identity, provider status, and validated result rows. An empty successful response is explicit zero-result evidence. A package-asset, transport, schema, size, channel, or response-boundary failure remains visible and never authorizes another implementation.
