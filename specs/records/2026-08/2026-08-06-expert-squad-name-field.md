# Expert Squad `name` Field

## Recall

- User request: add a `name` field to every Expert Squad; values may be Chinese or English.
- Acceptance: manifest v1 accepts an optional nonblank `name`; every embedded built-in and repository-owned package currently declares it; SDK authoring and heterogeneous import preserve it; Registry/catalog resolve an omitted name to the required `label`; generated payload and API artifacts are current; positive contract tests pass.
- Hard constraints: `manifest.id` remains the sole logical identity; `name` is descriptive metadata and must not become an alias, lookup key, fallback, or second selector identity. No compatibility reader or optional legacy path is allowed.
- Read sources: `AGENTS.md`, `specs/current/architecture/04-extensions.md`, `packages/sdk/js/src/expert-squad-manifest-v1.ts`, Registry/catalog/authoring/import implementations, and all tracked `expert-squad.jsonc` files.
- Repository search: 12 shipped manifests exist—Base, Advanced, Research Studio, Deep Research, Equity Research, Frontend Innovate, Frontend Replica, Review & Debug, Squad SDK, Mirror Prism, MirrorWatch, and MirrorTest.
- Independent Agent feedback: none requested; this task is handled in one agent as a schema-wide mechanical contract change.

## Contract

`name` is optional, trimmed, nonblank human-readable metadata. It may contain Chinese or English. When omitted, Registry resolves the required `label` as the package display name before catalog and UI projection. It does not participate in physical installation identity, active selection, namespace resolution, selector identity, or package lookup; those remain governed by scope/project/namespace and manifest `id`.

The field is carried through the SDK manifest type, authoring blueprint, heterogeneous importer, Registry metadata, catalog responses, declaration hashes, payload packages, and generated OpenAPI/SDK types. Existing `label` remains the concise display label; initial shipped package names equal their established labels.

## Verification

- Load every shipped package through the real Registry and assert the exact nonblank manifest/catalog `name`, then load a package with `name` omitted and assert that Registry/catalog project its required `label`.
- Author and import packages through their canonical writers and assert `name` survives materialization.
- Regenerate payload and OpenAPI/SDK artifacts.
- Run focused Registry, authoring, import, catalog, payload, route, document-health, and typecheck verification.
