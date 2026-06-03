# Source Skeleton Webpage Generation Plan

Date: 2026-05-30

## Decision

The webpage clone handoff must be source-skeleton-first.

OpenCorvus should not ask downstream LLMs to edit or adapt a generated runnable
frontend project. That artifact shape encourages replay code and creates an
unmaintainable implementation surface. The visual baseline is already the
reference screenshot. The development handoff should therefore be plain source
files:

```text
webpage-evidence/
  reference.png
  source-skeleton/
    README.md
    index.html
    styles.css
    critical.css
    full-source.css
    used-selectors.json
    skeleton-manifest.json
    source-skeleton-audit.json
  source-ir/
    component-tree.json
    content-model.json
    layout-map.json
    style-tokens.json
    interaction-hints.json
    source-quality-audit.json
```

`reference.png` is the visual truth. `source-skeleton/README.md`,
`source-ir/*.json`, `source-skeleton/critical.css`, and
`source-skeleton/index.html` are the LLM-facing source seed.
`source-skeleton/full-source.css` and the lower-level IR/assets remain targeted
evidence for gaps. The target Build agent reads the skeleton/IR and writes
normal React/Vue/etc. project code.

The target project is accepted only after a second source-side audit verifies
that the skeleton/IR was actually consumed. Screenshots can prove visual
similarity, but they cannot prove that a default scaffold or unmaintainable
HTML replay was replaced by editable application source.

## Source Skeleton Contract

`index.html` must preserve:

- DOM order and nesting.
- Visible text.
- Links, controls, tables, lists, forms, and media structure.
- Useful class names and safe attributes.
- `data-source-node-id` for traceability.
- `data-source-segment-id` for implementation grouping.
- A `data-reference-image="../reference.png"` pointer.

`critical.css` must preserve:

- Reachable original CSS rules extracted from `<style>` bodies and sidecar CSS.
- Computed-style fallback rules keyed by source node id when browser layout
  facts are available.
- Asset references by relative path.

`full-source.css` must preserve the complete CSS evidence sidecar.

`used-selectors.json` must record selector reachability and node matches.

`source-ir/*.json` must record component boundaries, content models, layout
facts, style tokens, interaction hints, and source-quality audit results.

`skeleton-manifest.json` must record:

- evidence paths;
- source-only policy;
- coverage stats;
- component hints from segments;
- confirmation that the handoff is source-only.

`source-skeleton-audit.json` must reject:

- missing HTML/CSS/README/critical CSS/full CSS/selector reachability/source IR;
- concrete framework imports;
- generated runtime markers;
- DOM replay factories;
- runnable generated-project markers such as `package.json` or `bun run dev`;
- missing screenshot reference.

## Prompt Contract

frontend_design must hand off the source skeleton explicitly. Requirements,
Architect, and Build must treat it as the implementation seed.

Build instructions:

```text
Read webpage-evidence/source-skeleton/README.md, webpage-evidence/source-ir/component-tree.json,
webpage-evidence/source-ir/content-model.json, webpage-evidence/source-ir/style-tokens.json,
webpage-evidence/source-ir/interaction-hints.json, and webpage-evidence/source-skeleton/critical.css
first.
Use webpage-evidence/source-skeleton/index.html and full-source.css only for exact
hierarchy or targeted missing style detail.
Generate normal project-owned framework source from the skeleton.
Use webpage-evidence/reference.png for visual acceptance.
Use IR/assets/segments only as diagnostics when the skeleton leaves a specific
gap.
Do not use generated runnable projects as app source.
```

## Verification

The new first-line gates are:

- `source-skeleton/source-skeleton-audit.json.passed === true`
- `source-ir/source-quality-audit.json.passed === true`
- `reference.png` exists
- generated app source passes `web_clone_source_audit`, producing
  `web-clone-source-skeleton-consumption-audit.json` with these checks:
  reference text from `content-model.json` / `index.html` is present in source,
  repeated tables/lists/cards are data arrays plus framework loops, semantic
  component files exist, default Vite/React/Vue scaffold residue is absent, and
  project-owned source avoids large HTML strings, raw HTML injection, manual DOM
  mutation, dense inline SVG, and base64 data URIs
- final rendered project is checked against `reference.png` across the required
  viewport matrix

The old generated-project handoff and publishability gate have been removed.
Source-skeleton consumption plus final viewport screenshots are the only
webpage clone handoff gates.
